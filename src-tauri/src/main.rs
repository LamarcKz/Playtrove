// Sem a janela do console no app de verdade (no "npm run dev" ela mostra os registros).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod achievements;
mod commands;
mod controller_input;
mod controllers;
mod data_folder;
mod database;
mod dates;
mod discs;
mod dynamic_color;
mod emulator_playtime;
mod emulator_window;
mod emulators;
mod errors;
mod fullscreen;
mod i18n;
mod images;
mod launcher;
mod library;
mod links;
mod metadata;
mod migrations;
mod music;
mod music_previews;
mod music_search;
mod playtime_sync;
mod power;
mod rom_scanner;
mod sample_games;
mod secrets;
mod settings;
mod state;
mod stats;
mod system_sources;
mod test_hooks;
mod test_mode;
#[cfg(test)]
mod test_support;
mod theme_pack;
mod updates;
mod validation;
mod videos;
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
    let builder = tauri::Builder::default();
    // No app de verdade, uma janela só: abrir de novo traz para a frente a que já está aberta. No
    // desenvolvimento e nos testes, não (eles abrem junto com o app instalado, com outros dados).
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _folder| window::bring_to_front(app)));
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol(images::IMAGE_PROTOCOL, images::handle_request)
        .register_asynchronous_uri_scheme_protocol(videos::VIDEO_PROTOCOL, videos::handle_request)
        .register_asynchronous_uri_scheme_protocol(music::MUSIC_PROTOCOL, music::handle_request)
        .register_asynchronous_uri_scheme_protocol(music_previews::PREVIEW_PROTOCOL, music_previews::handle_request)
        .register_asynchronous_uri_scheme_protocol(theme_pack::THEME_PROTOCOL, theme_pack::handle_request)
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
            app.manage(theme_pack::AnikiPack::new(folder.join("themes")));
            app.manage(music_previews::MusicPreviewCache::new(folder.join("music-previews"))?);
            app.manage(test_hooks::TestHooks::default());
            app.manage(secrets::Secrets::new(&folder));
            app.manage(AppState::new(db, language));
            app.manage(Launcher::new(Arc::new(Utc::now)));
            app.manage(metadata::service::MetadataService::new(app.handle().clone()));
            // As conquistas do RetroAchievements (a cada 5 minutos) e os troféus do RPCS3 (a cada minuto).
            app.manage(achievements::service::AchievementsService::new(app.handle().clone()));
            app.state::<achievements::service::AchievementsService>().start();
            // O tempo jogado registrado pelos próprios emuladores (inclusive o que foi jogado fora do app).
            app.manage(PlaytimeSync::start(app.handle().clone(), commands::notify_library_changed));
            // Os controles conectados (DualSense) e a bateria deles, na barra do topo.
            app.manage(controllers::Controllers::start(app.handle().clone()));
            // A atualização do app (5 segundos depois de abrir, procura uma versão nova).
            updates::start(app.handle());
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
            commands::app_open_link,
            commands::app_report_bug,
            commands::app_get_language,
            commands::app_set_language,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_close,
            commands::window_get_state,
            commands::window_set_fullscreen,
            commands::fullscreen_get_config,
            commands::fullscreen_set_config,
            commands::system_power,
            commands::themes_aniki_status,
            commands::themes_aniki_install,
            commands::themes_aniki_cancel,
            commands::themes_aniki_remove,
            commands::library_get,
            commands::games_set_status,
            commands::games_set_favorite,
            commands::games_set_evaluation,
            commands::games_pick_background_video,
            commands::games_accent_color,
            commands::games_remove_background_video,
            commands::games_use_automatic_background_video,
            commands::games_pick_theme_music,
            commands::games_remove_theme_music,
            commands::games_use_automatic_theme_music,
            commands::music_get_config,
            commands::music_set_config,
            commands::music_download,
            commands::music_get_reviews,
            commands::music_search,
            commands::music_preview,
            commands::music_choose,
            commands::music_cancel_preview,
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
            commands::achievements_get_config,
            commands::achievements_set_account,
            commands::achievements_sync,
            commands::achievements_game,
            commands::achievements_overview,
            commands::controllers_list,
            commands::controllers_get_input,
            commands::controllers_set_input_enabled,
            commands::updates_get_status,
            commands::updates_check,
            commands::updates_install,
            commands::updates_set_auto_check,
            test_hooks::test_mock_open_dialog,
            test_hooks::test_opened,
            test_hooks::test_window,
            test_hooks::test_focus_window,
            test_hooks::test_controller_input,
            test_hooks::test_set_window_size,
            test_hooks::test_hold_images,
            test_hooks::test_image_requests,
            test_hooks::test_release_image,
        ])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Playtrove");

    app.run(|app, event| {
        // Fechando o app com jogos abertos: registra o tempo jogado até agora (os emuladores continuam).
        if let RunEvent::Exit = event {
            app.state::<music_previews::MusicPreviewCache>().cancel();
            commands::finish_open_games(app);
        }
    });
}
