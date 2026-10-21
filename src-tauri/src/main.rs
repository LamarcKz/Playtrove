// Sem a janela do console no app de verdade (no "npm run dev:tauri" ela mostra os registros).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod data_folder;
mod database;
mod dates;
mod errors;
mod i18n;
mod images;
mod library;
mod migrations;
mod sample_games;
mod settings;
mod state;
mod test_mode;
mod validation;
mod window;

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::test_mode::test_mode;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol(images::IMAGE_PROTOCOL, images::handle_request)
        .setup(|app| {
            // Antes da janela: onde ficam os dados, o banco (consertado, se estava danificado) e o
            // idioma (o escolhido ou o do Windows).
            let folder = data_folder::data_folder(&app.path().data_dir()?)?;
            std::fs::create_dir_all(&folder)?;
            let (db, repair) = database::open_database(&folder.join(data_folder::DATABASE_FILE))?;
            let language = i18n::load_language(&db, &i18n::system_locales())?;
            if test_mode().sample_games {
                sample_games::seed_sample_games(&db)?;
            }
            app.manage(images::ImagesDir(folder.join("images")));
            app.manage(state::AppState::new(db, language));
            let window = window::create_main_window(app.handle(), language, folder.join("webview"))?;

            // O banco estava danificado: avisa o que foi recuperado e onde ficou o arquivo danificado.
            if let Some(report) = repair {
                let (title, message) = database::describe_repair(&report, language);
                app.dialog().message(message).title(title).kind(MessageDialogKind::Warning).parent(&window).show(|_| {});
            }
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
            commands::games_set_status,
            commands::games_set_favorite,
            commands::games_set_evaluation,
            commands::statuses_create,
            commands::statuses_rename,
            commands::statuses_reorder,
            commands::statuses_remove,
            commands::statuses_set_rules,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Playtrove");
}
