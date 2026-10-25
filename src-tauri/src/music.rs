//! Música tema por jogo: cópias internas e leitura por intervalos sem bloquear a janela.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::Utc;
use percent_encoding::percent_decode_str;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::http::header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use tauri::http::{Method, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::dates::iso;
use crate::errors::{AppError, AppResult};
use crate::i18n::Language;
use crate::images::ImagesDir;
use crate::settings::{get_setting, set_setting};

pub const MUSIC_PROTOCOL: &str = "playtrove-music";
const MAX_CHUNK: u64 = 2 * 1024 * 1024;
const MAX_MUSIC: u64 = 32 * 1024 * 1024;
static NEXT_MUSIC: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicConfig {
    pub enabled: bool,
    pub volume: u8,
    pub auto_download: bool,
}

pub fn get_config(db: &Connection) -> MusicConfig {
    let enabled = |key| !matches!(get_setting(db, key).ok().flatten().as_deref(), Some("0" | "false"));
    MusicConfig {
        enabled: enabled("themeMusicEnabled"),
        volume: get_setting(db, "themeMusicVolume")
            .ok()
            .flatten()
            .and_then(|value| value.parse::<u8>().ok())
            .filter(|volume| *volume <= 100)
            .unwrap_or(20),
        auto_download: enabled("themeMusicAutoDownload"),
    }
}

/// As três preferências são salvas juntas, sem deixar uma configuração parcialmente atualizada.
pub fn set_config(db: &Connection, config: &MusicConfig) -> AppResult<()> {
    let language = crate::i18n::load_language(db, &[]).unwrap_or(Language::PtBr);
    if config.volume > 100 {
        return Err(AppError::text(language, "errors.invalidThemeMusicVolume", &[]));
    }
    let error = || AppError::text(language, "errors.themeMusicSave", &[]);
    let transaction = db.unchecked_transaction().map_err(|_| error())?;
    set_setting(&transaction, "themeMusicEnabled", Some(if config.enabled { "1" } else { "0" })).map_err(|_| error())?;
    set_setting(&transaction, "themeMusicVolume", Some(&config.volume.to_string())).map_err(|_| error())?;
    set_setting(&transaction, "themeMusicAutoDownload", Some(if config.auto_download { "1" } else { "0" }))
        .map_err(|_| error())?;
    transaction.commit().map_err(|_| error())?;
    Ok(())
}

/// Somente nomes de cópias internas podem virar caminho ou endereço de mídia.
fn music_extension(filename: &str) -> Option<&'static str> {
    let (stem, extension) = filename.rsplit_once('.')?;
    let suffix = stem.strip_prefix("theme-music-")?;
    if suffix.is_empty() || !suffix.bytes().all(|byte| byte.is_ascii_digit() || byte == b'-') {
        return None;
    }
    match extension {
        "m4a" => Some("m4a"),
        "mp3" => Some("mp3"),
        "wav" => Some("wav"),
        _ => None,
    }
}

pub fn theme_music_url(game_id: i64, filename: &str) -> Option<String> {
    music_extension(filename)?;
    (game_id > 0).then(|| format!("http://{MUSIC_PROTOCOL}.localhost/{game_id}/{filename}"))
}

struct MusicState {
    filename: Option<String>,
    mode: String,
    checked_at: Option<String>,
    revision: i64,
}

fn current_state(db: &Connection, language: Language, game_id: i64) -> AppResult<MusicState> {
    db.query_row(
        "SELECT theme_music, theme_music_mode, theme_music_checked_at, theme_music_revision FROM games WHERE id = ?1",
        [game_id],
        |row| Ok(MusicState { filename: row.get(0)?, mode: row.get(1)?, checked_at: row.get(2)?, revision: row.get(3)? }),
    )
    .optional()
    .map_err(|_| AppError::text(language, "errors.themeMusicRead", &[]))?
    .ok_or_else(|| AppError::text(language, "errors.gameNotFound", &[]))
}

fn valid_signature(signature: &[u8], extension: &str) -> bool {
    match extension {
        "m4a" => {
            signature.len() >= 12
                && &signature[4..8] == b"ftyp"
                && matches!(&signature[8..12], b"M4A " | b"isom" | b"iso2" | b"iso5" | b"iso6" | b"mp41" | b"mp42" | b"dash")
        }
        "mp3" => {
            signature.starts_with(b"ID3")
                || (signature.len() >= 2
                    && signature[0] == 0xff
                    && signature[1] & 0xe0 == 0xe0
                    && signature[1] & 0x18 != 0x08
                    && signature[1] & 0x06 != 0)
        }
        "wav" => signature.len() >= 12 && &signature[..4] == b"RIFF" && &signature[8..12] == b"WAVE",
        _ => false,
    }
}

fn valid_music_file(path: &Path, extension: &str) -> bool {
    (|| -> std::io::Result<bool> {
        let mut file = File::open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.len() > MAX_MUSIC {
            return Ok(false);
        }
        let mut signature = [0; 12];
        let count = file.read(&mut signature)?;
        Ok(valid_signature(&signature[..count], extension))
    })()
    .unwrap_or(false)
}

fn internal_directory(images_dir: &Path, game_id: i64) -> std::io::Result<PathBuf> {
    let directory = images_dir.join(game_id.to_string());
    std::fs::create_dir_all(&directory)?;
    let root = images_dir.canonicalize()?;
    let directory = directory.canonicalize()?;
    if directory != root.join(game_id.to_string()) {
        return Err(std::io::Error::other("pasta de música fora da pasta do jogo"));
    }
    Ok(directory)
}

fn new_filename(extension: &str) -> String {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let sequence = NEXT_MUSIC.fetch_add(1, Ordering::Relaxed);
    format!("theme-music-{stamp}-{sequence}.{extension}")
}

/// Importa a seleção do diálogo. O disco trabalha sem reter a trava do banco.
pub fn pick_theme_music(
    db: &Mutex<Connection>,
    language: Language,
    images_dir: &Path,
    game_id: i64,
    selection: Option<&Path>,
) -> AppResult<bool> {
    current_state(&db.lock().unwrap_or_else(PoisonError::into_inner), language, game_id)?;
    let Some(source) = selection else { return Ok(false) };
    let invalid = || AppError::text(language, "errors.invalidThemeMusic", &[]);
    let read_error = || AppError::text(language, "errors.themeMusicRead", &[]);
    let save_error = || AppError::text(language, "errors.themeMusicSave", &[]);
    let extension = source.extension().and_then(|extension| extension.to_str()).unwrap_or_default().to_ascii_lowercase();
    if !matches!(extension.as_str(), "m4a" | "mp3" | "wav") {
        return Err(invalid());
    }
    let mut source = File::open(source).map_err(|_| read_error())?;
    let metadata = source.metadata().map_err(|_| read_error())?;
    if !metadata.is_file() || metadata.len() > MAX_MUSIC {
        return Err(invalid());
    }
    let mut signature = [0; 12];
    let count = source.read(&mut signature).map_err(|_| read_error())?;
    if !valid_signature(&signature[..count], &extension) {
        return Err(invalid());
    }
    source.rewind().map_err(|_| read_error())?;
    let directory = internal_directory(images_dir, game_id).map_err(|_| save_error())?;
    let filename = new_filename(&extension);
    let target = directory.join(&filename);
    let copied = (|| -> std::io::Result<()> {
        let mut output = OpenOptions::new().write(true).create_new(true).open(&target)?;
        let count = std::io::copy(&mut source.take(MAX_MUSIC + 1), &mut output)?;
        if count > MAX_MUSIC {
            return Err(std::io::Error::other("música excedeu o limite"));
        }
        output.flush()
    })();
    if copied.is_err() || !valid_music_file(&target, &extension) {
        let _ = std::fs::remove_file(&target);
        return Err(save_error());
    }
    let saved = (|| -> AppResult<Option<String>> {
        let db = db.lock().unwrap_or_else(PoisonError::into_inner);
        let previous = current_state(&db, language, game_id)?.filename;
        db.execute(
            "UPDATE games SET theme_music = ?1, theme_music_mode = 'manual', theme_music_checked_at = NULL,
            theme_music_revision = theme_music_revision + 1 WHERE id = ?2",
            (&filename, game_id),
        )
        .map_err(|_| save_error())?;
        Ok(previous)
    })();
    match saved {
        Ok(previous) => {
            remove_internal_file(images_dir, game_id, previous.as_deref());
            Ok(true)
        }
        Err(error) => {
            let _ = std::fs::remove_file(target);
            Err(error)
        }
    }
}

/// Retira somente a cópia interna e impede buscas automáticas até nova escolha.
pub fn remove_theme_music(db: &Mutex<Connection>, language: Language, images_dir: &Path, game_id: i64) -> AppResult<()> {
    let previous = {
        let db = db.lock().unwrap_or_else(PoisonError::into_inner);
        let previous = current_state(&db, language, game_id)?.filename;
        db.execute(
            "UPDATE games SET theme_music = NULL, theme_music_mode = 'disabled', theme_music_checked_at = NULL,
            theme_music_revision = theme_music_revision + 1 WHERE id = ?1",
            [game_id],
        )
        .map_err(|_| AppError::text(language, "errors.themeMusicSave", &[]))?;
        previous
    };
    remove_internal_file(images_dir, game_id, previous.as_deref());
    Ok(())
}

/// Reativa a busca e conserva a música atual até um novo download terminar com sucesso.
pub fn use_automatic_theme_music(db: &Connection, language: Language, game_id: i64) -> AppResult<()> {
    current_state(db, language, game_id)?;
    db.execute(
        "UPDATE games SET theme_music_mode = 'auto', theme_music_checked_at = NULL,
        theme_music_revision = theme_music_revision + 1 WHERE id = ?1",
        [game_id],
    )
    .map_err(|_| AppError::text(language, "errors.themeMusicSave", &[]))?;
    Ok(())
}

/// O downloader retorna false quando não encontra música. Falhas preservam o arquivo e permitem repetir.
pub fn download_automatic_theme_music(
    db: &Mutex<Connection>,
    language: Language,
    images_dir: &Path,
    game_id: i64,
    download: impl FnOnce(&Path) -> Result<bool, String>,
) -> AppResult<bool> {
    let original = current_state(&db.lock().unwrap_or_else(PoisonError::into_inner), language, game_id)?;
    if original.mode != "auto" || original.checked_at.is_some() {
        return Ok(false);
    }
    let error = || AppError::text(language, "errors.themeMusicDownloadFailed", &[]);
    let directory = internal_directory(images_dir, game_id).map_err(|_| error())?;
    let filename = new_filename("m4a");
    let target = directory.join(&filename);
    let found = match download(&target) {
        Ok(found) => found,
        Err(_) => {
            let _ = std::fs::remove_file(&target);
            return Err(error());
        }
    };
    if found && (music_file(images_dir, game_id, &filename).as_ref() != Some(&target) || !valid_music_file(&target, "m4a")) {
        let _ = std::fs::remove_file(&target);
        return Err(error());
    }
    let saved = (|| -> AppResult<bool> {
        let db = db.lock().unwrap_or_else(PoisonError::into_inner);
        let checked = iso(Utc::now());
        // Até uma passagem manual -> automático invalida o trabalho anterior. A consulta concluída
        // também impede um segundo download concorrente de substituir o primeiro que terminou.
        let changed = if found {
            db.execute(
                "UPDATE games SET theme_music = ?1, theme_music_checked_at = ?2 WHERE id = ?3
                AND theme_music_mode = 'auto' AND theme_music_revision = ?4 AND theme_music_checked_at IS NULL",
                (&filename, &checked, game_id, original.revision),
            )
        } else {
            db.execute(
                "UPDATE games SET theme_music_checked_at = ?1 WHERE id = ?2
                AND theme_music_mode = 'auto' AND theme_music_revision = ?3 AND theme_music_checked_at IS NULL",
                (&checked, game_id, original.revision),
            )
        }
        .map_err(|_| error())?;
        Ok(changed == 1)
    })();
    match saved {
        Ok(true) if found => {
            remove_internal_file(images_dir, game_id, original.filename.as_deref());
            Ok(true)
        }
        result => {
            let _ = std::fs::remove_file(&target);
            result.map(|_| false)
        }
    }
}

/// Caminhos canônicos restringem leitura e remoção à pasta interna do jogo.
fn music_file(root: &Path, game_id: i64, filename: &str) -> Option<PathBuf> {
    if game_id <= 0 {
        return None;
    }
    music_extension(filename)?;
    let root = root.canonicalize().ok()?;
    let parent = root.join(game_id.to_string());
    let file = parent.join(filename).canonicalize().ok()?;
    (file.parent() == Some(parent.as_path()) && file.is_file()).then_some(file)
}

fn remove_internal_file(root: &Path, game_id: i64, filename: Option<&str>) {
    if let Some(file) = filename.and_then(|filename| music_file(root, game_id, filename)) {
        let _ = std::fs::remove_file(file);
    }
}

pub fn handle_request<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = context.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(music_response(&app.state::<ImagesDir>().0, request));
    });
}

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

fn music_response(root: &Path, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return Response::builder().status(StatusCode::METHOD_NOT_ALLOWED).header("Allow", "GET, HEAD").body(Vec::new()).unwrap();
    }
    let path = match percent_decode_str(request.uri().path().trim_start_matches('/')).decode_utf8() {
        Ok(path) => path,
        Err(_) => return empty_response(StatusCode::NOT_FOUND),
    };
    let Some((id, filename)) = path.split_once('/') else { return empty_response(StatusCode::NOT_FOUND) };
    let game_id = match id.parse::<i64>() {
        Ok(game_id) if game_id > 0 && game_id.to_string() == id => game_id,
        _ => return empty_response(StatusCode::NOT_FOUND),
    };
    let Some(path) = music_file(root, game_id, filename) else { return empty_response(StatusCode::NOT_FOUND) };
    let mime = match music_extension(filename) {
        Some("m4a") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        _ => "audio/wav",
    };
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
    let (start, end, partial) = if let Some(range) = request.headers().get(RANGE) {
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
    use crate::test_support::{memory_database, temp_folder};
    use tauri::http::StatusCode;
    use tauri::http::header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE};

    const M4A: &[u8] = b"\0\0\0\x18ftypM4A \0\0\0\0M4A isomconteudo";
    const MP3: &[u8] = b"ID3\x04\0\0\0\0\0\0conteudo";
    const WAV: &[u8] = b"RIFF\x10\0\0\0WAVEfmt conteudo";

    fn database() -> Mutex<Connection> {
        let db = memory_database();
        db.execute("INSERT INTO games (id, title, status_id, added_at) VALUES (12, 'Jogo', 1, '2026-01-01')", []).unwrap();
        Mutex::new(db)
    }

    fn stored(db: &Mutex<Connection>) -> (Option<String>, String, Option<String>) {
        db.lock()
            .unwrap()
            .query_row("SELECT theme_music, theme_music_mode, theme_music_checked_at FROM games WHERE id = 12", [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .unwrap()
    }

    fn save(path: &Path) -> Result<bool, String> {
        std::fs::write(path, M4A).map_err(|error| error.to_string())?;
        Ok(true)
    }

    fn request(root: &Path, method: &str, path: &str, range: Option<&str>) -> Response<Vec<u8>> {
        let mut request = Request::builder().method(method).uri(path);
        if let Some(range) = range {
            request = request.header(RANGE, range);
        }
        music_response(root, request.body(Vec::new()).unwrap())
    }

    #[test]
    fn configuracao_usa_padrao_e_preserva_valores_apos_volume_invalido() {
        let db = memory_database();
        assert_eq!(get_config(&db), MusicConfig { enabled: true, volume: 20, auto_download: true });
        let config = MusicConfig { enabled: false, volume: 0, auto_download: false };
        set_config(&db, &config).unwrap();
        assert_eq!(get_config(&db), config);
        assert!(set_config(&db, &MusicConfig { volume: 101, ..config.clone() }).is_err());
        assert_eq!(get_config(&db), config);
        set_config(&db, &MusicConfig { volume: 100, ..config.clone() }).unwrap();
        assert_eq!(get_config(&db).volume, 100);
    }

    #[test]
    fn importar_formatos_aceitos_troca_a_copia_sem_remover_original_ou_imagens() {
        let db = database();
        let folder = temp_folder("musica-importar");
        let root = folder.join("images");
        std::fs::create_dir_all(root.join("12")).unwrap();
        std::fs::write(root.join("12/cover.png"), b"capa").unwrap();
        let mut previous = None;
        for (extension, bytes, mime) in [("M4A", M4A, "audio/mp4"), ("mp3", MP3, "audio/mpeg"), ("wav", WAV, "audio/wav")] {
            let source = folder.join(format!("original.{extension}"));
            std::fs::write(&source, bytes).unwrap();
            assert!(pick_theme_music(&db, Language::En, &root, 12, Some(&source)).unwrap());
            let (filename, mode, checked) = stored(&db);
            assert_eq!(mode, "manual");
            assert_eq!(checked, None);
            let filename = filename.unwrap();
            assert_eq!(std::fs::read(root.join("12").join(&filename)).unwrap(), bytes);
            let response = request(&root, "GET", &format!("/12/{filename}"), None);
            assert_eq!(response.headers()[CONTENT_TYPE], mime);
            assert_eq!(response.body(), bytes);
            if let Some(previous) = previous {
                assert!(!root.join("12").join(previous).exists());
            }
            previous = Some(filename);
            assert!(source.is_file());
        }
        remove_theme_music(&db, Language::En, &root, 12).unwrap();
        assert_eq!(stored(&db), (None, "disabled".into(), None));
        assert!(root.join("12/cover.png").is_file());
        assert_eq!(std::fs::read_dir(root.join("12")).unwrap().count(), 1);
    }

    #[test]
    fn importar_m4a_aceita_containers_de_aac_fragmentado() {
        let db = database();
        let root = temp_folder("musica-m4a-fragmentado");
        for (name, bytes) in [
            ("dash", b"\0\0\0\x18ftypdash\0\0\0\0conteudo".as_slice()),
            ("iso6", b"\0\0\0\x18ftypiso6\0\0\0\0conteudo".as_slice()),
            ("iso5", b"\0\0\0\x18ftypiso5\0\0\0\0conteudo".as_slice()),
            ("iso2", b"\0\0\0\x18ftypiso2\0\0\0\0conteudo".as_slice()),
            ("mp41", b"\0\0\0\x18ftypmp41\0\0\0\0conteudo".as_slice()),
        ] {
            let source = root.join(format!("{name}.m4a"));
            std::fs::write(&source, bytes).unwrap();
            assert!(pick_theme_music(&db, Language::En, &root, 12, Some(&source)).unwrap(), "{name}");
            assert_eq!(std::fs::read(root.join("12").join(stored(&db).0.unwrap())).unwrap(), bytes);
        }
    }

    #[test]
    fn cancelar_ou_falhar_preserva_musica_anterior_e_nao_cria_parciais() {
        let db = database();
        let folder = temp_folder("musica-invalidos");
        let root = folder.join("images");
        let source = folder.join("original.mp3");
        std::fs::write(&source, MP3).unwrap();
        pick_theme_music(&db, Language::En, &root, 12, Some(&source)).unwrap();
        let previous = stored(&db);
        assert!(!pick_theme_music(&db, Language::En, &root, 12, None).unwrap());
        for (name, bytes) in [
            ("falso.mp3", b"texto".as_slice()),
            ("falso.wav", MP3),
            ("video.m4a", b"\0\0\0\x18ftypxxxxconteudo"),
            ("programa.exe", M4A),
        ] {
            let source = folder.join(name);
            std::fs::write(&source, bytes).unwrap();
            assert!(pick_theme_music(&db, Language::En, &root, 12, Some(&source)).is_err(), "{name}");
            assert_eq!(stored(&db), previous);
        }
        assert!(pick_theme_music(&db, Language::En, &root, 99, None).is_err());
        assert!(remove_theme_music(&db, Language::En, &root, 99).is_err());
        assert_eq!(std::fs::read_dir(root.join("12")).unwrap().count(), 1);
    }

    #[test]
    fn automatico_registra_sucesso_e_ausencia_sem_repetir_consulta_concluida() {
        let db = database();
        let root = temp_folder("musica-automatico");
        assert!(download_automatic_theme_music(&db, Language::En, &root, 12, save).unwrap());
        let (filename, mode, checked) = stored(&db);
        assert_eq!(mode, "auto");
        assert!(checked.is_some());
        let filename = filename.unwrap();
        assert_eq!(std::fs::read(root.join("12").join(&filename)).unwrap(), M4A);
        assert!(!download_automatic_theme_music(&db, Language::En, &root, 12, |_| panic!("consulta concluída")).unwrap());
        use_automatic_theme_music(&db.lock().unwrap(), Language::En, 12).unwrap();
        assert_eq!(stored(&db), (Some(filename.clone()), "auto".into(), None));
        assert!(!download_automatic_theme_music(&db, Language::En, &root, 12, |_| Ok(false)).unwrap());
        assert!(stored(&db).2.is_some());
        assert_eq!(stored(&db).0, Some(filename));
    }

    #[test]
    fn falha_automatica_conserva_anterior_para_nova_tentativa() {
        let db = database();
        let root = temp_folder("musica-falha");
        download_automatic_theme_music(&db, Language::En, &root, 12, save).unwrap();
        use_automatic_theme_music(&db.lock().unwrap(), Language::En, 12).unwrap();
        let previous = stored(&db);
        for valid in [false, true] {
            assert!(
                download_automatic_theme_music(&db, Language::En, &root, 12, |path| {
                    std::fs::write(path, b"parcial").unwrap();
                    if valid { Ok(true) } else { Err("falha interna com caminho".into()) }
                })
                .is_err()
            );
            assert_eq!(stored(&db), previous);
            assert_eq!(std::fs::read_dir(root.join("12")).unwrap().count(), 1);
        }
    }

    #[test]
    fn download_antigo_nao_sobrepoe_escolha_manual_nem_reativacao_posterior() {
        let db = database();
        let root = temp_folder("musica-corrida");
        let source = root.join("manual.mp3");
        std::fs::write(&source, MP3).unwrap();
        assert!(
            !download_automatic_theme_music(&db, Language::En, &root, 12, |path| {
                pick_theme_music(&db, Language::En, &root, 12, Some(&source)).unwrap();
                save(path)
            })
            .unwrap()
        );
        assert_eq!(stored(&db).1, "manual");
        assert!(!download_automatic_theme_music(&db, Language::En, &root, 12, |_| panic!("manual tem prioridade")).unwrap());
        use_automatic_theme_music(&db.lock().unwrap(), Language::En, 12).unwrap();
        let previous = stored(&db).0;
        assert!(
            !download_automatic_theme_music(&db, Language::En, &root, 12, |path| {
                remove_theme_music(&db, Language::En, &root, 12).unwrap();
                use_automatic_theme_music(&db.lock().unwrap(), Language::En, 12).unwrap();
                save(path)
            })
            .unwrap()
        );
        assert_eq!(stored(&db), (None, "auto".into(), None));
        assert!(!root.join("12").join(previous.unwrap()).exists());
        assert_eq!(std::fs::read_dir(root.join("12")).unwrap().count(), 0);
    }

    #[test]
    fn erro_no_banco_remove_a_copia_nova_e_preserva_a_associacao_anterior() {
        let db = database();
        let root = temp_folder("musica-banco");
        let source = root.join("manual.mp3");
        std::fs::write(&source, MP3).unwrap();
        pick_theme_music(&db, Language::En, &root, 12, Some(&source)).unwrap();
        let previous = stored(&db);
        db.lock()
            .unwrap()
            .execute_batch(
                "CREATE TRIGGER falha_musica BEFORE UPDATE OF theme_music ON games BEGIN SELECT RAISE(ABORT, 'falha'); END;",
            )
            .unwrap();
        assert!(pick_theme_music(&db, Language::En, &root, 12, Some(&source)).is_err());
        assert_eq!(stored(&db), previous);
        assert_eq!(std::fs::read_dir(root.join("12")).unwrap().count(), 1);
    }

    #[test]
    fn protocolo_limita_intervalos_e_rejeita_arquivos_que_nao_sao_copias_internas() {
        let root = temp_folder("musica-protocolo");
        std::fs::create_dir_all(root.join("12")).unwrap();
        let path = root.join("12/theme-music-1.m4a");
        std::fs::File::create(&path).unwrap().set_len(10_000_000).unwrap();
        let response = request(&root, "GET", "/12/theme-music-1.m4a", Some("bytes=4-8"));
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[CONTENT_RANGE], "bytes 4-8/10000000");
        assert_eq!(response.headers()[ACCEPT_RANGES], "bytes");
        assert_eq!(response.body(), &[0; 5]);
        let response = request(&root, "GET", "/12/theme-music-1.m4a", Some("bytes=0-"));
        assert_eq!(response.body().len(), 2 * 1024 * 1024);
        let response = request(&root, "GET", "/12/theme-music-1.m4a", Some("bytes=-5"));
        assert_eq!(response.headers()[CONTENT_RANGE], "bytes 9999995-9999999/10000000");
        let response = request(&root, "HEAD", "/12/theme-music-1.m4a", None);
        assert_eq!(response.headers()[CONTENT_LENGTH], "10000000");
        assert!(response.body().is_empty());
        for range in ["bytes=99999999-", "bytes=8-3", "bytes=-0", "bytes=0-1,4-5", "items=0-1"] {
            assert_eq!(request(&root, "GET", "/12/theme-music-1.m4a", Some(range)).status(), StatusCode::RANGE_NOT_SATISFIABLE);
        }
        for path in [
            "/12/%2e%2e/theme-music-1.m4a",
            "/12/..%5ctheme-music-1.m4a",
            "/12/cover.png",
            "/0/theme-music-1.m4a",
            "/012/theme-music-1.m4a",
        ] {
            assert_eq!(request(&root, "GET", path, None).status(), StatusCode::NOT_FOUND, "{path}");
        }
        assert_eq!(request(&root, "POST", "/12/theme-music-1.m4a", None).status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(theme_music_url(12, "../theme-music-1.mp3"), None);
        assert_eq!(
            theme_music_url(12, "theme-music-1.mp3").as_deref(),
            Some("http://playtrove-music.localhost/12/theme-music-1.mp3")
        );
    }
}
