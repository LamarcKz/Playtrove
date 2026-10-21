//! Os comandos que a interface chama (window.api, pela ponte de src/renderer/lib/tauriApi.ts): os
//! mesmos canais do app em Electron (src/main/ipc.ts), um por função. Tudo o que vem da interface é
//! conferido aqui antes de usar.

use tauri::{AppHandle, Emitter, State, WebviewWindow};

use crate::i18n::{Language, save_language, text};
use crate::library::{LibrarySnapshot, get_library};
use crate::state::AppState;
use crate::window::WindowState;

/// O aviso de que algo mudou na biblioteca: a interface pede os dados de novo.
const LIBRARY_CHANGED_EVENT: &str = "library:changed";

/// O erro de um comando é a mensagem que a interface mostra.
type CommandResult<T> = Result<T, String>;

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn notify_library_changed(app: &AppHandle) {
    let _ = app.emit(LIBRARY_CHANGED_EVENT, ());
}

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
pub fn app_set_language(app: AppHandle, state: State<'_, AppState>, language: String) -> CommandResult<()> {
    let language = Language::from_id(&language).ok_or_else(|| text(state.language(), "errors.invalidLanguage", &[]))?;
    save_language(&state.db(), language).map_err(message)?;
    state.set_language(language);
    notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn window_minimize(window: WebviewWindow) -> CommandResult<()> {
    window.minimize().map_err(message)
}

/// Maximiza a janela ou, se ela já estiver maximizada, restaura o tamanho anterior.
#[tauri::command]
pub fn window_toggle_maximize(window: WebviewWindow) -> CommandResult<()> {
    if window.is_maximized().map_err(message)? { window.unmaximize() } else { window.maximize() }.map_err(message)
}

#[tauri::command]
pub fn window_close(window: WebviewWindow) -> CommandResult<()> {
    window.close().map_err(message)
}

#[tauri::command]
pub fn window_get_state(window: WebviewWindow) -> CommandResult<WindowState> {
    Ok(WindowState { is_maximized: window.is_maximized().map_err(message)? })
}

/// Jogos, status e regras, de uma vez.
#[tauri::command]
pub fn library_get(state: State<'_, AppState>) -> CommandResult<LibrarySnapshot> {
    get_library(&state.db(), state.language()).map_err(message)
}
