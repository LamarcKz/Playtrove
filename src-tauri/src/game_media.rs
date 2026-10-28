//! Galeria por jogo: somente cópias internas escolhidas no diálogo; originais nunca são alterados.

use std::fs::{File, OpenOptions};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use image::ImageFormat;
use percent_encoding::percent_decode_str;
use rusqlite::Connection;
use serde::Serialize;
use tauri::http::{Method, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::errors::{AppError, AppResult};
use crate::i18n::Language;

pub const GALLERY_PROTOCOL: &str = "playtrove-gallery";
const MAX_IMAGE: u64 = 32 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;
const MAX_BATCH: usize = 20;
static NEXT_IMAGE: AtomicU64 = AtomicU64::new(1);
/// Impede que uma listagem observe somente parte de uma importação em lote.
static MEDIA_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameMediaItem {
    pub id: String,
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub created_at: String,
}

pub fn validate_game(db: &Connection, language: Language, game_id: i64) -> AppResult<()> {
    let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM games WHERE id = ?1)", [game_id], |row| row.get(0))?;
    if game_id <= 0 || !exists {
        return Err(AppError::text(language, "errors.gameNotFound", &[]));
    }
    Ok(())
}

pub fn list(db: &Mutex<Connection>, language: Language, root: &Path, game_id: i64) -> AppResult<Vec<GameMediaItem>> {
    let _guard = MEDIA_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    validate_game(&db.lock().unwrap_or_else(PoisonError::into_inner), language, game_id)?;
    list_internal(root, game_id).map_err(|_| AppError::text(language, "errors.gameMedia.read", &[]))
}

/// Copia somente seleções explícitas. Temporários não entram no índice e o guard desfaz todo o lote
/// se qualquer validação, gravação ou publicação falhar. O banco não fica travado durante o disco.
pub fn import_files(
    db: &Mutex<Connection>,
    language: Language,
    root: &Path,
    game_id: i64,
    sources: &[PathBuf],
) -> AppResult<Vec<GameMediaItem>> {
    let _guard = MEDIA_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    validate_game(&db.lock().unwrap_or_else(PoisonError::into_inner), language, game_id)?;
    let invalid = || AppError::text(language, "errors.gameMedia.invalid", &[]);
    let save_error = || AppError::text(language, "errors.gameMedia.save", &[]);
    if sources.len() > MAX_BATCH {
        return Err(AppError::text(language, "errors.gameMedia.tooMany", &[]));
    }
    if sources.is_empty() {
        return list_internal(root, game_id).map_err(|_| save_error());
    }
    let directory = gallery_directory(root, game_id, true).map_err(|_| save_error())?.ok_or_else(save_error)?;
    let mut rollback = PendingCopies(Vec::new());
    let mut copies = Vec::new();
    for source in sources {
        let extension = source.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
        let extension = match extension.as_str() {
            "jpeg" | "jpg" => "jpg",
            "png" => "png",
            "webp" => "webp",
            _ => return Err(invalid()),
        };
        let (bytes, _, _) = read_image(source, extension, true).ok_or_else(invalid)?;
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
        let sequence = NEXT_IMAGE.fetch_add(1, Ordering::Relaxed);
        let target = directory.join(format!("capture-{stamp}-{sequence}.{extension}"));
        let staging = directory.join(format!(".pending-{stamp}-{sequence}"));
        let mut file = OpenOptions::new().write(true).create_new(true).open(&staging).map_err(|_| save_error())?;
        rollback.0.push(staging.clone());
        file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|_| save_error())?;
        copies.push((staging, target));
    }
    // O jogo pode ter sido removido enquanto o diálogo ou a cópia estavam em andamento.
    validate_game(&db.lock().unwrap_or_else(PoisonError::into_inner), language, game_id)?;
    for (staging, target) in copies {
        std::fs::rename(&staging, &target).map_err(|_| save_error())?;
        rollback.0.push(target);
    }
    let items = list_internal(root, game_id).map_err(|_| save_error())?;
    rollback.0.clear();
    Ok(items)
}

pub fn remove(
    db: &Mutex<Connection>,
    language: Language,
    root: &Path,
    game_id: i64,
    media_id: &str,
) -> AppResult<Vec<GameMediaItem>> {
    let _guard = MEDIA_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    validate_game(&db.lock().unwrap_or_else(PoisonError::into_inner), language, game_id)?;
    let not_found = || AppError::text(language, "errors.gameMedia.notFound", &[]);
    media_info(media_id).ok_or_else(not_found)?;
    let directory = gallery_directory(root, game_id, false).map_err(|_| not_found())?.ok_or_else(not_found)?;
    let file = internal_file(&directory, media_id).ok_or_else(not_found)?;
    std::fs::remove_file(file).map_err(|_| AppError::text(language, "errors.gameMedia.remove", &[]))?;
    list_internal(root, game_id).map_err(|_| AppError::text(language, "errors.gameMedia.read", &[]))
}

struct PendingCopies(Vec<PathBuf>);
impl Drop for PendingCopies {
    fn drop(&mut self) {
        for file in &self.0 {
            let _ = std::fs::remove_file(file);
        }
    }
}

/// Cada nível precisa ser a pasta esperada, sem redirecionamento para fora do jogo.
fn direct_directory(parent: &Path, name: &str, create: bool) -> std::io::Result<Option<PathBuf>> {
    let path = parent.join(name);
    if !path.try_exists()? {
        if !create {
            return Ok(None);
        }
        std::fs::create_dir(&path)?;
    }
    if path.canonicalize()? != path || !path.is_dir() {
        return Err(std::io::Error::other("pasta de galeria redirecionada"));
    }
    Ok(Some(path))
}

fn gallery_directory(root: &Path, game_id: i64, create: bool) -> std::io::Result<Option<PathBuf>> {
    if game_id <= 0 {
        return Ok(None);
    }
    if !root.try_exists()? {
        if !create {
            return Ok(None);
        }
        std::fs::create_dir_all(root)?;
    }
    let root = root.canonicalize()?;
    let Some(game) = direct_directory(&root, &game_id.to_string(), create)? else { return Ok(None) };
    direct_directory(&game, "gallery", create)
}

/// Somente os nomes gerados pelo serviço viram ids/caminhos; nenhuma parte aceita separadores.
fn media_info(id: &str) -> Option<(&'static str, i64)> {
    let (stem, extension) = id.rsplit_once('.')?;
    let (stamp, sequence) = stem.strip_prefix("capture-")?.split_once('-')?;
    if stamp.is_empty()
        || sequence.is_empty()
        || !stamp.bytes().all(|byte| byte.is_ascii_digit())
        || !sequence.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let stamp = stamp.parse::<i64>().ok()?;
    sequence.parse::<u64>().ok().filter(|value| *value > 0)?;
    chrono::DateTime::from_timestamp_millis(stamp)?;
    let extension = match extension {
        "png" => "png",
        "jpg" => "jpg",
        "webp" => "webp",
        _ => return None,
    };
    Some((extension, stamp))
}

fn internal_file(directory: &Path, id: &str) -> Option<PathBuf> {
    media_info(id)?;
    let file = directory.join(id);
    (file.canonicalize().ok()? == file && file.is_file()).then_some(file)
}

fn read_image(path: &Path, extension: &str, decode: bool) -> Option<(Vec<u8>, u32, u32)> {
    let file = File::open(path).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > MAX_IMAGE {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_IMAGE {
        return None;
    }
    let format = image::guess_format(&bytes).ok()?;
    let expected = match extension {
        "png" => ImageFormat::Png,
        "jpg" => ImageFormat::Jpeg,
        "webp" => ImageFormat::WebP,
        _ => return None,
    };
    if format != expected {
        return None;
    }
    let (width, height) = image::ImageReader::with_format(Cursor::new(&bytes), format).into_dimensions().ok()?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return None;
    }
    if decode {
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(width);
        limits.max_image_height = Some(height);
        limits.max_alloc = Some(MAX_PIXELS * 8);
        let mut reader = image::ImageReader::with_format(Cursor::new(&bytes), format);
        reader.limits(limits);
        reader.decode().ok()?;
    }
    Some((bytes, width, height))
}

fn list_internal(root: &Path, game_id: i64) -> std::io::Result<Vec<GameMediaItem>> {
    let Some(directory) = gallery_directory(root, game_id, false)? else { return Ok(Vec::new()) };
    let mut items = Vec::new();
    for entry in std::fs::read_dir(&directory)? {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().into_owned();
        let Some((extension, stamp)) = media_info(&id) else { continue };
        let Some(file) = internal_file(&directory, &id) else { continue };
        let Some((_, width, height)) = read_image(&file, extension, false) else { continue };
        let created_at =
            chrono::DateTime::from_timestamp_millis(stamp).unwrap().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        items.push(GameMediaItem {
            url: format!("http://{GALLERY_PROTOCOL}.localhost/{game_id}/{id}"),
            id,
            width,
            height,
            created_at,
        });
    }
    items.sort_by(|left, right| right.created_at.cmp(&left.created_at).then_with(|| right.id.cmp(&left.id)));
    Ok(items)
}

fn request_parts(path: &str) -> Option<(i64, String)> {
    let path = percent_decode_str(path).decode_utf8().ok()?;
    let mut parts = path.strip_prefix('/')?.split('/');
    let raw_id = parts.next()?;
    let game_id = raw_id.parse::<i64>().ok().filter(|id| *id > 0)?;
    if raw_id != game_id.to_string() {
        return None;
    }
    let id = parts.next()?;
    media_info(id)?;
    if parts.next().is_some() {
        return None;
    }
    Some((game_id, id.to_string()))
}

fn image_file(root: &Path, path: &str) -> Option<(Vec<u8>, &'static str)> {
    let (game_id, id) = request_parts(path)?;
    let (extension, _) = media_info(&id)?;
    let directory = gallery_directory(root, game_id, false).ok()??;
    let file = internal_file(&directory, &id)?;
    let (bytes, _, _) = read_image(&file, extension, false)?;
    let mime = match extension {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        _ => return None,
    };
    Some((bytes, mime))
}

fn image_response(root: &Path, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        return Response::builder().status(StatusCode::METHOD_NOT_ALLOWED).header("Allow", "GET, HEAD").body(Vec::new()).unwrap();
    }
    let Some((bytes, mime)) = image_file(root, request.uri().path()) else {
        return Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap();
    };
    Response::builder()
        .header("Content-Type", mime)
        .header("Content-Length", bytes.len())
        .header("X-Content-Type-Options", "nosniff")
        .body(if request.method() == Method::HEAD { Vec::new() } else { bytes })
        .unwrap()
}

pub fn handle_request<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = context.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<crate::state::AppState>();
        let valid = request_parts(request.uri().path())
            .is_some_and(|(game_id, _)| validate_game(&state.db(), state.language(), game_id).is_ok());
        let response = if valid {
            image_response(&app.state::<crate::images::ImagesDir>().0, request)
        } else {
            Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap()
        };
        responder.respond(response);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_database, temp_folder};

    fn database() -> Mutex<Connection> {
        let db = memory_database();
        db.execute("INSERT INTO games (id, title, status_id, added_at) VALUES (12, 'Jogo', 1, '2026-01-01'), (13, 'Outro', 1, '2026-01-01')", []).unwrap();
        Mutex::new(db)
    }

    fn image(folder: &Path, name: &str, format: image::ImageFormat) -> PathBuf {
        let source = folder.join(name);
        image::DynamicImage::new_rgb8(3, 2).save_with_format(&source, format).unwrap();
        source
    }

    #[test]
    fn importa_varias_copias_lista_e_remove_sem_tocar_originais() {
        let folder = temp_folder("galeria-copias");
        let root = folder.join("images");
        let db = database();
        let png = image(&folder, "imagem.png", image::ImageFormat::Png);
        let jpg = image(&folder, "imagem.jpg", image::ImageFormat::Jpeg);
        let original = std::fs::read(&png).unwrap();
        let imported = import_files(&db, Language::PtBr, &root, 12, &[png.clone(), jpg.clone()]).unwrap();
        assert_eq!(imported.len(), 2);
        assert!(
            imported.iter().all(|item| item.width == 3
                && item.height == 2
                && item.url.starts_with("http://playtrove-gallery.localhost/12/"))
        );
        assert_eq!(list(&db, Language::En, &root, 12).unwrap(), imported);
        assert!(list(&db, Language::En, &root, 13).unwrap().is_empty());
        assert_eq!(remove(&db, Language::En, &root, 12, &imported[0].id).unwrap().len(), 1);
        assert_eq!(std::fs::read(&png).unwrap(), original);
        assert!(jpg.exists());
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn cancelar_preserva_galeria_e_ids_de_jogos_invalidos_sao_recusados() {
        let folder = temp_folder("galeria-cancelar");
        let db = database();
        assert!(import_files(&db, Language::En, &folder, 12, &[]).unwrap().is_empty());
        assert!(list(&db, Language::En, &folder, 999).is_err());
        assert!(import_files(&db, Language::En, &folder, 999, &[]).is_err());
        assert!(remove(&db, Language::En, &folder, 999, "capture-1-1.png").is_err());
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn assinatura_extensao_imagem_truncada_e_tamanho_invalidos_nao_deixam_copias() {
        let folder = temp_folder("galeria-validacao");
        let root = folder.join("images");
        let db = database();
        let good = image(&folder, "boa.png", image::ImageFormat::Png);
        let wrong = folder.join("outra.jpg");
        std::fs::copy(&good, &wrong).unwrap();
        let truncated = folder.join("truncada.png");
        std::fs::write(&truncated, b"\x89PNG\r\n\x1a\nquebrada").unwrap();
        let large = folder.join("grande.png");
        std::fs::File::create(&large).unwrap().set_len(MAX_IMAGE + 1).unwrap();
        for bad in [wrong, truncated, large] {
            assert!(import_files(&db, Language::En, &root, 12, &[good.clone(), bad]).is_err());
            assert!(list(&db, Language::En, &root, 12).unwrap().is_empty());
            if root.join("12/gallery").exists() {
                assert_eq!(std::fs::read_dir(root.join("12/gallery")).unwrap().count(), 0);
            }
        }
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn protocolo_so_entrega_id_interno_do_jogo_sem_travessia() {
        let folder = temp_folder("galeria-protocolo");
        let db = database();
        let source = image(&folder, "imagem.webp", image::ImageFormat::WebP);
        let root = folder.join("images");
        let imported = import_files(&db, Language::En, &root, 12, std::slice::from_ref(&source)).unwrap();
        let id = &imported[0].id;
        assert_eq!(image_file(&root, &format!("/12/{id}")), Some((std::fs::read(&source).unwrap(), "image/webp")));
        for path in [
            format!("/13/{id}"),
            format!("/12/../12/{id}"),
            format!("/12/%2e%2e/{id}"),
            "/12/cover.png".into(),
            "/0/capture-1-1.png".into(),
            "/12/capture-1-1.svg".into(),
        ] {
            assert!(image_file(&root, &path).is_none());
        }
        assert!(remove(&db, Language::En, &root, 13, id).is_err());
        assert!(remove(&db, Language::En, &root, 12, "../cover.png").is_err());
        assert_eq!(list(&db, Language::En, &root, 12).unwrap().len(), 1);
        std::fs::remove_dir_all(folder).unwrap();
    }
}
