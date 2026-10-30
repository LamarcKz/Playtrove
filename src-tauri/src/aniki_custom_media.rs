//! Imagens locais do perfil e logos personalizadas: cópias internas, seleção explícita e rollback.

use std::fs::{File, OpenOptions};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use image::ImageFormat;
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::errors::{AppError, AppResult};
use crate::fullscreen;
use crate::i18n::{Language, text};
use crate::images::{self, ImageKind, ImagesDir, MAX_IMAGE_BYTES};
use crate::settings::{get_setting, set_setting};
use crate::state::AppState;
use crate::test_hooks::{self, TestHooks};
use crate::validation::to_id;

pub const AVATAR_EVENT: &str = "aniki:avatar-changed";
const MAX_PIXELS: u64 = 40_000_000;
const MAX_SIDE: u32 = 16_384;
static NEXT_IMAGE: AtomicU64 = AtomicU64::new(1);
static MEDIA_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, PartialEq)]
enum ProfileImage {
    Avatar,
    GlobalSplash,
}
impl ProfileImage {
    fn key(self) -> &'static str {
        match self {
            Self::Avatar => "anikiCustomAvatar",
            Self::GlobalSplash => "anikiGlobalSplash",
        }
    }
    fn prefix(self) -> &'static str {
        match self {
            Self::Avatar => "avatar-local-",
            Self::GlobalSplash => "splash-global-",
        }
    }
}

fn failed(language: Language, key: &str) -> AppError {
    AppError::text(language, &format!("errors.anikiCustomMedia.{key}"), &[])
}

pub fn get_avatar(db: &Mutex<Connection>, language: Language, images: &Path) -> AppResult<Option<String>> {
    get_profile(db, language, images, ProfileImage::Avatar)
}
pub fn pick_avatar(
    db: &Mutex<Connection>,
    language: Language,
    images: &Path,
    source: Option<&Path>,
) -> AppResult<Option<String>> {
    pick_profile(db, language, images, source, ProfileImage::Avatar)
}
pub fn remove_avatar(db: &Mutex<Connection>, language: Language, images: &Path) -> AppResult<()> {
    remove_profile(db, language, images, ProfileImage::Avatar)
}
pub fn get_global_splash(db: &Mutex<Connection>, language: Language, images: &Path) -> AppResult<Option<String>> {
    get_profile(db, language, images, ProfileImage::GlobalSplash)
}
pub fn pick_global_splash(
    db: &Mutex<Connection>,
    language: Language,
    images: &Path,
    source: Option<&Path>,
) -> AppResult<Option<String>> {
    pick_profile(db, language, images, source, ProfileImage::GlobalSplash)
}
pub fn remove_global_splash(db: &Mutex<Connection>, language: Language, images: &Path) -> AppResult<()> {
    remove_profile(db, language, images, ProfileImage::GlobalSplash)
}

fn get_profile(db: &Mutex<Connection>, language: Language, images: &Path, kind: ProfileImage) -> AppResult<Option<String>> {
    let _guard = MEDIA_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let name =
        get_setting(&db.lock().unwrap_or_else(PoisonError::into_inner), kind.key()).map_err(|_| failed(language, "read"))?;
    let Some(name) = name.filter(|name| valid_name(name, kind.prefix())) else { return Ok(None) };
    let directory = directory(images, "profile", false).map_err(|_| failed(language, "read"))?;
    Ok(directory
        .filter(|directory| owned_file(directory, &name).is_some())
        .map(|_| images::images_url(&format!("profile/{name}"))))
}

fn pick_profile(
    db: &Mutex<Connection>,
    language: Language,
    images: &Path,
    source: Option<&Path>,
    kind: ProfileImage,
) -> AppResult<Option<String>> {
    let Some(source) = source else { return Ok(None) };
    let _guard = MEDIA_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let (bytes, extension) = read_image(source).ok_or_else(|| failed(language, "invalid"))?;
    let directory =
        directory(images, "profile", true).map_err(|_| failed(language, "save"))?.ok_or_else(|| failed(language, "save"))?;
    let (mut pending, name) = publish(&directory, kind.prefix(), &bytes, extension).map_err(|_| failed(language, "save"))?;
    let db = db.lock().unwrap_or_else(PoisonError::into_inner);
    let old = get_setting(&db, kind.key()).map_err(|_| failed(language, "save"))?;
    let transaction = db.unchecked_transaction().map_err(|_| failed(language, "save"))?;
    set_setting(&transaction, kind.key(), Some(&name)).map_err(|_| failed(language, "save"))?;
    if kind == ProfileImage::Avatar {
        set_setting(&transaction, "fullscreenProfileAvatar", Some("custom")).map_err(|_| failed(language, "save"))?;
        set_setting(&transaction, "fullscreenAnikiAvatarIndex", None).map_err(|_| failed(language, "save"))?;
    }
    transaction.commit().map_err(|_| failed(language, "save"))?;
    pending.0.clear();
    cleanup(&directory, old.as_deref().filter(|name| valid_name(name, kind.prefix())));
    Ok(Some(images::images_url(&format!("profile/{name}"))))
}

fn remove_profile(db: &Mutex<Connection>, language: Language, images: &Path, kind: ProfileImage) -> AppResult<()> {
    let _guard = MEDIA_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let db = db.lock().unwrap_or_else(PoisonError::into_inner);
    let old = get_setting(&db, kind.key()).map_err(|_| failed(language, "remove"))?;
    if old.as_ref().is_some_and(|name| !valid_name(name, kind.prefix())) {
        return Err(failed(language, "invalid"));
    }
    let directory = directory(images, "profile", false).map_err(|_| failed(language, "remove"))?;
    let transaction = db.unchecked_transaction().map_err(|_| failed(language, "remove"))?;
    set_setting(&transaction, kind.key(), None).map_err(|_| failed(language, "remove"))?;
    if kind == ProfileImage::Avatar
        && get_setting(&transaction, "fullscreenProfileAvatar").map_err(|_| failed(language, "remove"))?.as_deref()
            == Some("custom")
    {
        set_setting(&transaction, "fullscreenProfileAvatar", Some("gamepad")).map_err(|_| failed(language, "remove"))?;
        set_setting(&transaction, "fullscreenAnikiAvatarIndex", None).map_err(|_| failed(language, "remove"))?;
    }
    transaction.commit().map_err(|_| failed(language, "remove"))?;
    if let Some(directory) = directory {
        cleanup(&directory, old.as_deref());
    }
    Ok(())
}

fn game_prefix(kind: ImageKind) -> &'static str {
    match kind {
        ImageKind::Logo => "logo-local-",
        ImageKind::Cover => "cover-local-",
        ImageKind::Background => "background-local-",
    }
}

fn game_logo(db: &Connection, language: Language, game_id: i64) -> AppResult<Option<String>> {
    if game_id <= 0 {
        return Err(AppError::text(language, "errors.gameNotFound", &[]));
    }
    db.query_row("SELECT logo_image FROM games WHERE id=?1", [game_id], |row| row.get::<_, Option<String>>(0))
        .optional()?
        .ok_or_else(|| AppError::text(language, "errors.gameNotFound", &[]))
}

pub fn pick_logo(
    db: &Mutex<Connection>,
    language: Language,
    images: &Path,
    game_id: i64,
    source: Option<&Path>,
) -> AppResult<bool> {
    let _guard = MEDIA_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    game_logo(&db.lock().unwrap_or_else(PoisonError::into_inner), language, game_id)?;
    let Some(source) = source else { return Ok(false) };
    let (bytes, extension) = read_image(source).ok_or_else(|| failed(language, "invalid"))?;
    let directory = directory(images, &game_id.to_string(), true)
        .map_err(|_| failed(language, "save"))?
        .ok_or_else(|| failed(language, "save"))?;
    let prefix = game_prefix(ImageKind::Logo);
    let (mut pending, name) = publish(&directory, prefix, &bytes, extension).map_err(|_| failed(language, "save"))?;
    let db = db.lock().unwrap_or_else(PoisonError::into_inner);
    let old = game_logo(&db, language, game_id)?;
    let transaction = db.unchecked_transaction().map_err(|_| failed(language, "save"))?;
    transaction
        .execute(
            "UPDATE games SET logo_image=?1, logo_checked_at=?2 WHERE id=?3",
            (&name, crate::dates::iso(chrono::Utc::now()), game_id),
        )
        .map_err(|_| failed(language, "save"))?;
    transaction.commit().map_err(|_| failed(language, "save"))?;
    pending.0.clear();
    cleanup(&directory, old.as_deref().filter(|name| valid_name(name, prefix)));
    Ok(true)
}

pub fn remove_logo(db: &Mutex<Connection>, language: Language, images: &Path, game_id: i64) -> AppResult<()> {
    let _guard = MEDIA_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let db = db.lock().unwrap_or_else(PoisonError::into_inner);
    let old = game_logo(&db, language, game_id)?;
    let Some(old) = old.filter(|name| valid_name(name, game_prefix(ImageKind::Logo))) else { return Ok(()) };
    let directory = directory(images, &game_id.to_string(), false).map_err(|_| failed(language, "remove"))?;
    let automatic = directory.as_ref().and_then(|directory| {
        ["png", "jpg", "jpeg", "webp", "gif", "ico"]
            .into_iter()
            .map(|extension| format!("logo.{extension}"))
            .find(|name| owned_file(directory, name).is_some())
    });
    let transaction = db.unchecked_transaction().map_err(|_| failed(language, "remove"))?;
    transaction
        .execute(
            "UPDATE games SET logo_image=?1, logo_checked_at=?2 WHERE id=?3",
            (automatic, crate::dates::iso(chrono::Utc::now()), game_id),
        )
        .map_err(|_| failed(language, "remove"))?;
    transaction.commit().map_err(|_| failed(language, "remove"))?;
    if let Some(directory) = directory {
        cleanup(&directory, Some(&old));
    }
    Ok(())
}

fn read_image(source: &Path) -> Option<(Vec<u8>, &'static str)> {
    let (format, extension) = match source.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => (ImageFormat::Png, "png"),
        "jpg" | "jpeg" => (ImageFormat::Jpeg, "jpg"),
        "webp" => (ImageFormat::WebP, "webp"),
        _ => return None,
    };
    let file = File::open(source).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > MAX_IMAGE_BYTES as u64 {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES as u64 + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() > MAX_IMAGE_BYTES || image::guess_format(&bytes).ok()? != format {
        return None;
    }
    let (width, height) = image::ImageReader::with_format(Cursor::new(&bytes), format).into_dimensions().ok()?;
    if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return None;
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(MAX_PIXELS * 8);
    let mut reader = image::ImageReader::with_format(Cursor::new(&bytes), format);
    reader.limits(limits);
    reader.decode().ok()?;
    Some((bytes, extension))
}

fn directory(root: &Path, name: &str, create: bool) -> std::io::Result<Option<PathBuf>> {
    if !root.try_exists()? {
        if !create {
            return Ok(None);
        }
        std::fs::create_dir_all(root)?;
    }
    let root = root.canonicalize()?;
    let directory = root.join(name);
    if !directory.try_exists()? {
        if !create {
            return Ok(None);
        }
        std::fs::create_dir(&directory)?;
    }
    if directory.canonicalize()? != directory || !directory.is_dir() {
        return Err(std::io::Error::other("pasta de imagem redirecionada"));
    }
    Ok(Some(directory))
}

fn valid_name(name: &str, prefix: &str) -> bool {
    let Some((stem, extension)) = name.rsplit_once('.') else { return false };
    let Some((stamp, sequence)) = stem.strip_prefix(prefix).and_then(|tail| tail.split_once('-')) else { return false };
    matches!(extension, "png" | "jpg" | "webp")
        && !stamp.is_empty()
        && !sequence.is_empty()
        && stamp.bytes().all(|byte| byte.is_ascii_digit())
        && sequence.bytes().all(|byte| byte.is_ascii_digit())
}

fn owned_file(directory: &Path, name: &str) -> Option<PathBuf> {
    let path = directory.join(name);
    let canonical = path.canonicalize().ok()?;
    (canonical == path && canonical.is_file()).then_some(canonical)
}

struct PendingFile(Vec<PathBuf>);
impl Drop for PendingFile {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn publish(directory: &Path, prefix: &str, bytes: &[u8], extension: &str) -> std::io::Result<(PendingFile, String)> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let sequence = NEXT_IMAGE.fetch_add(1, Ordering::Relaxed);
    let name = format!("{prefix}{stamp}-{sequence}.{extension}");
    let staging = directory.join(format!(".pending-local-{stamp}-{sequence}"));
    let target = directory.join(&name);
    let mut pending = PendingFile(vec![staging.clone()]);
    let mut file = OpenOptions::new().write(true).create_new(true).open(&staging)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(staging, &target)?;
    pending.0.push(target);
    Ok((pending, name))
}

fn cleanup(directory: &Path, name: Option<&str>) {
    if let Some(path) = name.and_then(|name| owned_file(directory, name)) {
        let _ = std::fs::remove_file(path);
    }
}

fn pick_image(app: &AppHandle, window: &WebviewWindow, language: Language, title: &str) -> Option<PathBuf> {
    if cfg!(test) || test_hooks::active() {
        return app.state::<TestHooks>().take_open_dialog();
    }
    app.dialog()
        .file()
        .set_parent(window)
        .set_title(text(language, title, &[]))
        .add_filter(text(language, "errors.anikiCustomMedia.fileType", &[]), &["png", "jpg", "jpeg", "webp"])
        .blocking_pick_file()
        .and_then(|file| file.into_path().ok())
}

#[tauri::command(async)]
pub fn aniki_custom_media_get_avatar(state: State<'_, AppState>, images: State<'_, ImagesDir>) -> AppResult<Option<String>> {
    get_avatar(state.database(), state.language(), &images.0)
}
#[tauri::command(async)]
pub fn aniki_custom_media_pick_avatar(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
) -> AppResult<Option<String>> {
    let source = pick_image(&app, &window, state.language(), "errors.anikiCustomMedia.avatarTitle");
    let url = pick_avatar(state.database(), state.language(), &images.0, source.as_deref())?;
    if url.is_some() {
        let _ = app.emit(fullscreen::CONFIG_EVENT, fullscreen::get_config(&state.db()));
        let _ = app.emit(AVATAR_EVENT, &url);
    }
    Ok(url)
}
#[tauri::command(async)]
pub fn aniki_custom_media_remove_avatar(
    app: AppHandle,
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
) -> AppResult<()> {
    remove_avatar(state.database(), state.language(), &images.0)?;
    let _ = app.emit(fullscreen::CONFIG_EVENT, fullscreen::get_config(&state.db()));
    let _ = app.emit(AVATAR_EVENT, Option::<String>::None);
    Ok(())
}
#[tauri::command(async)]
pub fn aniki_custom_media_get_global_splash(
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
) -> AppResult<Option<String>> {
    get_global_splash(state.database(), state.language(), &images.0)
}
#[tauri::command(async)]
pub fn aniki_custom_media_pick_global_splash(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
) -> AppResult<Option<String>> {
    let source = pick_image(&app, &window, state.language(), "errors.anikiCustomMedia.globalSplashTitle");
    pick_global_splash(state.database(), state.language(), &images.0, source.as_deref())
}
#[tauri::command(async)]
pub fn aniki_custom_media_remove_global_splash(state: State<'_, AppState>, images: State<'_, ImagesDir>) -> AppResult<()> {
    remove_global_splash(state.database(), state.language(), &images.0)
}
#[tauri::command(async)]
pub fn aniki_custom_media_pick_logo(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
    game_id: Value,
) -> AppResult<bool> {
    let game_id = to_id(&game_id, state.language())?;
    game_logo(&state.db(), state.language(), game_id)?;
    let source = pick_image(&app, &window, state.language(), "errors.anikiCustomMedia.logoTitle");
    let changed = pick_logo(state.database(), state.language(), &images.0, game_id, source.as_deref())?;
    if changed {
        let _ = app.emit("library:changed", ());
    }
    Ok(changed)
}
#[tauri::command(async)]
pub fn aniki_custom_media_remove_logo(
    app: AppHandle,
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
    game_id: Value,
) -> AppResult<()> {
    let game_id = to_id(&game_id, state.language())?;
    remove_logo(state.database(), state.language(), &images.0, game_id)?;
    let _ = app.emit("library:changed", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{get_setting, set_setting};
    use crate::test_support::{memory_database, temp_folder};
    use std::path::PathBuf;
    const LANG: Language = Language::En;

    fn database() -> Mutex<Connection> {
        let db = memory_database();
        db.execute("INSERT INTO games (id, title, status_id, added_at) VALUES (12, 'Jogo', 1, '2026-01-01')", []).unwrap();
        Mutex::new(db)
    }

    fn image(folder: &Path, name: &str, format: image::ImageFormat) -> PathBuf {
        let source = folder.join(name);
        image::DynamicImage::new_rgb8(24, 16).save_with_format(&source, format).unwrap();
        source
    }

    fn setting(db: &Mutex<Connection>, key: &str) -> Option<String> {
        get_setting(&db.lock().unwrap(), key).unwrap()
    }

    fn logo(db: &Mutex<Connection>) -> Option<String> {
        db.lock().unwrap().query_row("SELECT logo_image FROM games WHERE id=12", [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn avatar_copiado_ativa_modo_custom_e_preserva_original_e_escolha_nativa() {
        let folder = temp_folder("avatar-local");
        let root = folder.join("images");
        let db = database();
        let source = image(&folder, "foto.png", image::ImageFormat::Png);
        let original = std::fs::read(&source).unwrap();
        let url = pick_avatar(&db, LANG, &root, Some(&source)).unwrap().unwrap();
        assert!(url.starts_with("http://playtrove-img.localhost/profile/avatar-local-"));
        assert!(!url.contains("foto"));
        assert_eq!(get_avatar(&db, LANG, &root).unwrap(), Some(url.clone()));
        assert_eq!(setting(&db, "fullscreenProfileAvatar").as_deref(), Some("custom"));
        assert_eq!(setting(&db, "fullscreenAnikiAvatarIndex"), None);
        set_setting(&db.lock().unwrap(), "fullscreenProfileAvatar", Some("star")).unwrap();
        assert_eq!(get_avatar(&db, LANG, &root).unwrap(), Some(url));
        remove_avatar(&db, LANG, &root).unwrap();
        assert_eq!(setting(&db, "fullscreenProfileAvatar").as_deref(), Some("star"));
        assert_eq!(get_avatar(&db, LANG, &root).unwrap(), None);
        assert_eq!(std::fs::read(&source).unwrap(), original);
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn cancelar_nao_muda_preferencias_nem_cria_copias() {
        let folder = temp_folder("midia-custom-cancelar");
        let root = folder.join("images");
        let db = database();
        set_setting(&db.lock().unwrap(), "fullscreenProfileAvatar", Some("crown")).unwrap();
        assert_eq!(pick_avatar(&db, LANG, &root, None).unwrap(), None);
        assert_eq!(pick_global_splash(&db, LANG, &root, None).unwrap(), None);
        assert!(!pick_logo(&db, LANG, &root, 12, None).unwrap());
        assert_eq!(setting(&db, "fullscreenProfileAvatar").as_deref(), Some("crown"));
        assert!(!root.exists());
        assert!(pick_logo(&db, LANG, &root, 999, None).is_err());
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn assinatura_extensao_tamanho_e_imagem_incompleta_nao_substituem_avatar() {
        let folder = temp_folder("midia-custom-invalida");
        let root = folder.join("images");
        let db = database();
        let source = image(&folder, "valida.webp", image::ImageFormat::WebP);
        let previous = pick_avatar(&db, LANG, &root, Some(&source)).unwrap();
        let mismatched = image(&folder, "enganosa.png", image::ImageFormat::Jpeg);
        let broken = folder.join("quebrada.png");
        std::fs::write(&broken, b"\x89PNG\r\n\x1a\n").unwrap();
        let huge = folder.join("grande.png");
        std::fs::File::create(&huge).unwrap().set_len(crate::images::MAX_IMAGE_BYTES as u64 + 1).unwrap();
        let svg = folder.join("vetor.svg");
        std::fs::write(&svg, "<svg/>").unwrap();
        let dimensions = folder.join("dimensoes.png");
        image::DynamicImage::new_rgb8(MAX_SIDE + 1, 1).save_with_format(&dimensions, image::ImageFormat::Png).unwrap();
        for invalid in [&mismatched, &broken, &huge, &svg, &dimensions] {
            assert!(pick_avatar(&db, LANG, &root, Some(invalid)).is_err());
            assert_eq!(get_avatar(&db, LANG, &root).unwrap(), previous);
        }
        assert_eq!(std::fs::read_dir(root.join("profile")).unwrap().count(), 1);
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn falha_no_banco_desfaz_publicacao_sem_apagar_avatar_anterior() {
        let folder = temp_folder("avatar-rollback");
        let root = folder.join("images");
        let db = database();
        let source = image(&folder, "primeira.png", image::ImageFormat::Png);
        let previous = pick_avatar(&db, LANG, &root, Some(&source)).unwrap();
        db.lock().unwrap().execute_batch("CREATE TRIGGER falha_avatar BEFORE UPDATE ON settings WHEN NEW.key='anikiCustomAvatar' BEGIN SELECT RAISE(ABORT,'falha simulada'); END;").unwrap();
        let other = image(&folder, "segunda.jpg", image::ImageFormat::Jpeg);
        assert!(pick_avatar(&db, LANG, &root, Some(&other)).is_err());
        assert_eq!(get_avatar(&db, LANG, &root).unwrap(), previous);
        assert_eq!(std::fs::read_dir(root.join("profile")).unwrap().count(), 1);
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn splash_global_tem_copia_propria_e_remocao_nao_muda_avatar() {
        let folder = temp_folder("splash-global");
        let root = folder.join("images");
        let db = database();
        let source = image(&folder, "fundo.png", image::ImageFormat::Png);
        let avatar = pick_avatar(&db, LANG, &root, Some(&source)).unwrap();
        let splash = pick_global_splash(&db, LANG, &root, Some(&source)).unwrap();
        assert!(splash.as_ref().unwrap().contains("/profile/splash-global-"));
        assert_eq!(get_global_splash(&db, LANG, &root).unwrap(), splash);
        remove_global_splash(&db, LANG, &root).unwrap();
        assert_eq!(get_global_splash(&db, LANG, &root).unwrap(), None);
        assert_eq!(get_avatar(&db, LANG, &root).unwrap(), avatar);
        assert!(source.exists());
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn logo_personalizada_substitui_atomicamente_e_remover_revela_automatica() {
        let folder = temp_folder("logo-local");
        let root = folder.join("images");
        std::fs::create_dir_all(root.join("12")).unwrap();
        let automatic = image(&root.join("12"), "logo.png", image::ImageFormat::Png);
        let db = database();
        db.lock().unwrap().execute("UPDATE games SET logo_image='logo.png' WHERE id=12", []).unwrap();
        let source = image(&folder, "minha-logo.jpg", image::ImageFormat::Jpeg);
        assert!(pick_logo(&db, LANG, &root, 12, Some(&source)).unwrap());
        let current = logo(&db).unwrap();
        assert!(current.starts_with("logo-local-") && current.ends_with(".jpg"));
        assert!(automatic.exists());
        db.lock()
            .unwrap()
            .execute_batch(
                "CREATE TRIGGER falha_logo BEFORE UPDATE OF logo_image ON games BEGIN SELECT RAISE(ABORT,'falha simulada'); END;",
            )
            .unwrap();
        assert!(pick_logo(&db, LANG, &root, 12, Some(&source)).is_err());
        assert_eq!(logo(&db), Some(current.clone()));
        assert_eq!(std::fs::read_dir(root.join("12")).unwrap().count(), 2);
        db.lock().unwrap().execute_batch("DROP TRIGGER falha_logo").unwrap();
        remove_logo(&db, LANG, &root, 12).unwrap();
        assert_eq!(logo(&db).as_deref(), Some("logo.png"));
        assert!(!root.join("12").join(current).exists());
        remove_logo(&db, LANG, &root, 12).unwrap();
        assert!(automatic.exists() && source.exists());
        assert!(remove_logo(&db, LANG, &root, 999).is_err());
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn ponteiro_adulterado_nao_vira_url_nem_remove_arquivo_externo() {
        let folder = temp_folder("avatar-caminho");
        let root = folder.join("images");
        let db = database();
        let outside = image(&folder, "fora.png", image::ImageFormat::Png);
        set_setting(&db.lock().unwrap(), "anikiCustomAvatar", Some("../../fora.png")).unwrap();
        assert_eq!(get_avatar(&db, LANG, &root).unwrap(), None);
        assert!(remove_avatar(&db, LANG, &root).is_err());
        assert!(outside.exists());
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn falha_em_remover_preserva_ponteiro_e_copia_ativa() {
        let folder = temp_folder("avatar-remocao-rollback");
        let root = folder.join("images");
        let db = database();
        let source = image(&folder, "avatar.png", image::ImageFormat::Png);
        let previous = pick_avatar(&db, LANG, &root, Some(&source)).unwrap();
        db.lock().unwrap().execute_batch("CREATE TRIGGER falha_remover BEFORE UPDATE ON settings WHEN NEW.key='anikiCustomAvatar' AND NEW.value IS NULL BEGIN SELECT RAISE(ABORT,'falha simulada'); END;").unwrap();
        assert!(remove_avatar(&db, LANG, &root).is_err());
        assert_eq!(get_avatar(&db, LANG, &root).unwrap(), previous);
        assert_eq!(std::fs::read_dir(root.join("profile")).unwrap().count(), 1);
        assert_eq!(setting(&db, "fullscreenProfileAvatar").as_deref(), Some("custom"));
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn falha_do_diretorio_nao_ativa_custom_e_logo_sem_automatica_volta_ao_texto() {
        let folder = temp_folder("midia-custom-disco");
        let root = folder.join("images");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("profile"), "não é uma pasta").unwrap();
        let db = database();
        let source = image(&folder, "imagem.jpg", image::ImageFormat::Jpeg);
        assert!(pick_avatar(&db, LANG, &root, Some(&source)).is_err());
        assert_eq!(setting(&db, "fullscreenProfileAvatar"), None);
        assert!(pick_logo(&db, LANG, &root, 12, Some(&source)).unwrap());
        remove_logo(&db, LANG, &root, 12).unwrap();
        assert_eq!(logo(&db), None);
        assert_eq!(std::fs::read_dir(root.join("12")).unwrap().count(), 0);
        assert!(source.exists());
        std::fs::remove_dir_all(folder).unwrap();
    }
}
