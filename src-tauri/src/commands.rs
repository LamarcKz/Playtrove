//! Os comandos que a interface chama (window.api, pela ponte de src/renderer/lib/tauriApi.ts), um por
//! função. Os valores chegam crus (JSON) e são conferidos em validation.rs antes de usar; o erro volta
//! como a mensagem que a tela mostra.

use std::path::Path;

use chrono::{Local, Utc};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::achievements::badges::badge_url;
use crate::achievements::client::RaApi;
use crate::achievements::service::AchievementsService;
use crate::achievements::trophy_icons::trophy_icon_url;
use crate::achievements::types::{AchievementsConfig, AchievementsOverview, GameAchievements};
use crate::achievements::{self};
use crate::controller_input::ControllerInputSnapshot;
use crate::controllers::{ConnectedController, Controllers};
use crate::data_folder::is_portable;
use crate::emulators::{self, EmulatorId, EmulatorInfo, RetroArchCore};
use crate::errors::{AppError, AppResult};
use crate::fullscreen::{self, FullscreenConfig};
use crate::i18n::{Language, save_language, text};
use crate::images::ImagesDir;
use crate::launcher::{Launcher, SystemStarter};
use crate::library::{self, LibrarySnapshot, Status};
use crate::links;
use crate::metadata::credentials::{self, MetadataConfig};
use crate::metadata::queue::MetadataProgress;
use crate::metadata::service::MetadataService;
use crate::music::{self, MusicConfig};
use crate::music_previews::MusicPreviewCache;
use crate::music_search::{self, MusicPreview, MusicReview};
use crate::playtime_sync::{AFTER_GAME_DELAY, PlaytimeSync};
use crate::rom_scanner::{self, RomFolder, ScanResult};
use crate::secrets::Secrets;
use crate::state::AppState;
use crate::stats::{ACTIVITY_DAYS, DailyPlaytime, get_daily_playtime};
use crate::system_sources::SystemSources;
use crate::test_hooks::{self, TestHooks, open_in_browser, show_in_explorer};
use crate::test_mode::test_mode;
use crate::theme_pack::{self, AnikiPack, AnikiPackStatus, InstallError};
use crate::updates::{UpdateService, UpdateStatus};
use crate::validation::{
    to_bool, to_emulator_id, to_evaluation, to_id, to_id_list, to_igdb_credentials, to_optional_id, to_order, to_ra_account,
    to_rom_folder, to_secret, to_status_rules, to_text,
};
use crate::videos;
use crate::window::WindowState;

/// O aviso de que algo mudou na biblioteca: a interface pede os dados de novo.
const LIBRARY_CHANGED_EVENT: &str = "library:changed";
/// O aviso dos jogos abertos agora (quando um abre ou fecha).
const GAMES_RUNNING_EVENT: &str = "games:running";

pub fn notify_library_changed(app: &AppHandle) {
    let _ = app.emit(LIBRARY_CHANGED_EVENT, ());
}

/// Fechando o app (ou saindo para instalar uma versão nova) com jogos abertos: registra o tempo jogado até
/// agora (os emuladores continuam).
pub fn finish_open_games(app: &AppHandle) {
    let state = app.state::<AppState>();
    for session in app.state::<Launcher>().finish_all() {
        let _ = library::record_play_session(&state.db(), state.language(), session.game_id, session.seconds, session.ended_at);
    }
}

fn notify_running(app: &AppHandle) {
    if !app.state::<Launcher>().running().is_empty() {
        app.state::<Controllers>().set_input_enabled(false);
    }
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

/// Abre no navegador só os sites conhecidos (as páginas para criar as chaves e a de download).
#[tauri::command]
pub fn app_open_link(app: AppHandle, link: Value) {
    if let Some(url) = link.as_str().and_then(links::external_link) {
        open_in_browser(&app, url);
    }
}

/// O formulário de bug do GitHub, já com a versão do app e a do Windows.
#[tauri::command]
pub fn app_report_bug(app: AppHandle) {
    let version = app.package_info().version.to_string();
    let url = links::bug_report_url(&version, is_portable(), &links::windows_description());
    open_in_browser(&app, &url);
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
    if crate::test_mode::test_mode().data_dir.is_some()
        && let Some(hooks) = window.try_state::<crate::test_hooks::TestHooks>()
    {
        hooks.set_simulated_focus(false);
    }
    window.minimize()?;
    let _ = crate::window::reconcile_state(&window);
    Ok(())
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
pub fn window_finish_close(window: WebviewWindow) -> AppResult<()> {
    Ok(crate::window::finish_close(&window)?)
}

#[tauri::command]
pub fn window_get_state(window: WebviewWindow) -> AppResult<WindowState> {
    Ok(crate::window::reconcile_state(&window)?)
}

/// A apresentação só muda depois da transição nativa bem-sucedida.
#[tauri::command]
pub fn window_set_fullscreen(window: WebviewWindow, state: State<'_, AppState>, enabled: Value) -> AppResult<WindowState> {
    Ok(crate::window::set_fullscreen(&window, to_bool(&enabled, state.language())?)?)
}

#[tauri::command]
pub fn fullscreen_get_config(state: State<'_, AppState>) -> FullscreenConfig {
    fullscreen::get_config(&state.db())
}

#[tauri::command]
pub fn fullscreen_set_config(
    app: AppHandle,
    state: State<'_, AppState>,
    pack: State<'_, AnikiPack>,
    patch: Value,
) -> AppResult<FullscreenConfig> {
    // O tema Aniki só vale com o pacote oficial instalado (a instalação já troca o tema sozinha).
    if patch.get("theme").and_then(Value::as_str) == Some("aniki") && !pack.installed() {
        return Err(AppError::text(state.language(), "errors.anikiMissing", &[]));
    }
    let config = fullscreen::set_config(&state.db(), &patch, state.language())?;
    let _ = app.emit(fullscreen::CONFIG_EVENT, &config);
    if let Some(overlay) = app.try_state::<crate::game_overlay::GameOverlay>() {
        overlay.refresh();
    }
    Ok(config)
}

/// Bloqueia, suspende, reinicia ou desliga o Windows (o menu principal da tela cheia confirma antes).
/// Nos testes do app, só anota a ação, como os endereços que iriam para o navegador.
#[tauri::command]
pub fn system_power(state: State<'_, AppState>, hooks: State<'_, crate::test_hooks::TestHooks>, action: Value) -> AppResult<()> {
    let language = state.language();
    let action = action
        .as_str()
        .filter(|action| crate::power::ACTIONS.contains(action))
        .ok_or_else(|| AppError::text(language, "errors.invalidValue", &[]))?;
    if crate::test_hooks::active() {
        hooks.record_opened(&format!("power:{action}"));
        return Ok(());
    }
    crate::power::run(action).map_err(|_| AppError::text(language, "errors.powerFailed", &[]))
}

#[tauri::command(async)]
pub fn audio_output_get(state: State<'_, AppState>) -> AppResult<crate::audio_output::AudioOutputState> {
    crate::audio_output::get().map_err(|error| error.into_app(state.language()))
}

#[tauri::command(async)]
pub fn audio_output_set_device(state: State<'_, AppState>, id: Value) -> AppResult<crate::audio_output::AudioOutputState> {
    let id = to_text(&id, state.language())?;
    crate::audio_output::set_device(&id).map_err(|error| error.into_app(state.language()))
}

#[tauri::command(async)]
pub fn audio_output_set_volume(state: State<'_, AppState>, volume: Value) -> AppResult<crate::audio_output::AudioOutputState> {
    let volume = volume.as_f64().ok_or_else(|| crate::audio_output::AudioError::InvalidVolume.into_app(state.language()))?;
    crate::audio_output::set_volume(volume).map_err(|error| error.into_app(state.language()))
}

#[tauri::command(async)]
pub fn audio_output_set_muted(state: State<'_, AppState>, muted: Value) -> AppResult<crate::audio_output::AudioOutputState> {
    let muted = to_bool(&muted, state.language())?;
    crate::audio_output::set_muted(muted).map_err(|error| error.into_app(state.language()))
}

#[tauri::command(async)]
pub fn game_media_list(
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
    game_id: Value,
) -> AppResult<Vec<crate::game_media::GameMediaItem>> {
    let game_id = to_id(&game_id, state.language())?;
    crate::game_media::list(state.database(), state.language(), &images.0, game_id)
}

#[tauri::command(async)]
pub fn game_media_import(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
    game_id: Value,
) -> AppResult<Vec<crate::game_media::GameMediaItem>> {
    let language = state.language();
    let game_id = to_id(&game_id, language)?;
    crate::game_media::validate_game(&state.db(), language, game_id)?;
    let picked = if cfg!(test) || test_hooks::active() {
        app.state::<TestHooks>().take_open_dialog().into_iter().collect()
    } else {
        app.dialog()
            .file()
            .set_parent(&window)
            .set_title(text(language, "errors.gameMedia.importTitle", &[]))
            .add_filter(text(language, "errors.gameMedia.imageFiles", &[]), &["png", "jpg", "jpeg", "webp"])
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|file| file.into_path())
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| AppError::text(language, "errors.gameMedia.read", &[]))?
    };
    crate::game_media::import_files(state.database(), language, &images.0, game_id, &picked)
}

#[tauri::command(async)]
pub fn game_media_remove(
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
    game_id: Value,
    media_id: Value,
) -> AppResult<Vec<crate::game_media::GameMediaItem>> {
    let language = state.language();
    crate::game_media::remove(state.database(), language, &images.0, to_id(&game_id, language)?, &to_text(&media_id, language)?)
}

#[tauri::command]
pub fn themes_aniki_status(pack: State<'_, AnikiPack>) -> AnikiPackStatus {
    pack.status()
}

/// Baixa o pacote oficial do Aniki da release do autor e, quando termina, troca o tema da tela cheia.
#[tauri::command(async)]
pub fn themes_aniki_install(
    app: AppHandle,
    state: State<'_, AppState>,
    pack: State<'_, AnikiPack>,
) -> AppResult<AnikiPackStatus> {
    let report = |status: AnikiPackStatus| {
        let _ = app.emit(theme_pack::PROGRESS_EVENT, status);
    };
    match pack.install(&theme_pack::download, &report) {
        Ok(()) => {
            let config = fullscreen::set_config(&state.db(), &serde_json::json!({"theme": "aniki"}), state.language())?;
            let _ = app.emit(fullscreen::CONFIG_EVENT, &config);
        }
        // Cancelar não é erro, e um segundo pedido acompanha o download que já está em andamento.
        Err(InstallError::Cancelled | InstallError::Busy) => {}
        Err(error) => return Err(AppError::text(state.language(), error.message_key(), &[])),
    }
    Ok(pack.status())
}

/// Abre o Playnite com o Aniki no lugar da tela cheia do Playtrove (o tema Aniki instalado e escolhido).
#[tauri::command(async)]
pub fn aniki_enter(app: AppHandle) -> AppResult<()> {
    crate::aniki_session::enter(&app)
}

#[tauri::command]
pub fn themes_aniki_cancel(pack: State<'_, AnikiPack>) {
    pack.cancel();
}

/// Apaga o pacote do Aniki; se ele era o tema escolhido, a tela cheia volta ao tema Playtrove.
#[tauri::command(async)]
pub fn themes_aniki_remove(app: AppHandle, state: State<'_, AppState>, pack: State<'_, AnikiPack>) -> AppResult<AnikiPackStatus> {
    pack.remove().map_err(|error| AppError::text(state.language(), error.message_key(), &[]))?;
    if fullscreen::get_config(&state.db()).theme == "aniki" {
        let config = fullscreen::set_config(&state.db(), &serde_json::json!({"theme": "playtrove"}), state.language())?;
        let _ = app.emit(fullscreen::CONFIG_EVENT, &config);
    }
    let status = pack.status();
    let _ = app.emit(theme_pack::PROGRESS_EVENT, &status);
    Ok(status)
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

/// A cor de destaque tirada da arte do jogo, para a cor dinâmica da tela cheia ("#rrggbb" ou null).
#[tauri::command(async)]
pub fn games_accent_color(state: State<'_, AppState>, images: State<'_, ImagesDir>, game_id: Value) -> AppResult<Option<String>> {
    let game_id = to_id(&game_id, state.language())?;
    Ok(crate::dynamic_color::game_accent(&state.db(), &images.0, game_id)?)
}

/// Escolhe um MP4/WebM local e guarda uma cópia nos dados do app.
#[tauri::command(async)]
pub fn games_pick_background_video(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
    game_id: Value,
) -> AppResult<()> {
    let language = state.language();
    let game_id = to_id(&game_id, language)?;
    videos::current_background_video(&state.db(), language, game_id)?;
    let picked = if test_hooks::active() {
        app.state::<TestHooks>().take_open_dialog()
    } else {
        app.dialog()
            .file()
            .set_parent(&window)
            .set_title(text(language, "dialogs.pickBackgroundVideo", &[]))
            .add_filter(text(language, "dialogs.videoFiles", &[]), &["mp4", "webm"])
            .blocking_pick_file()
            .and_then(|file| file.into_path().ok())
    };
    if videos::pick_background_video(state.database(), language, &images.0, game_id, picked.as_deref())? {
        notify_library_changed(&app);
    }
    Ok(())
}

#[tauri::command(async)]
pub fn games_remove_background_video(
    app: AppHandle,
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
    game_id: Value,
) -> AppResult<()> {
    videos::remove_background_video(state.database(), state.language(), &images.0, to_id(&game_id, state.language())?)?;
    notify_library_changed(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn games_use_automatic_background_video(
    app: AppHandle,
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
    service: State<'_, MetadataService>,
    game_id: Value,
) -> AppResult<()> {
    let language = state.language();
    let game_id = to_id(&game_id, language)?;
    videos::use_automatic_background_video(state.database(), language, &images.0, game_id)?;
    notify_library_changed(&app);
    service.queue.enqueue(&[game_id]);
    Ok(())
}

#[tauri::command(async)]
pub fn games_pick_theme_music(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
    game_id: Value,
) -> AppResult<()> {
    let language = state.language();
    let game_id = to_id(&game_id, language)?;
    library::get_metadata_target(&state.db(), language, game_id)?;
    let picked = if test_hooks::active() {
        app.state::<TestHooks>().take_open_dialog()
    } else {
        app.dialog()
            .file()
            .set_parent(&window)
            .set_title(text(language, "dialogs.pickThemeMusic", &[]))
            .add_filter(text(language, "dialogs.themeMusicFiles", &[]), &["m4a", "mp3", "wav"])
            .blocking_pick_file()
            .and_then(|file| file.into_path().ok())
    };
    if music::pick_theme_music(state.database(), language, &images.0, game_id, picked.as_deref())? {
        app.state::<MusicPreviewCache>().cancel();
        notify_library_changed(&app);
    }
    Ok(())
}

#[tauri::command(async)]
pub fn games_remove_theme_music(
    app: AppHandle,
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
    game_id: Value,
) -> AppResult<()> {
    music::remove_theme_music(state.database(), state.language(), &images.0, to_id(&game_id, state.language())?)?;
    app.state::<MusicPreviewCache>().cancel();
    notify_library_changed(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn games_use_automatic_theme_music(
    app: AppHandle,
    state: State<'_, AppState>,
    service: State<'_, MetadataService>,
    game_id: Value,
) -> AppResult<()> {
    let id = to_id(&game_id, state.language())?;
    music::use_automatic_theme_music(&state.db(), state.language(), id)?;
    app.state::<MusicPreviewCache>().cancel();
    notify_library_changed(&app);
    service.queue.enqueue_music(&[id]);
    Ok(())
}

#[tauri::command]
pub fn music_get_config(state: State<'_, AppState>) -> MusicConfig {
    music::get_config(&state.db())
}

#[tauri::command]
pub fn music_set_config(app: AppHandle, state: State<'_, AppState>, config: Value) -> AppResult<MusicConfig> {
    let invalid = || AppError::text(state.language(), "errors.invalidMusicConfig", &[]);
    let enabled = config.get("enabled").and_then(Value::as_bool).ok_or_else(invalid)?;
    let auto_download = config.get("autoDownload").and_then(Value::as_bool).ok_or_else(invalid)?;
    let volume = config.get("volume").and_then(Value::as_u64).filter(|volume| *volume <= 100).ok_or_else(invalid)? as u8;
    let config = MusicConfig { enabled, volume, auto_download };
    music::set_config(&state.db(), &config)?;
    let _ = app.emit("music:config", &config);
    Ok(config)
}

/// Busca somente os temas ainda pendentes; as cópias manuais e desativadas ficam preservadas.
#[tauri::command]
pub fn music_download(state: State<'_, AppState>, service: State<'_, MetadataService>) -> AppResult<usize> {
    Ok(service.queue.enqueue_music(&prepare_missing_music(&state)?))
}

/// Só operações locais, sob uma trava. Um guard temporário no iterador do `for`
/// permaneceria vivo no corpo e impediria adquirir o mesmo banco novamente.
fn prepare_missing_music(state: &AppState) -> rusqlite::Result<Vec<i64>> {
    let db = state.db();
    let ids = library::list_games_without_music(&db)?;
    for id in ids {
        music_search::retry_missing(&db, id)?;
    }
    library::list_games_needing_music(&db)
}

#[tauri::command]
pub fn music_get_reviews(state: State<'_, AppState>) -> AppResult<Vec<MusicReview>> {
    music_search::list_reviews(&state.db(), state.language())
}

#[tauri::command(async)]
pub fn music_search(
    app: AppHandle,
    state: State<'_, AppState>,
    service: State<'_, MetadataService>,
    images: State<'_, ImagesDir>,
    game_id: Value,
    query: Value,
) -> AppResult<MusicReview> {
    let language = state.language();
    let query = if query.is_null() { None } else { Some(to_text(&query, language)?) };
    if query.as_ref().is_some_and(|query| query.len() > 512 || query.chars().any(char::is_control)) {
        return Err(AppError::text(language, "errors.invalidText", &[]));
    }
    let downloader =
        service.theme_downloader(&images).ok_or_else(|| AppError::text(language, "errors.themeMusicDownloadFailed", &[]))?;
    app.state::<MusicPreviewCache>().cancel();
    let result = music_search::search_choices(
        state.database(),
        language,
        downloader.as_ref(),
        to_id(&game_id, language)?,
        query.as_deref(),
    )?;
    notify_library_changed(&app);
    Ok(result)
}

fn music_choice_reference(value: &Value, language: Language) -> AppResult<String> {
    let value = to_text(value, language)?;
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err(AppError::text(language, "errors.invalidValue", &[]));
    }
    Ok(value)
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)] // Referências validadas e autorização de operação cancelável.
pub fn music_preview(
    state: State<'_, AppState>,
    service: State<'_, MetadataService>,
    images: State<'_, ImagesDir>,
    cache: State<'_, MusicPreviewCache>,
    game_id: Value,
    generation: Value,
    video_id: Value,
    operation_id: Option<Value>,
) -> AppResult<MusicPreview> {
    let language = state.language();
    let downloader =
        service.theme_downloader(&images).ok_or_else(|| AppError::text(language, "errors.themeMusicDownloadFailed", &[]))?;
    cache.preview(
        state.database(),
        language,
        downloader.as_ref(),
        to_id(&game_id, language)?,
        &music_choice_reference(&generation, language)?,
        &music_choice_reference(&video_id, language)?,
        operation_id
            .as_ref()
            .filter(|value| !value.is_null())
            .map(|value| music_choice_reference(value, language))
            .transpose()?
            .as_deref(),
    )
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)] // Contextos do Tauri e três campos validados da escolha.
pub fn music_choose(
    app: AppHandle,
    state: State<'_, AppState>,
    service: State<'_, MetadataService>,
    images: State<'_, ImagesDir>,
    cache: State<'_, MusicPreviewCache>,
    game_id: Value,
    generation: Value,
    video_id: Value,
    operation_id: Option<Value>,
) -> AppResult<()> {
    let language = state.language();
    let downloader =
        service.theme_downloader(&images).ok_or_else(|| AppError::text(language, "errors.themeMusicDownloadFailed", &[]))?;
    cache.choose(
        state.database(),
        language,
        &images.0,
        downloader.as_ref(),
        to_id(&game_id, language)?,
        &music_choice_reference(&generation, language)?,
        &music_choice_reference(&video_id, language)?,
        operation_id
            .as_ref()
            .filter(|value| !value.is_null())
            .map(|value| music_choice_reference(value, language))
            .transpose()?
            .as_deref(),
    )?;
    notify_library_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn music_cancel_preview(cache: State<'_, MusicPreviewCache>) -> String {
    cache.cancel()
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
/// registra o tempo jogado e relê o tempo que ele mesmo registrou (ele grava ao fechar), as conquistas e os
/// troféus.
#[tauri::command(async)]
pub fn games_play(app: AppHandle, state: State<'_, AppState>, game_id: Value) -> AppResult<()> {
    play_game(&app, to_id(&game_id, state.language())?)
}

/// Abre o jogo: o Jogar do desktop, da tela cheia e do tema Aniki (pelo Playnite).
pub fn play_game(app: &AppHandle, game_id: i64) -> AppResult<()> {
    let state = app.state::<AppState>();
    let launcher = app.state::<Launcher>();
    let language = state.language();
    let (prepared, config) = {
        let db = state.db();
        (launcher.prepare(&db, language, game_id)?, fullscreen::get_config(&db))
    };
    // Criar uma janela pede a thread da interface: nenhum guard do banco ou das sessões pode
    // atravessar esse callback. Falhas na apresentação nunca impedem abrir o jogo validado.
    let decoration = if config.theme == "aniki"
        && config.game_launch_splash_enabled
        && app.state::<crate::theme_pack::AnikiPack>().installed()
        && app.get_webview_window("main").is_some_and(|window| window.is_fullscreen().unwrap_or(false))
    {
        crate::game_launch_splash::media_for_game(&state, &app.state::<crate::images::ImagesDir>(), game_id)
            .ok()
            .map(|media| (crate::game_launch_splash::SplashOptions::from(&config), media))
    } else {
        None
    };
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
        handle.state::<AchievementsService>().after_game_closed();
    });
    let splash = app.state::<crate::game_launch_splash::GameLaunchSplash>();
    let mut splash_token = None;
    let launched = launcher.launch_prepared_with_control(
        prepared,
        &SystemStarter,
        || {
            if let Some((options, media)) = decoration {
                splash_token = splash.begin(game_id, options, media).ok();
            }
        },
        on_exit,
    );
    match launched {
        Ok(control) => {
            if let Some(token) = splash_token {
                if let Some(control) = control {
                    if splash.started(token, control).is_err() {
                        let _ = splash.failed(token);
                    }
                } else {
                    let _ = splash.failed(token);
                }
            }
        }
        Err(error) => {
            if let Some(token) = splash_token {
                let _ = splash.failed(token);
            }
            return Err(error);
        }
    }
    notify_running(app);
    notify_library_changed(app);
    Ok(())
}

/// Ids dos jogos abertos agora.
#[tauri::command]
pub fn games_get_running(launcher: State<'_, Launcher>) -> Vec<i64> {
    launcher.running()
}

#[tauri::command(async)]
pub fn stats_hub_game_activity(state: State<'_, AppState>) -> AppResult<Vec<crate::hub_data::HubGameActivity>> {
    Ok(crate::hub_data::get_game_activity(&state.db(), chrono::Local::now())?)
}

#[tauri::command]
pub fn games_get_running_sessions(launcher: State<'_, Launcher>) -> Vec<crate::launcher::RunningSession> {
    launcher.running_sessions()
}

fn session_error(error: crate::game_window::SessionControlError, language: Language) -> AppError {
    use crate::game_window::SessionControlError;
    let key = match error {
        SessionControlError::NotRunning => "errors.gameSessionEnded",
        SessionControlError::ControlUnavailable => "errors.gameSessionControlUnavailable",
        SessionControlError::WindowUnavailable => "errors.gameSessionWindowUnavailable",
        SessionControlError::OperationFailed => "errors.gameSessionOperationFailed",
    };
    AppError::text(language, key, &[])
}

fn overlay_error(error: crate::game_overlay::OverlayError, language: Language) -> AppError {
    use crate::game_overlay::OverlayError;
    let key = match error {
        OverlayError::Session(error) => return session_error(error, language),
        OverlayError::Disabled => "errors.gameOverlayDisabled",
        OverlayError::NoActiveGame => "errors.gameSessionEnded",
        OverlayError::InputHeld => "errors.gameOverlayInputHeld",
        OverlayError::Window | OverlayError::ServiceStopped => "errors.gameSessionOperationFailed",
    };
    AppError::text(language, key, &[])
}

#[tauri::command]
pub fn game_launch_splash_get_state(
    splash: State<'_, crate::game_launch_splash::GameLaunchSplash>,
) -> crate::game_launch_splash::SplashState {
    splash.get_state()
}

#[tauri::command]
pub fn game_launch_splash_rendered(
    window: WebviewWindow,
    state: State<'_, AppState>,
    splash: State<'_, crate::game_launch_splash::GameLaunchSplash>,
    generation: u64,
) -> AppResult<()> {
    if window.label() != crate::game_launch_splash::WINDOW_LABEL {
        return Err(AppError::text(state.language(), "errors.invalidValue", &[]));
    }
    splash.rendered(generation).map_err(|_| AppError::text(state.language(), "errors.gameSessionOperationFailed", &[]))
}

#[tauri::command]
pub fn game_overlay_get_state(overlay: State<'_, crate::game_overlay::GameOverlay>) -> crate::game_overlay::OverlayState {
    overlay.get_state()
}

#[tauri::command]
pub fn game_overlay_get_input(
    overlay: State<'_, crate::game_overlay::GameOverlay>,
) -> crate::controller_input::ControllerInputSnapshot {
    overlay.get_input_snapshot()
}

#[tauri::command(async)]
pub fn game_overlay_open(
    state: State<'_, AppState>,
    overlay: State<'_, crate::game_overlay::GameOverlay>,
    game_id: Value,
) -> AppResult<crate::game_overlay::OverlayState> {
    let language = state.language();
    overlay.open(to_id(&game_id, language)?).map_err(|error| overlay_error(error, language))
}

#[tauri::command(async)]
pub fn game_overlay_return_to_game(
    state: State<'_, AppState>,
    overlay: State<'_, crate::game_overlay::GameOverlay>,
) -> AppResult<crate::game_overlay::OverlayState> {
    overlay.close().map_err(|error| overlay_error(error, state.language()))
}

#[tauri::command(async)]
pub fn game_overlay_return_to_app(
    state: State<'_, AppState>,
    overlay: State<'_, crate::game_overlay::GameOverlay>,
) -> AppResult<crate::game_overlay::OverlayState> {
    overlay.return_to_app().map_err(|error| overlay_error(error, state.language()))
}

#[tauri::command(async)]
pub fn game_overlay_request_close_game(
    state: State<'_, AppState>,
    overlay: State<'_, crate::game_overlay::GameOverlay>,
) -> AppResult<crate::game_overlay::OverlayState> {
    overlay.request_close_game().map_err(|error| overlay_error(error, state.language()))
}

#[tauri::command(async)]
pub fn games_resume(state: State<'_, AppState>, launcher: State<'_, Launcher>, game_id: Value) -> AppResult<()> {
    let language = state.language();
    launcher.resume_game(to_id(&game_id, language)?).map_err(|error| session_error(error, language))
}

#[tauri::command(async)]
pub fn games_request_close(state: State<'_, AppState>, launcher: State<'_, Launcher>, game_id: Value) -> AppResult<()> {
    let language = state.language();
    launcher.request_close(to_id(&game_id, language)?).map_err(|error| session_error(error, language))
}

/// Abre o Explorador de Arquivos com a ROM do jogo selecionada.
#[tauri::command]
pub fn games_show_rom(app: AppHandle, state: State<'_, AppState>, game_id: Value) -> AppResult<()> {
    let language = state.language();
    let info = library::get_launch_info(&state.db(), language, to_id(&game_id, language)?)?;
    let rom_path = info.rom_path.ok_or_else(|| AppError::text(language, "errors.noRom", &[]))?;
    if !path_exists(&rom_path) {
        return Err(AppError::text(language, "errors.romNotFound", &[&rom_path]));
    }
    // Se o Explorador não abrir, não há o que avisar.
    show_in_explorer(&app, &rom_path);
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
    let picked = if test_hooks::active() {
        app.state::<TestHooks>().take_open_dialog()
    } else {
        app.dialog()
            .file()
            .set_parent(&window)
            .set_title(text(language, "dialogs.pickEmulator", &[name]))
            .add_filter(text(language, "dialogs.programs", &[]), &["exe"])
            .blocking_pick_file()
            .and_then(|file| file.into_path().ok())
    };
    if let Some(path) = picked {
        emulators::set_emulator_path(&state.db(), emulator, &path.to_string_lossy())?;
        if emulator == EmulatorId::Rpcs3 {
            app.state::<AchievementsService>().read_trophies();
        }
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
    let picked = if test_hooks::active() {
        app.state::<TestHooks>().take_open_dialog()
    } else {
        let title = text(state.language(), "dialogs.pickRomFolder", &[]);
        app.dialog().file().set_parent(&window).set_title(title).blocking_pick_folder().and_then(|folder| folder.into_path().ok())
    };
    Ok(picked.map(|path| path.to_string_lossy().into_owned()))
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
        } else if music::get_config(&state.db()).auto_download && (!test_hooks::active() || test_mode().metadata_server.is_some())
        {
            app.state::<MetadataService>().queue.enqueue_music(&result.added_ids);
        }
        app.state::<PlaytimeSync>().run();
        app.state::<AchievementsService>().read_trophies();
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
pub fn metadata_download(
    state: State<'_, AppState>,
    service: State<'_, MetadataService>,
    secrets: State<'_, Secrets>,
    game_ids: Value,
) -> AppResult<usize> {
    let (metadata_ids, music_only_ids) = if game_ids.is_null() {
        let keys = credentials::read_metadata_credentials(&state.db(), &secrets);
        let ids = library::list_games_needing_metadata(&state.db(), keys.igdb.is_some(), keys.steam_grid_db_key.is_some())?;
        let music = prepare_missing_music(&state)?.into_iter().filter(|id| !ids.contains(id)).collect();
        (ids, music)
    } else {
        let ids = to_id_list(&game_ids, state.language())?;
        for id in &ids {
            music_search::retry_missing(&state.db(), *id)?;
        }
        (ids, Vec::new())
    };
    Ok(service.queue.enqueue_metadata_and_music(&metadata_ids, &music_only_ids))
}

#[tauri::command]
pub fn metadata_get_progress(service: State<'_, MetadataService>) -> MetadataProgress {
    service.queue.progress()
}

// ---------------------------------------------------------------- conquistas

#[tauri::command]
pub fn achievements_get_config(service: State<'_, AchievementsService>) -> AchievementsConfig {
    service.config()
}

/// Confere a conta do RetroAchievements no site e salva (null apaga). Com uma conta, atualiza tudo logo
/// depois.
#[tauri::command(async)]
pub fn achievements_set_account(
    app: AppHandle,
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    service: State<'_, AchievementsService>,
    account: Value,
) -> AppResult<AchievementsConfig> {
    let language = state.language();
    let account = to_ra_account(&account, language)?;
    if let Some(account) = &account {
        service.client(account.clone(), language).validate()?;
    }
    achievements::store::save_ra_account(&state.db(), &secrets, language, account.as_ref())?;
    notify_library_changed(&app);
    if account.is_some() {
        let handle = app.clone();
        std::thread::spawn(move || handle.state::<AchievementsService>().sync(true));
    }
    Ok(service.config())
}

/// O botão "Atualizar": relê os troféus do RPCS3 e atualiza as conquistas de todos os jogos.
#[tauri::command(async)]
pub fn achievements_sync(service: State<'_, AchievementsService>) {
    service.refresh();
}

/// As conquistas de um jogo da biblioteca, ou null se ele não tiver.
#[tauri::command]
pub fn achievements_game(
    state: State<'_, AppState>,
    images: State<'_, ImagesDir>,
    game_id: Value,
) -> AppResult<Option<GameAchievements>> {
    let game_id = to_id(&game_id, state.language())?;
    let badge = |name: Option<&str>, earned: bool| badge_url(&images.0, name, earned);
    let icon = |set: &str, id: i64| trophy_icon_url(&images.0, set, id);
    Ok(achievements::views::get_game_achievements(&state.db(), game_id, &badge, &icon)?)
}

/// Tudo o que a aba Conquistas mostra.
#[tauri::command]
pub fn achievements_overview(state: State<'_, AppState>, images: State<'_, ImagesDir>) -> AppResult<AchievementsOverview> {
    let badge = |name: Option<&str>, earned: bool| badge_url(&images.0, name, earned);
    let icon = |set: &str, id: i64| trophy_icon_url(&images.0, set, id);
    Ok(achievements::views::get_overview(&state.db(), &badge, &icon, Local::now())?)
}

// ---------------------------------------------------------------- controles (barra do topo)

/// Os controles conectados agora, com a bateria (depois, a interface ouve o aviso "controllers:changed").
#[tauri::command]
pub fn controllers_list(controllers: State<'_, Controllers>) -> Vec<ConnectedController> {
    controllers.list()
}

#[tauri::command]
pub fn controllers_get_input(controllers: State<'_, Controllers>) -> ControllerInputSnapshot {
    controllers.input()
}

/// A leitura rápida só é permitida na própria tela cheia em primeiro plano, inclusive no painel de sessões.
#[tauri::command]
pub fn controllers_set_input_enabled(
    window: WebviewWindow,
    state: State<'_, AppState>,
    controllers: State<'_, Controllers>,
    enabled: Value,
) -> AppResult<()> {
    let enabled = to_bool(&enabled, state.language())?;
    controllers.set_input_enabled(enabled && window.is_fullscreen()? && crate::window::has_input_focus(&window)?);
    Ok(())
}

// ---------------------------------------------------------------- atualização (Configurações → Sobre)

#[tauri::command]
pub fn updates_get_status(updates: State<'_, UpdateService>) -> UpdateStatus {
    updates.status()
}

/// Procura uma versão nova agora (pela internet, fora da linha da janela).
#[tauri::command(async)]
pub fn updates_check(updates: State<'_, UpdateService>) {
    updates.check();
}

/// Baixa e instala a versão encontrada (o app fecha e abre de novo) ou, na portátil, abre a página de
/// download.
#[tauri::command(async)]
pub fn updates_install(updates: State<'_, UpdateService>) {
    updates.install();
}

/// Liga ou desliga a procura de versão nova sempre que o app abre.
#[tauri::command]
pub fn updates_set_auto_check(state: State<'_, AppState>, updates: State<'_, UpdateService>, enabled: Value) -> AppResult<()> {
    let enabled = to_bool(&enabled, state.language())?;
    updates.set_auto_check(enabled);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, mpsc};
    use std::time::Duration;

    #[test]
    fn preparar_musicas_ausentes_nao_adquire_o_mesmo_banco_duas_vezes() {
        let db = crate::test_support::memory_database();
        db.execute(
            "INSERT INTO games(id,title,status_id,added_at,theme_music_checked_at) VALUES(1,'Jogo',1,'2026-01-01','legado')",
            [],
        )
        .unwrap();
        let state = Arc::new(AppState::new(db, Language::En));
        let worker_state = Arc::clone(&state);
        let (sent, received) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            sent.send(prepare_missing_music(&worker_state)).unwrap();
        });
        let ids = received.recv_timeout(Duration::from_secs(5)).expect("a preparação local não pode travar o banco").unwrap();
        assert_eq!(ids, [1]);
        worker.join().unwrap();
        assert!(state.database().try_lock().is_ok());
    }
}
