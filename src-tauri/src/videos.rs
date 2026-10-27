//! Vídeos locais de fundo: cópias privadas do app e leitura por intervalos, fora da linha da janela.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use percent_encoding::percent_decode_str;
use rusqlite::{Connection, OptionalExtension};
use tauri::http::header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use tauri::http::{Method, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::errors::{AppError, AppResult};
use crate::i18n::Language;
use crate::images::ImagesDir;

pub const VIDEO_PROTOCOL: &str = "playtrove-video";
const MAX_CHUNK: u64 = 2 * 1024 * 1024;
static NEXT_VIDEO: AtomicU64 = AtomicU64::new(1);

/// Só nomes gerados pelo app podem virar caminho ou endereço de vídeo.
fn video_extension(filename: &str) -> Option<&'static str> {
    let (stem, extension) = filename.rsplit_once('.')?;
    let suffix = stem.strip_prefix("background-video-")?;
    if suffix.is_empty() || !suffix.bytes().all(|byte| byte.is_ascii_digit() || byte == b'-') {
        return None;
    }
    match extension {
        "mp4" => Some("mp4"),
        "webm" => Some("webm"),
        _ => None,
    }
}

pub fn video_url(game_id: i64, filename: &str) -> Option<String> {
    video_extension(filename)?;
    (game_id > 0).then(|| format!("http://{VIDEO_PROTOCOL}.localhost/{game_id}/{filename}"))
}

/// Confere a existência do jogo mesmo quando a seleção foi cancelada.
pub fn current_background_video(db: &Connection, language: Language, game_id: i64) -> AppResult<Option<String>> {
    db.query_row("SELECT background_video FROM games WHERE id = ?1", [game_id], |row| row.get(0))
        .optional()
        .map_err(|_| AppError::text(language, "errors.backgroundVideoRead", &[]))?
        .ok_or_else(|| AppError::text(language, "errors.gameNotFound", &[]))
}

/// Importa só a seleção da janela nativa. Cancelar ou falhar mantém o vídeo anterior.
pub fn pick_background_video(
    db: &Mutex<Connection>,
    language: Language,
    images_dir: &Path,
    game_id: i64,
    selection: Option<&Path>,
) -> AppResult<bool> {
    pick_background_video_with_copy(db, language, images_dir, game_id, selection, &mut std::io::copy)
}

fn pick_background_video_with_copy(
    db: &Mutex<Connection>,
    language: Language,
    images_dir: &Path,
    game_id: i64,
    selection: Option<&Path>,
    copy: &mut impl FnMut(&mut File, &mut File) -> std::io::Result<u64>,
) -> AppResult<bool> {
    current_background_video(&db.lock().unwrap_or_else(PoisonError::into_inner), language, game_id)?;
    let Some(source) = selection else { return Ok(false) };
    let invalid = || AppError::text(language, "errors.invalidBackgroundVideo", &[]);
    let read_error = || AppError::text(language, "errors.backgroundVideoRead", &[]);
    let save_error = || AppError::text(language, "errors.backgroundVideoSave", &[]);
    let extension = source.extension().and_then(|extension| extension.to_str()).unwrap_or_default().to_ascii_lowercase();
    if extension != "mp4" && extension != "webm" {
        return Err(invalid());
    }
    let mut source = File::open(source).map_err(|_| read_error())?;
    if !source.metadata().map_err(|_| read_error())?.is_file() {
        return Err(invalid());
    }
    let mut signature = [0; 12];
    let count = source.read(&mut signature).map_err(|_| read_error())?;
    let valid = match extension.as_str() {
        "mp4" => count >= 12 && &signature[4..8] == b"ftyp",
        "webm" => count >= 4 && signature[..4] == [0x1a, 0x45, 0xdf, 0xa3],
        _ => false,
    };
    if !valid {
        return Err(invalid());
    }
    source.rewind().map_err(|_| read_error())?;
    let directory = images_dir.join(game_id.to_string());
    std::fs::create_dir_all(&directory).map_err(|_| save_error())?;
    let root = images_dir.canonicalize().map_err(|_| save_error())?;
    let directory = directory.canonicalize().map_err(|_| save_error())?;
    if directory != root.join(game_id.to_string()) {
        return Err(save_error());
    }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let sequence = NEXT_VIDEO.fetch_add(1, Ordering::Relaxed);
    let filename = format!("background-video-{stamp}-{sequence}.{extension}");
    let target = directory.join(&filename);
    let copy = (|| -> std::io::Result<()> {
        let mut output = OpenOptions::new().write(true).create_new(true).open(&target)?;
        copy(&mut source, &mut output)?;
        output.flush()
    })();
    if copy.is_err() {
        let _ = std::fs::remove_file(&target);
        return Err(save_error());
    }
    // A cópia pode demorar: o banco fica livre até aqui. A associação atual é lida de novo sob a
    // mesma trava da gravação, caso outra escolha ou remoção tenha terminado durante a cópia.
    let saved = (|| -> AppResult<Option<String>> {
        let db = db.lock().unwrap_or_else(PoisonError::into_inner);
        let previous = current_background_video(&db, language, game_id)?;
        db.execute("UPDATE games SET background_video = ?1, background_video_mode = 'manual', background_video_checked_at = NULL WHERE id = ?2", (&filename, game_id)).map_err(|_| save_error())?;
        Ok(previous)
    })();
    let previous = match saved {
        Ok(previous) => previous,
        Err(error) => {
            let _ = std::fs::remove_file(&target);
            return Err(error);
        }
    };
    if let Some(previous) = previous.and_then(|filename| video_file(images_dir, game_id, &filename)) {
        let _ = std::fs::remove_file(previous);
    }
    Ok(true)
}

/// Retira a associação e só a cópia interna; o arquivo escolhido originalmente nunca é apagado.
pub fn remove_background_video(db: &Mutex<Connection>, language: Language, images_dir: &Path, game_id: i64) -> AppResult<()> {
    let previous = {
        let db = db.lock().unwrap_or_else(PoisonError::into_inner);
        let previous = current_background_video(&db, language, game_id)?;
        db.execute("UPDATE games SET background_video = NULL, background_video_mode = 'disabled', background_video_checked_at = NULL WHERE id = ?1", [game_id])
            .map_err(|_| AppError::text(language, "errors.backgroundVideoSave", &[]))?;
        previous
    };
    if let Some(previous) = previous.and_then(|filename| video_file(images_dir, game_id, &filename)) {
        let _ = std::fs::remove_file(previous);
    }
    Ok(())
}

/// Restaura o modo automático. A fila de metadados procura o trailer depois que esta gravação termina.
pub fn use_automatic_background_video(
    db: &Mutex<Connection>,
    language: Language,
    images_dir: &Path,
    game_id: i64,
) -> AppResult<()> {
    let previous = {
        let db = db.lock().unwrap_or_else(PoisonError::into_inner);
        let previous = current_background_video(&db, language, game_id)?;
        db.execute("UPDATE games SET background_video = NULL, background_video_mode = 'auto', background_video_checked_at = NULL WHERE id = ?1", [game_id])
            .map_err(|_| AppError::text(language, "errors.backgroundVideoSave", &[]))?;
        previous
    };
    if let Some(previous) = previous.and_then(|filename| video_file(images_dir, game_id, &filename)) {
        let _ = std::fs::remove_file(previous);
    }
    Ok(())
}

/// Marca consultas concluídas, inclusive quando o IGDB não oferece vídeo. Uma falha permite tentar de novo.
pub fn mark_background_video_checked(db: &Connection, game_id: i64, checked_at: Option<&str>) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE games SET background_video_checked_at = ?1 WHERE id = ?2 AND background_video_mode = 'auto'",
        (checked_at, game_id),
    )?;
    Ok(())
}

/// O downloader recebe apenas um destino interno e trabalha sem segurar a trava do banco.
pub fn download_automatic_background_video(
    db: &Mutex<Connection>,
    language: Language,
    images_dir: &Path,
    game_id: i64,
    download: impl FnOnce(&Path) -> Result<(), String>,
) -> AppResult<bool> {
    let read_state = |db: &Connection| -> AppResult<(Option<String>, String)> {
        db.query_row("SELECT background_video, background_video_mode FROM games WHERE id = ?1", [game_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()
        .map_err(|_| AppError::text(language, "errors.backgroundVideoRead", &[]))?
        .ok_or_else(|| AppError::text(language, "errors.gameNotFound", &[]))
    };
    let (original, mode) = read_state(&db.lock().unwrap_or_else(PoisonError::into_inner))?;
    if mode != "auto" || original.as_ref().and_then(|name| video_file(images_dir, game_id, name)).is_some() {
        return Ok(false);
    }
    let error = || AppError::text(language, "errors.trailerDownloadFailed", &[]);
    let directory = images_dir.join(game_id.to_string());
    std::fs::create_dir_all(&directory).map_err(|_| error())?;
    let root = images_dir.canonicalize().map_err(|_| error())?;
    let directory = directory.canonicalize().map_err(|_| error())?;
    if directory != root.join(game_id.to_string()) {
        return Err(error());
    }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let sequence = NEXT_VIDEO.fetch_add(1, Ordering::Relaxed);
    let filename = format!("background-video-{stamp}-{sequence}.mp4");
    let target = directory.join(&filename);
    let valid = download(&target).is_ok()
        && (|| -> std::io::Result<bool> {
            let mut file = File::open(&target)?;
            if file.metadata()?.len() > 100 * 1024 * 1024 {
                return Ok(false);
            }
            let mut signature = [0; 12];
            file.read_exact(&mut signature)?;
            Ok(&signature[4..8] == b"ftyp")
        })()
        .unwrap_or(false);
    if !valid {
        let _ = std::fs::remove_file(&target);
        return Err(error());
    }
    let saved = (|| -> AppResult<Option<Option<String>>> {
        let db = db.lock().unwrap_or_else(PoisonError::into_inner);
        let (current, mode) = read_state(&db)?;
        // Restaurar automático enquanto o download anda autoriza aproveitar o mesmo trailer.
        if mode != "auto" || (current.is_some() && current != original) {
            return Ok(None);
        }
        db.execute("UPDATE games SET background_video = ?1 WHERE id = ?2", (&filename, game_id)).map_err(|_| error())?;
        Ok(Some(current))
    })();
    match saved {
        Ok(Some(previous)) => {
            if let Some(previous) = previous.and_then(|name| video_file(images_dir, game_id, &name)) {
                let _ = std::fs::remove_file(previous);
            }
            Ok(true)
        }
        result => {
            let _ = std::fs::remove_file(&target);
            result.map(|_| false)
        }
    }
}

/// Caminho canônico dentro da pasta do jogo: impede travessia e atalhos para fora dela.
fn video_file(root: &Path, game_id: i64, filename: &str) -> Option<PathBuf> {
    if game_id <= 0 {
        return None;
    }
    video_extension(filename)?;
    let root = root.canonicalize().ok()?;
    let parent = root.join(game_id.to_string());
    let file = parent.join(filename).canonicalize().ok()?;
    (file.parent() == Some(parent.as_path()) && file.is_file()).then_some(file)
}

pub fn handle_request<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = context.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(video_response(&app.state::<ImagesDir>().0, request));
    });
}

/// Um intervalo por pedido, limitado a 2 MiB; o WebView pede o próximo sem carregar o vídeo inteiro.
fn byte_range(range: &str, length: u64) -> Option<(u64, u64)> {
    let (start, end) = range.strip_prefix("bytes=")?.split_once('-')?;
    if length == 0 {
        return None;
    }
    let (start, end) = if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        if suffix == 0 {
            return None;
        }
        (length.saturating_sub(suffix), length - 1)
    } else {
        let start = start.parse::<u64>().ok()?;
        let end = if end.is_empty() { length - 1 } else { end.parse::<u64>().ok()?.min(length - 1) };
        (start, end)
    };
    if start > end || start >= length {
        return None;
    }
    Some((start, end.min(start.saturating_add(MAX_CHUNK - 1))))
}

fn empty_response(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(status).body(Vec::new()).unwrap()
}

fn video_response(root: &Path, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return Response::builder().status(StatusCode::METHOD_NOT_ALLOWED).header("Allow", "GET, HEAD").body(Vec::new()).unwrap();
    }
    let path = percent_decode_str(request.uri().path().trim_start_matches('/')).decode_utf8();
    let path = match path {
        Ok(path) => path,
        Err(_) => return empty_response(StatusCode::NOT_FOUND),
    };
    let Some((id, filename)) = path.split_once('/') else { return empty_response(StatusCode::NOT_FOUND) };
    let game_id = match id.parse::<i64>() {
        Ok(id_value) if id_value > 0 && id_value.to_string() == id => id_value,
        _ => return empty_response(StatusCode::NOT_FOUND),
    };
    let Some(path) = video_file(root, game_id, filename) else { return empty_response(StatusCode::NOT_FOUND) };
    let mime = match video_extension(filename) {
        Some("mp4") => "video/mp4",
        _ => "video/webm",
    };
    file_response(&path, mime, &request)
}

/// Responde com um arquivo já conferido, em intervalos de até 2 MiB (também usado pelas mídias do tema Aniki).
pub(crate) fn file_response(path: &Path, mime: &str, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return empty_response(StatusCode::NOT_FOUND),
    };
    let length = match file.metadata() {
        Ok(metadata) => metadata.len(),
        Err(_) => return empty_response(StatusCode::NOT_FOUND),
    };
    let response = Response::builder().header(CONTENT_TYPE, mime).header(ACCEPT_RANGES, "bytes");
    if request.method() == Method::HEAD {
        return response.header(CONTENT_LENGTH, length).body(Vec::new()).unwrap();
    }
    let requested_range = request.headers().get(RANGE);
    let (start, end, partial) = if let Some(range) = requested_range {
        match range.to_str().ok().and_then(|range| byte_range(range, length)) {
            Some((start, end)) => (start, end, true),
            None => {
                return response
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(CONTENT_RANGE, format!("bytes */{length}"))
                    .header(CONTENT_LENGTH, 0)
                    .body(Vec::new())
                    .unwrap();
            }
        }
    } else if length == 0 {
        return response.header(CONTENT_LENGTH, 0).body(Vec::new()).unwrap();
    } else {
        (0, (length - 1).min(MAX_CHUNK - 1), length > MAX_CHUNK)
    };
    let count = end - start + 1;
    let mut bytes = vec![0; count as usize];
    if file.seek(SeekFrom::Start(start)).and_then(|_| file.read_exact(&mut bytes)).is_err() {
        return empty_response(StatusCode::NOT_FOUND);
    }
    let response = response.header(CONTENT_LENGTH, count);
    let response = if partial {
        response.status(StatusCode::PARTIAL_CONTENT).header(CONTENT_RANGE, format!("bytes {start}-{end}/{length}"))
    } else {
        response
    };
    response.body(bytes).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::Language;
    use crate::test_support::{memory_database, temp_folder};

    const MP4: &[u8] = b"\0\0\0\x18ftypisom\0\0\0\0isommp42conteudo";
    const WEBM: &[u8] = b"\x1a\x45\xdf\xa3\x87\x42\x82\x84webmconteudo";

    fn database() -> Mutex<Connection> {
        let db = memory_database();
        db.execute("INSERT INTO games (id, title, status_id, added_at) VALUES (12, 'Jogo', 1, '2026-01-01')", []).unwrap();
        Mutex::new(db)
    }

    fn stored(db: &Mutex<Connection>) -> Option<String> {
        db.lock().unwrap().query_row("SELECT background_video FROM games WHERE id = 12", [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn copiar_o_video_permite_ler_a_biblioteca_enquanto_o_disco_trabalha() {
        let db = database();
        let folder = temp_folder("video-banco-livre");
        let source = folder.join("filme.mp4");
        std::fs::write(&source, MP4).unwrap();
        let mut read_during_copy = false;
        let mut copy = |source: &mut File, target: &mut File| {
            let connection = db.try_lock().expect("a cópia do vídeo não pode reter a trava do banco");
            let library = crate::library::get_library(&connection, Language::En).unwrap();
            assert_eq!(serde_json::to_value(library).unwrap()["games"][0]["title"], "Jogo");
            read_during_copy = true;
            std::io::copy(source, target)
        };
        pick_background_video_with_copy(&db, Language::En, &folder.join("images"), 12, Some(&source), &mut copy).unwrap();
        assert!(read_during_copy);
        assert!(stored(&db).is_some());
    }

    fn request(root: &Path, method: &str, path: &str, range: Option<&str>) -> Response<Vec<u8>> {
        let mut request = Request::builder().method(method).uri(path);
        if let Some(range) = range {
            request = request.header(RANGE, range);
        }
        video_response(root, request.body(Vec::new()).unwrap())
    }

    #[test]
    fn importar_copia_o_video_e_remover_preserva_o_original_e_as_imagens() {
        let db = database();
        let folder = temp_folder("video-importar");
        let root = folder.join("images");
        let source = folder.join("filme.MP4");
        std::fs::write(&source, MP4).unwrap();
        std::fs::create_dir_all(root.join("12")).unwrap();
        std::fs::write(root.join("12/cover.png"), b"capa").unwrap();

        assert!(pick_background_video(&db, Language::PtBr, &root, 12, Some(&source)).unwrap());
        let filename = stored(&db).unwrap();
        assert!(!filename.contains(['/', '\\']));
        assert!(filename.ends_with(".mp4"));
        let copied = root.join("12").join(&filename);
        assert_eq!(std::fs::read(&copied).unwrap(), MP4);
        std::fs::rename(&source, folder.join("original-movido.mp4")).unwrap();
        assert_eq!(request(&root, "GET", &format!("/12/{filename}"), None).body(), MP4);

        remove_background_video(&db, Language::PtBr, &root, 12).unwrap();
        assert_eq!(stored(&db), None);
        assert_eq!(
            db.lock()
                .unwrap()
                .query_row("SELECT background_video_mode FROM games WHERE id=12", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "disabled"
        );
        assert!(!copied.exists());
        assert!(folder.join("original-movido.mp4").is_file());
        assert!(root.join("12/cover.png").is_file());
    }

    #[test]
    fn trocar_gera_outro_endereco_e_cancelar_ou_falhar_preserva_o_anterior() {
        let db = database();
        let folder = temp_folder("video-trocar");
        let root = folder.join("images");
        let source = folder.join("filme.mp4");
        std::fs::write(&source, MP4).unwrap();
        pick_background_video(&db, Language::En, &root, 12, Some(&source)).unwrap();
        let first = stored(&db).unwrap();
        assert!(!pick_background_video(&db, Language::En, &root, 12, None).unwrap());
        assert_eq!(stored(&db).as_deref(), Some(first.as_str()));
        std::fs::write(&source, b"nao e video").unwrap();
        assert!(pick_background_video(&db, Language::En, &root, 12, Some(&source)).is_err());
        assert!(pick_background_video(&db, Language::En, &root, 12, Some(&folder.join("ausente.mp4"))).is_err());
        assert_eq!(stored(&db).as_deref(), Some(first.as_str()));
        assert!(root.join("12").join(&first).is_file());

        let webm = folder.join("filme.webm");
        std::fs::write(&webm, WEBM).unwrap();
        pick_background_video(&db, Language::En, &root, 12, Some(&webm)).unwrap();
        let second = stored(&db).unwrap();
        assert_ne!(second, first);
        assert!(second.ends_with(".webm"));
        assert!(!root.join("12").join(first).exists());
        assert_eq!(request(&root, "GET", &format!("/12/{second}"), None).headers()[CONTENT_TYPE], "video/webm");
        assert_eq!(
            db.lock()
                .unwrap()
                .query_row("SELECT background_video_mode FROM games WHERE id=12", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "manual"
        );
    }

    #[test]
    fn automatico_guarda_o_trailer_e_respeita_mudancas_de_modo_durante_o_download() {
        let db = database();
        let root = temp_folder("video-automatico");
        let save = |path: &Path| std::fs::write(path, MP4).map_err(|error| error.to_string());
        assert!(download_automatic_background_video(&db, Language::En, &root, 12, save).unwrap());
        let first = stored(&db).unwrap();
        assert_eq!(std::fs::read(root.join("12").join(&first)).unwrap(), MP4);
        assert!(
            !download_automatic_background_video(&db, Language::En, &root, 12, |_| panic!("não baixar vídeo existente")).unwrap()
        );

        use_automatic_background_video(&db, Language::En, &root, 12).unwrap();
        assert!(!root.join("12").join(&first).exists());
        assert!(
            !download_automatic_background_video(&db, Language::En, &root, 12, |path| {
                remove_background_video(&db, Language::En, &root, 12).unwrap();
                save(path)
            })
            .unwrap()
        );
        assert_eq!(stored(&db), None);
        assert_eq!(std::fs::read_dir(root.join("12")).unwrap().count(), 0);

        use_automatic_background_video(&db, Language::En, &root, 12).unwrap();
        let source = root.join("manual.mp4");
        std::fs::write(&source, MP4).unwrap();
        assert!(
            !download_automatic_background_video(&db, Language::En, &root, 12, |path| {
                pick_background_video(&db, Language::En, &root, 12, Some(&source)).unwrap();
                save(path)
            })
            .unwrap()
        );
        assert!(stored(&db).is_some());
        assert_eq!(std::fs::read_dir(root.join("12")).unwrap().count(), 1);
        assert!(!download_automatic_background_video(&db, Language::En, &root, 12, |_| panic!("manual tem prioridade")).unwrap());
    }

    #[test]
    fn falha_automatica_apaga_parciais_e_a_restauração_autoriza_download_em_andamento() {
        let db = database();
        let root = temp_folder("video-automatico-falha");
        assert!(
            download_automatic_background_video(&db, Language::En, &root, 12, |path| {
                std::fs::write(path, b"parcial").unwrap();
                Err("erro interno com caminho privado".into())
            })
            .is_err()
        );
        assert_eq!(std::fs::read_dir(root.join("12")).unwrap().count(), 0);
        assert_eq!(stored(&db), None);
        assert!(
            download_automatic_background_video(&db, Language::En, &root, 12, |path| {
                remove_background_video(&db, Language::En, &root, 12).unwrap();
                use_automatic_background_video(&db, Language::En, &root, 12).unwrap();
                std::fs::write(path, MP4).map_err(|error| error.to_string())
            })
            .unwrap()
        );
    }

    #[test]
    fn rejeita_outros_formatos_e_jogos_inexistentes_sem_criar_copias() {
        let db = database();
        let folder = temp_folder("video-rejeitar");
        let root = folder.join("images");
        for (filename, content) in [("texto.mp4", b"texto".as_slice()), ("filme.exe", MP4), ("renomeado.webm", MP4)] {
            let source = folder.join(filename);
            std::fs::write(&source, content).unwrap();
            assert!(pick_background_video(&db, Language::En, &root, 12, Some(&source)).is_err());
        }
        let source = folder.join("filme.mp4");
        std::fs::write(&source, MP4).unwrap();
        assert!(pick_background_video(&db, Language::En, &root, 99, Some(&source)).is_err());
        assert!(pick_background_video(&db, Language::En, &root, 99, None).is_err());
        assert!(remove_background_video(&db, Language::En, &root, 99).is_err());
        assert_eq!(stored(&db), None);
        assert!(!root.exists());
    }

    #[test]
    fn erro_ao_gravar_o_banco_apaga_a_copia_nova_e_preserva_a_anterior() {
        let db = database();
        let folder = temp_folder("video-erro-banco");
        let root = folder.join("images");
        let source = folder.join("filme.mp4");
        std::fs::write(&source, MP4).unwrap();
        pick_background_video(&db, Language::En, &root, 12, Some(&source)).unwrap();
        let first = stored(&db).unwrap();
        db.lock()
            .unwrap()
            .execute_batch(
                "CREATE TRIGGER falha_video BEFORE UPDATE OF background_video ON games BEGIN SELECT RAISE(ABORT, 'falha'); END;",
            )
            .unwrap();
        assert!(pick_background_video(&db, Language::En, &root, 12, Some(&source)).is_err());
        assert_eq!(stored(&db).as_deref(), Some(first.as_str()));
        assert_eq!(std::fs::read_dir(root.join("12")).unwrap().count(), 1);
        assert!(root.join("12").join(first).is_file());
    }

    #[test]
    fn protocolo_limita_os_intervalos_e_responde_head_sem_ler_o_corpo() {
        let folder = temp_folder("video-protocolo");
        let root = folder.join("images");
        std::fs::create_dir_all(root.join("12")).unwrap();
        let path = root.join("12/background-video-1.mp4");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(10_000_000).unwrap();
        let response = request(&root, "GET", "/12/background-video-1.mp4", Some("bytes=4-8"));
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[CONTENT_RANGE], "bytes 4-8/10000000");
        assert_eq!(response.headers()[CONTENT_LENGTH], "5");
        assert_eq!(response.body(), &[0; 5]);
        assert_eq!(response.headers()[ACCEPT_RANGES], "bytes");
        let response = request(&root, "GET", "/12/background-video-1.mp4", Some("bytes=0-"));
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body().len(), 2 * 1024 * 1024);
        assert_eq!(response.headers()[CONTENT_RANGE], "bytes 0-2097151/10000000");
        let response = request(&root, "GET", "/12/background-video-1.mp4", Some("bytes=-6"));
        assert_eq!(response.headers()[CONTENT_RANGE], "bytes 9999994-9999999/10000000");
        assert_eq!(response.body().len(), 6);
        let response = request(&root, "HEAD", "/12/background-video-1.mp4", Some("bytes=0-4"));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_LENGTH], "10000000");
        assert!(response.body().is_empty());
    }

    #[test]
    fn protocolo_rejeita_intervalos_invalidos_e_caminhos_fora_do_video() {
        let folder = temp_folder("video-caminhos");
        let root = folder.join("images");
        std::fs::create_dir_all(root.join("12")).unwrap();
        std::fs::write(root.join("12/background-video-1.mp4"), MP4).unwrap();
        std::fs::write(root.join("12/cover.png"), b"imagem").unwrap();
        std::fs::write(root.join("12/outro.mp4"), MP4).unwrap();
        std::fs::write(folder.join("background-video-1.mp4"), MP4).unwrap();
        for range in
            ["bytes=999-", "bytes=8-3", "bytes=-0", "bytes=0-1,4-5", "bytes=a-b", "items=0-1", "bytes=18446744073709551616-"]
        {
            let response = request(&root, "GET", "/12/background-video-1.mp4", Some(range));
            assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE, "{range}");
            assert_eq!(response.headers()[CONTENT_RANGE], "bytes */32");
            assert!(response.body().is_empty());
        }
        for path in [
            "/../background-video-1.mp4",
            "/12/%2e%2e/%2e%2e/background-video-1.mp4",
            "/12/..%5c..%5cbackground-video-1.mp4",
            "/12/cover.png",
            "/12/outro.mp4",
            "/0/background-video-1.mp4",
            "/12/ausente.mp4",
        ] {
            assert_eq!(request(&root, "GET", path, None).status(), StatusCode::NOT_FOUND, "{path}");
        }
        assert_eq!(request(&root, "POST", "/12/background-video-1.mp4", None).status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(video_url(12, "../fora.mp4"), None);
        assert_eq!(
            video_url(12, "background-video-1.mp4").as_deref(),
            Some("http://playtrove-video.localhost/12/background-video-1.mp4")
        );
    }
}
