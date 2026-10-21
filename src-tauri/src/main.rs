// Sem a janela do console no app de verdade (no "npm run dev:tauri" ela mostra os registros).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod data_folder;
mod database;
mod dates;
mod discs;
mod emulator_playtime;
mod emulator_window;
mod emulators;
mod errors;
mod i18n;
mod images;
mod launcher;
mod library;
mod metadata;
mod migrations;
mod playtime_sync;
mod rom_scanner;
mod sample_games;
mod secrets;
mod settings;
mod state;
mod stats;
mod system_sources;
mod test_mode;
#[cfg(test)]
mod test_support;
mod validation;
mod window;

use std::sync::Arc;

use chrono::Utc;
use tauri::{Manager, RunEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::launcher::Launcher;
use crate::playtime_sync::PlaytimeSync;
use crate::state::AppState;
use crate::test_mode::test_mode;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol(images::IMAGE_PROTOCOL, images::handle_request)
        .setup(|app| {
            // Antes da janela: onde ficam os dados, o banco (consertado, se estava danificado) e o
            // idioma (o escolhido ou o do Windows).
            let folder = data_folder::data_folder(&app.path().data_dir()?)?;
            std::fs::create_dir_all(&folder)?;
            let (db, repair) = database::open_database(&folder.join(data_folder::DATABASE_FILE))?;
            let language = i18n::load_language(&db, &i18n::system_locales())?;
            // Se os emuladores se perderam no conserto, procura de novo agora (para o Jogar funcionar).
            if repair.as_ref().is_some_and(|report| report.lost("emulators")) && commands::emulator_detection_enabled() {
                emulators::fill_missing_emulators(&db, &system_sources::SystemSources::new())?;
            }
            if test_mode().sample_games {
                sample_games::seed_sample_games(&db)?;
            }
            app.manage(images::ImagesDir(folder.join("images")));
            app.manage(secrets::Secrets::new(&folder));
            app.manage(AppState::new(db, language));
            app.manage(Launcher::new(Arc::new(Utc::now)));
            app.manage(metadata::service::MetadataService::new(app.handle().clone()));
            // O tempo jogado registrado pelos próprios emuladores (inclusive o que foi jogado fora do app).
            app.manage(PlaytimeSync::start(app.handle().clone(), commands::notify_library_changed));
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
            commands::games_play,
            commands::games_get_running,
            commands::games_show_rom,
            commands::statuses_create,
            commands::statuses_rename,
            commands::statuses_reorder,
            commands::statuses_remove,
            commands::statuses_set_rules,
            commands::emulators_list,
            commands::emulators_detect,
            commands::emulators_pick_path,
            commands::emulators_cores,
            commands::rom_folders_list,
            commands::rom_folders_pick,
            commands::rom_folders_add,
            commands::rom_folders_remove,
            commands::rom_folders_scan,
            commands::stats_daily_playtime,
            commands::metadata_get_config,
            commands::metadata_set_igdb,
            commands::metadata_set_steam_grid_db,
            commands::metadata_set_auto_download,
            commands::metadata_download,
            commands::metadata_get_progress,
        ])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Playtrove");

    app.run(|app, event| {
        // Fechando o app com jogos abertos: registra o tempo jogado até agora (os emuladores continuam).
        if let RunEvent::Exit = event {
            let state = app.state::<AppState>();
            for session in app.state::<Launcher>().finish_all() {
                let _ = library::record_play_session(
                    &state.db(),
                    state.language(),
                    session.game_id,
                    session.seconds,
                    session.ended_at,
                );
            }
        }
    });
}
