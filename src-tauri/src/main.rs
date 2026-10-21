// Sem a janela do console no app de verdade (no "npm run dev:tauri" ela mostra os registros).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod data_folder;
mod database;
mod i18n;
mod images;
mod library;
mod migrations;
mod settings;
mod state;
mod test_mode;
mod window;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .register_uri_scheme_protocol(images::IMAGE_PROTOCOL, images::handle_request)
        .setup(|app| {
            // Antes da janela: onde ficam os dados, o banco e o idioma (o escolhido ou o do Windows).
            let folder = data_folder::data_folder(&app.path().data_dir()?)?;
            std::fs::create_dir_all(&folder)?;
            let db = database::open_database(&folder.join(data_folder::DATABASE_FILE))?;
            let language = i18n::load_language(&db, &i18n::system_locales())?;
            app.manage(images::ImagesDir(folder.join("images")));
            app.manage(state::AppState::new(db, language));
            window::create_main_window(app.handle(), language)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_version,
            commands::app_get_language,
            commands::app_set_language,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_close,
            commands::window_get_state,
            commands::library_get,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Playtrove");
}
