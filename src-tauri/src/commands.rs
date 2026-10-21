//! Os comandos que a interface chama (window.api, pela ponte de src/renderer/lib/tauriApi.ts): os
//! mesmos canais do app em Electron (src/main/ipc.ts), um por função. Os valores chegam crus (JSON) e
//! são conferidos em validation.rs antes de usar; o erro volta como a mensagem que a tela mostra.

use chrono::Utc;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State, WebviewWindow};

use crate::errors::{AppError, AppResult};
use crate::i18n::{Language, save_language};
use crate::library::{self, LibrarySnapshot, Status};
use crate::state::AppState;
use crate::validation::{to_bool, to_evaluation, to_id, to_order, to_status_rules, to_text};
use crate::window::WindowState;

/// O aviso de que algo mudou na biblioteca: a interface pede os dados de novo.
const LIBRARY_CHANGED_EVENT: &str = "library:changed";

fn notify_library_changed(app: &AppHandle) {
    let _ = app.emit(LIBRARY_CHANGED_EVENT, ());
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
