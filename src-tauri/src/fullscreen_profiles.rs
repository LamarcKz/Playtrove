//! Exportação, importação e restauração somente das preferências da tela cheia do Playtrove.

use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};

use rusqlite::Connection;
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::errors::{AppError, AppResult};
use crate::fullscreen::{self, FullscreenConfig};
use crate::i18n::{Language, text};
use crate::state::AppState;
use crate::test_hooks::{self, TestHooks};
use crate::theme_pack::AnikiPack;

pub const PROFILE_FORMAT: &str = "playtrove-fullscreen-preferences";
pub const PROFILE_VERSION: u8 = 1;
const MAX_PROFILE_BYTES: u64 = 64 * 1024;
static NEXT_EXPORT: AtomicU64 = AtomicU64::new(1);

/// A versão do arquivo só muda quando essa lista é revista. Novos campos do app não são exportados
/// implicitamente: somente preferências explicitamente aprovadas para esse formato.
const FIELDS: [&str; 37] = [
    "theme",
    "startOnLaunch",
    "musicPlayback",
    "musicVolume",
    "startDestination",
    "profileName",
    "profileAvatar",
    "anikiAvatarIndex",
    "controllerIconStyle",
    "inGameOverlayEnabled",
    "inGameOverlayHotkey",
    "startupIntroVideoEnabled",
    "shutdownVideoEnabled",
    "screenSaverEnabled",
    "screenSaverIdleDelayMinutes",
    "screenSaverChangeIntervalSeconds",
    "screenSaverSource",
    "screenSaverAmbientMusicEnabled",
    "screenSaverShowLogo",
    "screenSaverShowInfoCard",
    "screenSaverAnimateBackground",
    "screenSaverUseFadeTransitions",
    "libraryLayout",
    "detailsLayout",
    "colorPreset",
    "dynamicColors",
    "effects",
    "interface",
    "loginScreen",
    "trailers",
    "setupDone",
    "coverRows",
    "showClock",
    "uiSounds",
    "uiSoundsVolume",
    "swapConfirm",
    "playtroveTrailers",
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProfileFile {
    format: String,
    version: u8,
    #[serde(deserialize_with = "unique_config")]
    config: Value,
}

/// O Value comum aceita chaves duplicadas. Aqui elas são erro, antes de qualquer validação/gravação.
fn unique_config<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Value, D::Error> {
    struct ConfigVisitor;
    impl<'de> Visitor<'de> for ConfigVisitor {
        type Value = Value;
        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("objeto de preferências")
        }
        fn visit_map<M: MapAccess<'de>>(self, mut input: M) -> Result<Value, M::Error> {
            let mut fields = Map::new();
            while let Some((key, value)) = input.next_entry::<String, Value>()? {
                if fields.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom("preferência duplicada"));
                }
            }
            Ok(Value::Object(fields))
        }
    }
    deserializer.deserialize_map(ConfigVisitor)
}

/// Banco temporário só em memória, com a mesma tabela mínima usada pelo get_config/set_config.
fn preference_database() -> rusqlite::Result<Connection> {
    let db = Connection::open_in_memory()?;
    db.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")?;
    Ok(db)
}

fn allowed_config(config: &FullscreenConfig) -> serde_json::Result<Value> {
    let serialized = serde_json::to_value(config)?;
    let fields = FIELDS.iter().map(|key| ((*key).to_string(), serialized[*key].clone())).collect();
    Ok(Value::Object(fields))
}

pub fn export_document(db: &Connection, language: Language) -> AppResult<Vec<u8>> {
    let config = allowed_config(&fullscreen::get_config(db))
        .map_err(|_| AppError::text(language, "errors.fullscreenProfiles.export", &[]))?;
    let document = serde_json::json!({"format": PROFILE_FORMAT, "version": PROFILE_VERSION, "config": config});
    let mut bytes =
        serde_json::to_vec_pretty(&document).map_err(|_| AppError::text(language, "errors.fullscreenProfiles.export", &[]))?;
    bytes.push(b'\n');
    Ok(bytes)
}

pub fn import_document(db: &Connection, language: Language, bytes: &[u8], aniki_installed: bool) -> AppResult<FullscreenConfig> {
    let invalid = || AppError::text(language, "errors.fullscreenProfiles.invalid", &[]);
    if bytes.len() as u64 > MAX_PROFILE_BYTES {
        return Err(invalid());
    }
    let file: ProfileFile = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    let fields = file.config.as_object().ok_or_else(invalid)?;
    if file.format != PROFILE_FORMAT
        || file.version != PROFILE_VERSION
        || fields.len() != FIELDS.len()
        || FIELDS.iter().any(|key| !fields.contains_key(*key))
    {
        return Err(invalid());
    }
    // Usa o validador real em um banco descartável antes de tocar nas preferências persistidas.
    let temporary = preference_database().map_err(|_| invalid())?;
    let config = fullscreen::set_config(&temporary, &file.config, language).map_err(|_| invalid())?;
    if config.theme == "aniki" && !aniki_installed {
        return Err(AppError::text(language, "errors.anikiMissing", &[]));
    }
    let patch = allowed_config(&config).map_err(|_| invalid())?;
    fullscreen::set_config(db, &patch, language).map_err(|_| AppError::text(language, "errors.fullscreenProfiles.import", &[]))
}

pub fn reset_config(db: &Connection, language: Language) -> AppResult<FullscreenConfig> {
    let failed = || AppError::text(language, "errors.fullscreenProfiles.reset", &[]);
    let temporary = preference_database().map_err(|_| failed())?;
    let mut config = fullscreen::get_config(&temporary);
    config.theme = fullscreen::get_config(db).theme;
    let patch = allowed_config(&config).map_err(|_| failed())?;
    fullscreen::set_config(db, &patch, language).map_err(|_| failed())
}

fn json_file(path: &Path) -> bool {
    path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
}

pub fn export_to_file(db: &Mutex<Connection>, language: Language, selection: Option<&Path>) -> AppResult<bool> {
    let Some(target) = selection else { return Ok(false) };
    let failed = || AppError::text(language, "errors.fullscreenProfiles.export", &[]);
    if !json_file(target) {
        return Err(failed());
    }
    // O snapshot não mantém a trava do banco enquanto grava no destino escolhido.
    let bytes = export_document(&db.lock().unwrap_or_else(PoisonError::into_inner), language)?;
    let parent = target.parent().ok_or_else(failed)?;
    let sequence = NEXT_EXPORT.fetch_add(1, Ordering::Relaxed);
    let staging = parent.join(format!(".playtrove-fullscreen-{}-{sequence}.tmp", std::process::id()));
    let mut output = OpenOptions::new().create_new(true).write(true).open(&staging).map_err(|_| failed())?;
    let _cleanup = TemporaryExport(staging.clone());
    let written = output.write_all(&bytes).and_then(|_| output.sync_all());
    drop(output);
    written.map_err(|_| failed())?;
    replace_file(&staging, target).map_err(|_| failed())?;
    Ok(true)
}

struct TemporaryExport(PathBuf);
impl Drop for TemporaryExport {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    use windows::Win32::Storage::FileSystem::{MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW};
    use windows::core::PCWSTR;
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: buffers UTF-16 terminados em zero, vivos durante a chamada; origem temporária e destino
    // ficam na mesma pasta/volume. Nenhum movimento é agendado para depois nem feito recursivamente.
    unsafe { MoveFileExW(PCWSTR(source.as_ptr()), PCWSTR(target.as_ptr()), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) }
        .map_err(std::io::Error::other)
}

fn read_selection(selection: &Path, language: Language) -> AppResult<Vec<u8>> {
    let failed = || AppError::text(language, "errors.fullscreenProfiles.import", &[]);
    let invalid = || AppError::text(language, "errors.fullscreenProfiles.invalid", &[]);
    if !json_file(selection) {
        return Err(invalid());
    }
    let file = File::open(selection).map_err(|_| failed())?;
    let metadata = file.metadata().map_err(|_| failed())?;
    if !metadata.is_file() || metadata.len() > MAX_PROFILE_BYTES {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    file.take(MAX_PROFILE_BYTES + 1).read_to_end(&mut bytes).map_err(|_| failed())?;
    if bytes.len() as u64 > MAX_PROFILE_BYTES {
        return Err(invalid());
    }
    Ok(bytes)
}

#[tauri::command(async)]
pub fn fullscreen_profiles_export(app: AppHandle, window: WebviewWindow, state: State<'_, AppState>) -> AppResult<bool> {
    let language = state.language();
    let picked = if cfg!(test) || test_hooks::active() {
        app.state::<TestHooks>().take_open_dialog()
    } else {
        app.dialog()
            .file()
            .set_parent(&window)
            .set_title(text(language, "errors.fullscreenProfiles.exportTitle", &[]))
            .set_file_name(text(language, "errors.fullscreenProfiles.fileName", &[]))
            .add_filter(text(language, "errors.fullscreenProfiles.fileType", &[]), &["json"])
            .blocking_save_file()
            .and_then(|file| file.into_path().ok())
    };
    export_to_file(state.database(), language, picked.as_deref())
}

#[tauri::command(async)]
pub fn fullscreen_profiles_import(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    pack: State<'_, AnikiPack>,
) -> AppResult<Option<FullscreenConfig>> {
    let language = state.language();
    let picked = if cfg!(test) || test_hooks::active() {
        app.state::<TestHooks>().take_open_dialog()
    } else {
        app.dialog()
            .file()
            .set_parent(&window)
            .set_title(text(language, "errors.fullscreenProfiles.importTitle", &[]))
            .add_filter(text(language, "errors.fullscreenProfiles.fileType", &[]), &["json"])
            .blocking_pick_file()
            .and_then(|file| file.into_path().ok())
    };
    let Some(picked) = picked else { return Ok(None) };
    let bytes = read_selection(&picked, language)?;
    let config = import_document(&state.db(), language, &bytes, pack.installed())?;
    let _ = app.emit(fullscreen::CONFIG_EVENT, &config);
    if let Some(overlay) = app.try_state::<crate::game_overlay::GameOverlay>() {
        overlay.refresh();
    }
    Ok(Some(config))
}

#[tauri::command(async)]
pub fn fullscreen_profiles_reset(app: AppHandle, state: State<'_, AppState>) -> AppResult<FullscreenConfig> {
    let config = reset_config(&state.db(), state.language())?;
    let _ = app.emit(fullscreen::CONFIG_EVENT, &config);
    if let Some(overlay) = app.try_state::<crate::game_overlay::GameOverlay>() {
        overlay.refresh();
    }
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fullscreen::{get_config, set_config};
    use crate::settings::{get_setting, set_setting};
    use crate::test_support::{memory_database, temp_folder};
    use serde_json::{Value, json};

    #[test]
    fn exporta_apenas_preferencias_whitelist_sem_outros_settings() {
        let db = memory_database();
        for key in ["igdbClientSecret", "raApiKey", "privatePath", "playHistory", "themeMusicVolume"] {
            set_setting(&db, key, Some("SENTINELA_PRIVADA_NAO_EXPORTAR")).unwrap();
        }
        set_config(&db, &json!({"musicVolume": 45, "detailsLayout": "modern"}), Language::En).unwrap();
        let bytes = export_document(&db, Language::En).unwrap();
        let document: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(document["format"], "playtrove-fullscreen-preferences");
        assert_eq!(document["version"], 1);
        assert_eq!(document["config"], serde_json::to_value(get_config(&db)).unwrap());
        assert_eq!(document.as_object().unwrap().len(), 3);
        assert!(!String::from_utf8(bytes).unwrap().contains("SENTINELA_PRIVADA_NAO_EXPORTAR"));
    }

    #[test]
    fn importa_arquivo_inteiro_e_exige_pacote_aniki_sem_alterar_outros_settings() {
        let source = memory_database();
        let wanted = set_config(
            &source,
            &json!({"theme": "aniki", "musicVolume": 75, "libraryLayout": "list", "profileName": "Teste"}),
            Language::En,
        )
        .unwrap();
        let bytes = export_document(&source, Language::En).unwrap();
        let target = memory_database();
        set_setting(&target, "themeMusicVolume", Some("67")).unwrap();
        let before = get_config(&target);
        assert!(import_document(&target, Language::En, &bytes, false).is_err());
        assert_eq!(get_config(&target), before);
        assert_eq!(import_document(&target, Language::En, &bytes, true).unwrap(), wanted);
        assert_eq!(get_setting(&target, "themeMusicVolume").unwrap().as_deref(), Some("67"));
    }

    #[test]
    fn versao_campos_desconhecidos_ausentes_duplicados_e_valores_invalidos_nao_gravam_parte() {
        let db = memory_database();
        let bytes = export_document(&db, Language::En).unwrap();
        let original: Value = serde_json::from_slice(&bytes).unwrap();
        let before = get_config(&db);
        let mut invalid = Vec::new();
        let mut wrong = original.clone();
        wrong["version"] = json!(2);
        invalid.push(wrong);
        let mut wrong = original.clone();
        wrong["extra"] = json!("secret");
        invalid.push(wrong);
        let mut wrong = original.clone();
        wrong["format"] = json!("Playnite");
        invalid.push(wrong);
        let mut wrong = original.clone();
        wrong["config"]["token"] = json!("secret");
        invalid.push(wrong);
        let mut wrong = original.clone();
        wrong["config"].as_object_mut().unwrap().remove("musicVolume");
        invalid.push(wrong);
        let mut wrong = original.clone();
        wrong["config"]["startOnLaunch"] = json!(true);
        wrong["config"]["musicVolume"] = json!(101);
        invalid.push(wrong);
        for wrong in invalid {
            assert!(import_document(&db, Language::En, &serde_json::to_vec(&wrong).unwrap(), true).is_err());
            assert_eq!(get_config(&db), before);
        }
        let duplicate =
            String::from_utf8(bytes).unwrap().replacen("\"musicVolume\":", "\"musicVolume\": 30, \"musicVolume\":", 1);
        assert!(import_document(&db, Language::En, duplicate.as_bytes(), true).is_err());
        assert!(import_document(&db, Language::En, b"{invalido", true).is_err());
        assert_eq!(get_config(&db), before);
    }

    #[test]
    fn restaurar_preserva_tema_e_restaura_so_a_tela_cheia() {
        let db = memory_database();
        set_setting(&db, "themeMusicVolume", Some("77")).unwrap();
        set_setting(&db, "igdbClientSecret", Some("SEGREDO_SINTETICO")).unwrap();
        set_config(&db, &json!({"theme": "aniki", "startOnLaunch": true, "musicVolume": 88, "profileName": "Teste", "libraryLayout": "vertical"}), Language::En).unwrap();
        let mut expected = get_config(&memory_database());
        expected.theme = "aniki".into();
        assert_eq!(reset_config(&db, Language::En).unwrap(), expected);
        assert_eq!(get_setting(&db, "themeMusicVolume").unwrap().as_deref(), Some("77"));
        assert_eq!(get_setting(&db, "igdbClientSecret").unwrap().as_deref(), Some("SEGREDO_SINTETICO"));
    }

    #[test]
    fn falha_na_transacao_reverte_importacao_e_restauracao() {
        let source = memory_database();
        set_config(&source, &json!({"startOnLaunch": true, "musicVolume": 99}), Language::En).unwrap();
        let bytes = export_document(&source, Language::En).unwrap();
        let target = memory_database();
        set_config(&target, &json!({"libraryLayout": "vertical", "musicVolume": 55}), Language::En).unwrap();
        let before = get_config(&target);
        target.execute_batch("CREATE TRIGGER falha_perfil BEFORE INSERT ON settings WHEN NEW.key = 'fullscreenMusicVolume' BEGIN SELECT RAISE(ABORT, 'falha simulada'); END;").unwrap();
        assert!(import_document(&target, Language::En, &bytes, true).is_err());
        assert_eq!(get_config(&target), before);
        assert!(reset_config(&target, Language::En).is_err());
        assert_eq!(get_config(&target), before);
    }

    #[test]
    fn exportacao_cancelada_ou_com_falha_preserva_destino_e_remove_temporarios() {
        let folder = temp_folder("perfis-exportar");
        let db = std::sync::Mutex::new(memory_database());
        let target = folder.join("preferencias.json");
        std::fs::write(&target, b"anterior").unwrap();
        assert!(!export_to_file(&db, Language::En, None).unwrap());
        assert_eq!(std::fs::read(&target).unwrap(), b"anterior");
        assert!(export_to_file(&db, Language::En, Some(&target)).unwrap());
        let exported = std::fs::read(&target).unwrap();
        assert_eq!(import_document(&memory_database(), Language::En, &exported, false).unwrap(), get_config(&db.lock().unwrap()));
        let directory = folder.join("pasta.json");
        std::fs::create_dir(&directory).unwrap();
        assert!(export_to_file(&db, Language::En, Some(&directory)).is_err());
        assert!(directory.is_dir());
        assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 2);
        std::fs::remove_dir_all(folder).unwrap();
    }
}
