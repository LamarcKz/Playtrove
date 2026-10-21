//! Os comandos que a interface chama (window.api, pela ponte de src/renderer/lib/tauriApi.ts): os
//! mesmos canais do app em Electron (src/main/ipc.ts), um por função. Os valores chegam crus (JSON) e
//! são conferidos em validation.rs antes de usar; o erro volta como a mensagem que a tela mostra.

use std::path::Path;

use chrono::{Local, Utc};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::emulators::{self, EmulatorId, EmulatorInfo, RetroArchCore};
use crate::errors::{AppError, AppResult};
use crate::i18n::{Language, save_language, text};
use crate::launcher::{Launcher, SystemStarter};
use crate::library::{self, LibrarySnapshot, Status};
use crate::metadata::credentials::{self, MetadataConfig};
use crate::metadata::queue::MetadataProgress;
use crate::metadata::service::MetadataService;
use crate::playtime_sync::{AFTER_GAME_DELAY, PlaytimeSync};
use crate::rom_scanner::{self, RomFolder, ScanResult};
use crate::secrets::Secrets;
use crate::state::AppState;
use crate::stats::{ACTIVITY_DAYS, DailyPlaytime, get_daily_playtime};
use crate::system_sources::SystemSources;
use crate::test_mode::test_mode;
use crate::validation::{
    to_bool, to_emulator_id, to_evaluation, to_id, to_id_list, to_igdb_credentials, to_optional_id, to_order, to_rom_folder,
    to_secret, to_status_rules, to_text,
};
use crate::window::WindowState;

/// O aviso de que algo mudou na biblioteca: a interface pede os dados de novo.
const LIBRARY_CHANGED_EVENT: &str = "library:changed";
/// O aviso dos jogos abertos agora (quando um abre ou fecha).
const GAMES_RUNNING_EVENT: &str = "games:running";

pub fn notify_library_changed(app: &AppHandle) {
    let _ = app.emit(LIBRARY_CHANGED_EVENT, ());
}

fn notify_running(app: &AppHandle) {
    let _ = app.emit(GAMES_RUNNING_EVENT, app.state::<Launcher>().running());
}

/// Os testes automáticos desligam a detecção de emuladores, para não depender do que está instalado no PC.
pub fn emulator_detection_enabled() -> bool {
    !test_mode().skip_emulator_detection
}

fn path_exists(path: &str) -> bool {
    Path::new(path).exists()
}

// ---------------------------------------------------------------- app e janela

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn app_get_language(state: State<'_, AppState>) -> Language {
    state.language()
}

/// Troca o idioma (Configurações → Geral) e guarda a escolha. Os nomes dos status padrão mudam junto,
/// então a interface pede a biblioteca de novo.
#[tauri::command]
pub fn app_set_language(app: AppHandle, state: State<'_, AppState>, language: Value) -> AppResult<()> {
    let language = language
        .as_str()
        .and_then(Language::from_id)
        .ok_or_else(|| AppError::text(state.language(), "errors.invalidLanguage", &[]))?;
    save_language(&state.db(), language)?;
    state.set_language(language);
    notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn window_minimize(window: WebviewWindow) -> AppResult<()> {
    Ok(window.minimize()?)
}

/// Maximiza a janela ou, se ela já estiver maximizada, restaura o tamanho anterior.
#[tauri::command]
pub fn window_toggle_maximize(window: WebviewWindow) -> AppResult<()> {
    Ok(if window.is_maximized()? { window.unmaximize() } else { window.maximize() }?)
}

#[tauri::command]
pub fn window_close(window: WebviewWindow) -> AppResult<()> {
    Ok(window.close()?)
}

#[tauri::command]
pub fn window_get_state(window: WebviewWindow) -> AppResult<WindowState> {
    Ok(WindowState { is_maximized: window.is_maximized()? })
}

// ---------------------------------------------------------------- biblioteca e jogos

/// Jogos, status e regras, de uma vez.
#[tauri::command]
pub fn library_get(state: State<'_, AppState>) -> AppResult<LibrarySnapshot> {
    Ok(library::get_library(&state.db(), state.language())?)
}

#[tauri::command]
pub fn games_set_status(app: AppHandle, state: State<'_, AppState>, game_id: Value, status_id: Value) -> AppResult<()> {
    let language = state.language();
    library::set_game_status(&state.db(), language, to_id(&game_id, language)?, to_id(&status_id, language)?)?;
    notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn games_set_favorite(app: AppHandle, state: State<'_, AppState>, game_id: Value, favorite: Value) -> AppResult<()> {
    let language = state.language();
    let favorite = to_bool(&favorite, language)?;
    library::set_game_favorite(&state.db(), language, to_id(&game_id, language)?, favorite)?;
    notify_library_changed(&app);
    Ok(())
}

/// Salva a nota, a dificuldade e a análise do jogo (só as partes enviadas).
#[tauri::command]
pub fn games_set_evaluation(app: AppHandle, state: State<'_, AppState>, game_id: Value, evaluation: Value) -> AppResult<()> {
    let language = state.language();
    let game_id = to_id(&game_id, language)?;
    library::save_game_evaluation(&state.db(), language, game_id, to_evaluation(&evaluation, language)?, Utc::now())?;
    notify_library_changed(&app);
    Ok(())
}

// ---------------------------------------------------------------- status (Configurações → Status)

#[tauri::command]
pub fn statuses_create(app: AppHandle, state: State<'_, AppState>, name: Value) -> AppResult<Status> {
    let language = state.language();
    let status = library::create_status(&state.db(), language, &to_text(&name, language)?)?;
    notify_library_changed(&app);
    Ok(status)
}

#[tauri::command]
pub fn statuses_rename(app: AppHandle, state: State<'_, AppState>, id: Value, name: Value) -> AppResult<()> {
    let language = state.language();
    library::rename_status(&state.db(), language, to_id(&id, language)?, &to_text(&name, language)?)?;
    notify_library_changed(&app);
    Ok(())
}

/// `ids` tem todos os status, na ordem nova.
#[tauri::command]
pub fn statuses_reorder(app: AppHandle, state: State<'_, AppState>, ids: Value) -> AppResult<()> {
    let language = state.language();
    library::reorder_statuses(&state.db(), language, &to_order(&ids, language)?)?;
    notify_library_changed(&app);
    Ok(())
}

/// Apaga o status e passa os jogos dele para `move_to_id`.
#[tauri::command]
pub fn statuses_remove(app: AppHandle, state: State<'_, AppState>, id: Value, move_to_id: Value) -> AppResult<()> {
    let language = state.language();
    library::delete_status(&state.db(), language, to_id(&id, language)?, to_id(&move_to_id, language)?)?;
    notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn statuses_set_rules(app: AppHandle, state: State<'_, AppState>, rules: Value) -> AppResult<()> {
    let language = state.language();
    let (new_game_status_id, first_play_status_id) = to_status_rules(&rules, language)?;
    library::set_status_rules(&state.db(), language, new_game_status_id, first_play_status_id)?;
    notify_library_changed(&app);
    Ok(())
}

// ---------------------------------------------------------------- jogar

/// Abre o jogo no emulador e avisa a interface quando ele abre e quando fecha. Quando o emulador fecha,
/// registra o tempo jogado e relê o tempo que ele mesmo registrou (ele grava ao fechar).
#[tauri::command]
pub fn games_play(app: AppHandle, state: State<'_, AppState>, launcher: State<'_, Launcher>, game_id: Value) -> AppResult<()> {
    let language = state.language();
    let game_id = to_id(&game_id, language)?;
    let handle = app.clone();
    let on_exit = Box::new(move |session: crate::launcher::PlayedSession| {
        let state = handle.state::<AppState>();
        let recorded =
            library::record_play_session(&state.db(), state.language(), session.game_id, session.seconds, session.ended_at);
        if let Err(error) = recorded {
            eprintln!("[jogar] não deu para registrar o tempo jogado: {error}");
        }
        notify_running(&handle);
        notify_library_changed(&handle);
        handle.state::<PlaytimeSync>().run_after(AFTER_GAME_DELAY);
    });
    launcher.launch(&state.db(), language, game_id, &SystemStarter, on_exit)?;
    notify_running(&app);
    notify_library_changed(&app);
    Ok(())
}

/// Ids dos jogos abertos agora.
#[tauri::command]
pub fn games_get_running(launcher: State<'_, Launcher>) -> Vec<i64> {
    launcher.running()
}

/// Abre o Explorador de Arquivos com a ROM do jogo selecionada.
#[tauri::command]
pub fn games_show_rom(state: State<'_, AppState>, game_id: Value) -> AppResult<()> {
    let language = state.language();
    let info = library::get_launch_info(&state.db(), language, to_id(&game_id, language)?)?;
    let rom_path = info.rom_path.ok_or_else(|| AppError::text(language, "errors.noRom", &[]))?;
    if !path_exists(&rom_path) {
        return Err(AppError::text(language, "errors.romNotFound", &[&rom_path]));
    }
    // Como no Electron: se o Explorador não abrir, não há o que avisar.
    let _ = tauri_plugin_opener::reveal_item_in_dir(&rom_path);
    Ok(())
}

// ---------------------------------------------------------------- emuladores

/// Os emuladores. Na primeira vez em cada execução, procura sozinho os que ainda não têm executável.
#[tauri::command(async)]
pub fn emulators_list(state: State<'_, AppState>) -> AppResult<Vec<EmulatorInfo>> {
    if emulator_detection_enabled() && state.first_emulator_list() {
        emulators::fill_missing_emulators(&state.db(), &SystemSources::new())?;
    }
    Ok(emulators::list_emulators(&state.db(), &path_exists)?)
}

/// Procura de novo os emuladores que ainda não foram encontrados.
#[tauri::command(async)]
pub fn emulators_detect(state: State<'_, AppState>) -> AppResult<Vec<EmulatorInfo>> {
    if emulator_detection_enabled() {
        emulators::fill_missing_emulators(&state.db(), &SystemSources::new())?;
    }
    Ok(emulators::list_emulators(&state.db(), &path_exists)?)
}

/// Abre a janela do Windows para escolher o executável do emulador.
#[tauri::command(async)]
pub fn emulators_pick_path(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: Value,
) -> AppResult<Vec<EmulatorInfo>> {
    let language = state.language();
    let emulator = to_emulator_id(&id, language)?;
    let name = emulators::get_preset(emulator).name;
    let picked = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(text(language, "dialogs.pickEmulator", &[name]))
        .add_filter(text(language, "dialogs.programs", &[]), &["exe"])
        .blocking_pick_file();
    if let Some(path) = picked.and_then(|file| file.into_path().ok()) {
        emulators::set_emulator_path(&state.db(), emulator, &path.to_string_lossy())?;
    }
    Ok(emulators::list_emulators(&state.db(), &path_exists)?)
}

/// Os cores instalados no RetroArch configurado.
#[tauri::command(async)]
pub fn emulators_cores(state: State<'_, AppState>) -> AppResult<Vec<RetroArchCore>> {
    let retroarch = emulators::get_emulator_paths(&state.db())?.remove(&EmulatorId::Retroarch);
    Ok(retroarch.filter(|path| path_exists(path)).map(|path| emulators::list_retroarch_cores(&path)).unwrap_or_default())
}

// ---------------------------------------------------------------- pastas de ROMs

#[tauri::command]
pub fn rom_folders_list(state: State<'_, AppState>) -> AppResult<Vec<RomFolder>> {
    Ok(rom_scanner::list_rom_folders(&state.db())?)
}

/// Abre a janela do Windows para escolher uma pasta. None se o usuário cancelar.
#[tauri::command(async)]
pub fn rom_folders_pick(app: AppHandle, window: WebviewWindow, state: State<'_, AppState>) -> AppResult<Option<String>> {
    let title = text(state.language(), "dialogs.pickRomFolder", &[]);
    let picked = app.dialog().file().set_parent(&window).set_title(title).blocking_pick_folder();
    Ok(picked.and_then(|folder| folder.into_path().ok()).map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn rom_folders_add(state: State<'_, AppState>, folder: Value) -> AppResult<RomFolder> {
    let language = state.language();
    let (path, emulator, core, platform) = to_rom_folder(&folder, language)?;
    rom_scanner::add_rom_folder(&state.db(), language, &path, emulator, core, &platform)
}

/// Tira uma pasta da lista (os jogos dela continuam na biblioteca).
#[tauri::command]
pub fn rom_folders_remove(state: State<'_, AppState>, id: Value) -> AppResult<()> {
    let language = state.language();
    Ok(rom_scanner::remove_rom_folder(&state.db(), to_id(&id, language)?)?)
}

/// Procura jogos numa pasta, ou em todas (sem id). Os jogos novos ganham os metadados (se o usuário deixou)
/// e o tempo que os emuladores já registraram para eles.
#[tauri::command(async)]
pub fn rom_folders_scan(app: AppHandle, state: State<'_, AppState>, id: Value) -> AppResult<ScanResult> {
    let language = state.language();
    let ids = to_optional_id(&id, language)?.map(|id| vec![id]);
    let result = rom_scanner::scan_rom_folders(&state.db(), language, ids.as_deref())?;
    if !result.added.is_empty() {
        notify_library_changed(&app);
        // Os jogos novos já ganham os metadados, se o usuário deixou (Configurações → Metadados).
        if credentials::auto_download(&state.db()) {
            app.state::<MetadataService>().queue.enqueue(&result.added_ids);
        }
        app.state::<PlaytimeSync>().run();
    }
    Ok(result)
}

// ---------------------------------------------------------------- estatísticas

/// Quanto se jogou em cada um dos últimos 30 dias, do mais antigo para hoje.
#[tauri::command]
pub fn stats_daily_playtime(state: State<'_, AppState>) -> AppResult<Vec<DailyPlaytime>> {
    Ok(get_daily_playtime(&state.db(), ACTIVITY_DAYS, Local::now())?)
}

// ---------------------------------------------------------------- metadados (Configurações → Metadados)

#[tauri::command]
pub fn metadata_get_config(state: State<'_, AppState>, secrets: State<'_, Secrets>) -> MetadataConfig {
    credentials::get_metadata_config(&state.db(), &secrets)
}

/// Confere o Client ID e o Client Secret do IGDB (pedindo um token) e salva; null apaga.
#[tauri::command(async)]
pub fn metadata_set_igdb(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    service: State<'_, MetadataService>,
    credentials: Value,
) -> AppResult<MetadataConfig> {
    let language = state.language();
    let credentials = to_igdb_credentials(&credentials, language)?;
    if let Some(credentials) = &credentials {
        service.igdb_session(credentials.clone(), language).validate()?;
    }
    credentials::save_igdb_credentials(&state.db(), &secrets, language, credentials.as_ref())?;
    Ok(credentials::get_metadata_config(&state.db(), &secrets))
}

/// Confere a chave do SteamGridDB (com uma busca de teste) e salva; null apaga.
#[tauri::command(async)]
pub fn metadata_set_steam_grid_db(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    service: State<'_, MetadataService>,
    key: Value,
) -> AppResult<MetadataConfig> {
    let language = state.language();
    let key = if key.is_null() { None } else { Some(to_secret(&key, "steamGridDbKey", language)?) };
    if let Some(key) = &key {
        service.steam_grid_db_session(key.clone(), language).validate()?;
    }
    credentials::save_steam_grid_db_key(&state.db(), &secrets, language, key.as_deref())?;
    Ok(credentials::get_metadata_config(&state.db(), &secrets))
}

#[tauri::command]
pub fn metadata_set_auto_download(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    enabled: Value,
) -> AppResult<MetadataConfig> {
    credentials::set_metadata_auto_download(&state.db(), to_bool(&enabled, state.language())?)?;
    Ok(credentials::get_metadata_config(&state.db(), &secrets))
}

/// Baixa os metadados dos jogos dados ou, sem ids, dos que ainda não têm. Devolve quantos entraram na fila.
#[tauri::command]
pub fn metadata_download(state: State<'_, AppState>, service: State<'_, MetadataService>, game_ids: Value) -> AppResult<usize> {
    let ids = if game_ids.is_null() {
        library::list_games_without_metadata(&state.db())?
    } else {
        to_id_list(&game_ids, state.language())?
    };
    Ok(service.queue.enqueue(&ids))
}

#[tauri::command]
pub fn metadata_get_progress(service: State<'_, MetadataService>) -> MetadataProgress {
    service.queue.progress()
}
