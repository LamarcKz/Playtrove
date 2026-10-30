//! Preferências independentes do modo de tela cheia.

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

use crate::errors::{AppError, AppResult};
use crate::i18n::Language;
use crate::settings::{get_setting, set_setting};
use crate::validation::to_bool;

pub const CONFIG_EVENT: &str = "fullscreen:config";
pub const OVERLAY_HOTKEYS: [&str; 5] = ["CtrlShiftF12", "CtrlF12", "AltF12", "CtrlAltF12", "CtrlShiftF11"];
pub const SCREEN_SAVER_SOURCES: [&str; 7] =
    ["installed", "all", "favorites", "neverPlayed", "recentlyAdded", "currentFilter", "weighted"];
pub const GAME_LAUNCH_SPLASH_LOGO_POSITIONS: [&str; 9] =
    ["leftTop", "leftCenter", "leftBottom", "centerTop", "center", "centerBottom", "rightTop", "rightCenter", "rightBottom"];
pub const GAME_LAUNCH_SPLASH_SELECTION_MODES: [&str; 2] = ["automatic", "global"];

/// Avatares próprios do Playtrove para o perfil do Aniki (os do tema têm arte de terceiros).
pub const AVATARS: [&str; 13] =
    ["gamepad", "trophy", "star", "crown", "ghost", "swords", "rocket", "flame", "skull", "sparkles", "shield", "zap", "custom"];
/// Estilos visuais dos glifos do pacote, sem mudar a leitura ou o mapa do controle.
pub const CONTROLLER_ICON_STYLES: [&str; 16] = [
    "playstation",
    "playstation-dark",
    "playstation-retro",
    "xbox",
    "xbox-dark",
    "xbox-retro",
    "switch",
    "switch-dark",
    "switch-retro",
    "8bitdo",
    "8bitdo-pro3",
    "rog-ally",
    "iris",
    "generic",
    "generic-dark",
    "native",
];
const ANIKI_AVATAR_INDICES: std::ops::RangeInclusive<u8> = 1..=61;
/// Layouts da biblioteca e dos detalhes do Aniki; o primeiro de cada lista é o padrão.
pub const LIBRARY_LAYOUTS: [&str; 3] = ["horizontal", "vertical", "list"];
pub const DETAILS_LAYOUTS: [&str; 6] = ["signature", "modern", "classic", "original", "showcase", "panel"];
/// As paletas do Aniki (a padrão e as 40 de ThemeColors), na ordem dele; os ids são os de src/shared/anikiColors.ts.
pub const COLOR_PRESETS: [&str; 41] = [
    "default",
    "pure-black",
    "golden-dark",
    "golden-graphite",
    "steel-gray",
    "retro-gray",
    "light-white",
    "ivory-white",
    "orbis-blue",
    "mist-blue",
    "royal-blue",
    "lunar-blue",
    "midnight-blue",
    "forest-green",
    "velocity-green",
    "scarlet-red",
    "midnight-red",
    "blood-red",
    "royal-red",
    "velvet-purple",
    "toxic-purple",
    "sakura-pink",
    "midnight-pink",
    "golden-pink",
    "pop-red",
    "pop-yellow",
    "pop-tangerine",
    "pop-orange",
    "pop-green",
    "golden-green",
    "iris",
    "hunter-green",
    "aurora-prestige",
    "rose-prestige",
    "vermilion-prestige",
    "carbon-prestige",
    "emerald-prestige",
    "sapphire-prestige",
    "flat-dark",
    "flat-blue",
    "flat-red",
];
/// Os modos de efeitos do Aniki; o padrão é o equilibrado.
pub const EFFECTS: [&str; 4] = ["balanced", "full", "animated", "performance"];
/// Os estilos de interface do Aniki (quanta informação e quantos atalhos a biblioteca mostra); o padrão é o Padrão.
pub const INTERFACES: [&str; 4] = ["standard", "clean", "enhanced", "complete"];
/// Onde os trailers tocam sozinhos: só nos detalhes (padrão), em nenhum lugar ou também na biblioteca.
pub const TRAILERS: [&str; 3] = ["details", "off", "all"];
/// Os temas da tela cheia, como os do Playnite: o próprio Playtrove (padrão) e o Aniki ReMake, que só vale
/// com o pacote oficial baixado (`theme_pack.rs`).
pub const THEMES: [&str; 2] = ["playtrove", "aniki"];
/// Quantas linhas de capas a biblioteca do tema Playtrove mostra (como no Playnite).
const COVER_ROWS: std::ops::RangeInclusive<u8> = 1..=3;
/// Tamanho máximo do nome do perfil, em caracteres.
const PROFILE_NAME_MAX: usize = 32;

/// Onde a tela cheia abre, como no assistente do Aniki: no Welcome Hub ou na biblioteca.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StartDestination {
    Hub,
    Library,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullscreenConfig {
    pub theme: String,
    pub start_on_launch: bool,
    pub music_playback: bool,
    pub music_volume: u8,
    pub start_destination: StartDestination,
    /// Vazio usa o nome padrão da tela ("Jogador").
    pub profile_name: String,
    pub profile_avatar: String,
    /// Imagem do pacote instalado; ausente preserva o avatar próprio do perfil.
    pub aniki_avatar_index: Option<u8>,
    pub controller_icon_style: String,
    pub in_game_overlay_enabled: bool,
    pub in_game_overlay_hotkey: String,
    pub startup_intro_video_enabled: bool,
    pub shutdown_video_enabled: bool,
    pub screen_saver_enabled: bool,
    pub screen_saver_idle_delay_minutes: i16,
    pub screen_saver_change_interval_seconds: u16,
    pub screen_saver_source: String,
    pub screen_saver_ambient_music_enabled: bool,
    pub screen_saver_show_logo: bool,
    pub screen_saver_show_info_card: bool,
    pub screen_saver_animate_background: bool,
    pub screen_saver_use_fade_transitions: bool,
    pub game_launch_splash_enabled: bool,
    pub game_launch_splash_minimum_duration_ms: u64,
    pub game_launch_splash_maximum_wait_ms: u64,
    pub game_launch_splash_show_logo: bool,
    pub game_launch_splash_logo_position: String,
    pub game_launch_splash_background_dimming: f64,
    pub game_launch_splash_selection_mode: String,
    pub library_layout: String,
    pub details_layout: String,
    pub color_preset: String,
    /// Cor tirada da arte do jogo selecionado, no lugar da paleta (a "cor dinâmica" do Aniki).
    pub dynamic_colors: bool,
    pub effects: String,
    pub interface: String,
    /// A tela de boas-vindas com o perfil ao abrir o app em tela cheia (a de login do Aniki).
    pub login_screen: bool,
    pub trailers: String,
    /// O assistente inicial já foi concluído (ou pulado): ele não abre sozinho de novo.
    pub setup_done: bool,
    /// Tema Playtrove: linhas de capas, relógio na barra do topo e troca de × por ○ no controle.
    /// Os sons da navegação e seu volume valem nos dois temas.
    pub cover_rows: u8,
    pub show_clock: bool,
    pub ui_sounds: bool,
    pub ui_sounds_volume: u8,
    pub swap_confirm: bool,
    /// Onde o trailer toca no tema Playtrove (a do Aniki é `trailers`, que começa só nos detalhes, como nele).
    pub playtrove_trailers: String,
}

pub fn get_config(db: &Connection) -> FullscreenConfig {
    let boolean = |key, default| match get_setting(db, key).ok().flatten().as_deref() {
        Some("1" | "true") => true,
        Some("0" | "false") => false,
        _ => default,
    };
    FullscreenConfig {
        theme: choice(db, "fullscreenTheme", &THEMES),
        start_on_launch: boolean("fullscreenStartOnLaunch", false),
        music_playback: boolean("fullscreenMusicPlayback", true),
        music_volume: get_setting(db, "fullscreenMusicVolume")
            .ok()
            .flatten()
            .and_then(|value| value.parse::<u8>().ok())
            .filter(|volume| *volume <= 100)
            .unwrap_or(20),
        start_destination: match get_setting(db, "fullscreenStartDestination").ok().flatten().as_deref() {
            Some("library") => StartDestination::Library,
            _ => StartDestination::Hub,
        },
        profile_name: get_setting(db, "fullscreenProfileName").ok().flatten().filter(|name| valid_name(name)).unwrap_or_default(),
        profile_avatar: get_setting(db, "fullscreenProfileAvatar")
            .ok()
            .flatten()
            .filter(|avatar| AVATARS.contains(&avatar.as_str()))
            .unwrap_or_else(|| AVATARS[0].to_string()),
        aniki_avatar_index: number(db, "fullscreenAnikiAvatarIndex").filter(|index| ANIKI_AVATAR_INDICES.contains(index)),
        controller_icon_style: choice(db, "fullscreenControllerIconStyle", &CONTROLLER_ICON_STYLES),
        in_game_overlay_enabled: boolean("fullscreenInGameOverlayEnabled", false),
        in_game_overlay_hotkey: choice(db, "fullscreenInGameOverlayHotkey", &OVERLAY_HOTKEYS),
        startup_intro_video_enabled: boolean("fullscreenStartupIntroVideoEnabled", true),
        shutdown_video_enabled: boolean("fullscreenShutdownVideoEnabled", true),
        screen_saver_enabled: boolean("fullscreenScreenSaverEnabled", true),
        screen_saver_idle_delay_minutes: get_setting(db, "fullscreenScreenSaverIdleDelayMinutes")
            .ok()
            .flatten()
            .and_then(|value| value.parse::<i16>().ok())
            .filter(|value| valid_idle_delay(i64::from(*value)))
            .unwrap_or(1),
        screen_saver_change_interval_seconds: get_setting(db, "fullscreenScreenSaverChangeIntervalSeconds")
            .ok()
            .flatten()
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|value| (5..=300).contains(value))
            .unwrap_or(15),
        screen_saver_source: choice(db, "fullscreenScreenSaverSource", &SCREEN_SAVER_SOURCES),
        screen_saver_ambient_music_enabled: boolean("fullscreenScreenSaverAmbientMusicEnabled", true),
        screen_saver_show_logo: boolean("fullscreenScreenSaverShowLogo", true),
        screen_saver_show_info_card: boolean("fullscreenScreenSaverShowInfoCard", true),
        screen_saver_animate_background: boolean("fullscreenScreenSaverAnimateBackground", true),
        screen_saver_use_fade_transitions: boolean("fullscreenScreenSaverUseFadeTransitions", true),
        game_launch_splash_enabled: boolean("fullscreenGameLaunchSplashEnabled", true),
        game_launch_splash_minimum_duration_ms: get_setting(db, "fullscreenGameLaunchSplashMinimumDurationMs")
            .ok()
            .flatten()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| (500..=600000).contains(value))
            .unwrap_or(2400),
        game_launch_splash_maximum_wait_ms: get_setting(db, "fullscreenGameLaunchSplashMaximumWaitMs")
            .ok()
            .flatten()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| (1000..=120000).contains(value))
            .unwrap_or(90000),
        game_launch_splash_show_logo: boolean("fullscreenGameLaunchSplashShowLogo", true),
        game_launch_splash_logo_position: get_setting(db, "fullscreenGameLaunchSplashLogoPosition")
            .ok()
            .flatten()
            .filter(|value| GAME_LAUNCH_SPLASH_LOGO_POSITIONS.contains(&value.as_str()))
            .unwrap_or_else(|| "leftCenter".into()),
        game_launch_splash_background_dimming: get_setting(db, "fullscreenGameLaunchSplashBackgroundDimming")
            .ok()
            .flatten()
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite() && (0.0..=0.8).contains(value))
            .unwrap_or(95.0 / 255.0),
        game_launch_splash_selection_mode: choice(
            db,
            "fullscreenGameLaunchSplashSelectionMode",
            &GAME_LAUNCH_SPLASH_SELECTION_MODES,
        ),
        library_layout: choice(db, "fullscreenLibraryLayout", &LIBRARY_LAYOUTS),
        details_layout: choice(db, "fullscreenDetailsLayout", &DETAILS_LAYOUTS),
        color_preset: choice(db, "fullscreenColorPreset", &COLOR_PRESETS),
        dynamic_colors: boolean("fullscreenDynamicColors", false),
        effects: choice(db, "fullscreenEffects", &EFFECTS),
        interface: choice(db, "fullscreenInterface", &INTERFACES),
        login_screen: boolean("fullscreenLoginScreen", false),
        trailers: choice(db, "fullscreenTrailers", &TRAILERS),
        setup_done: boolean("fullscreenSetupDone", false),
        cover_rows: number(db, "fullscreenCoverRows").filter(|rows| COVER_ROWS.contains(rows)).unwrap_or(1),
        show_clock: boolean("fullscreenShowClock", true),
        ui_sounds: boolean("fullscreenUiSounds", true),
        ui_sounds_volume: number(db, "fullscreenUiSoundsVolume").filter(|volume| *volume <= 100).unwrap_or(40),
        swap_confirm: boolean("fullscreenSwapConfirm", false),
        playtrove_trailers: get_setting(db, "fullscreenPlaytroveTrailers")
            .ok()
            .flatten()
            .filter(|value| TRAILERS.contains(&value.as_str()))
            .unwrap_or_else(|| "all".to_string()),
    }
}

fn number(db: &Connection, key: &str) -> Option<u8> {
    get_setting(db, key).ok().flatten().and_then(|value| value.parse::<u8>().ok())
}

fn valid_idle_delay(value: i64) -> bool {
    matches!(value, -45 | -30 | 1..=120)
}

/// Um valor salvo que precisa estar na lista; qualquer outro volta ao primeiro (o padrão).
fn choice(db: &Connection, key: &str, options: &[&str]) -> String {
    get_setting(db, key)
        .ok()
        .flatten()
        .filter(|value| options.contains(&value.as_str()))
        .unwrap_or_else(|| options[0].to_string())
}

fn valid_name(name: &str) -> bool {
    name.trim() == name && name.chars().count() <= PROFILE_NAME_MAX && !name.chars().any(char::is_control)
}

/// Valida o patch inteiro antes da transação; falhas nunca gravam só parte das preferências.
pub fn set_config(db: &Connection, patch: &Value, language: Language) -> AppResult<FullscreenConfig> {
    let invalid = || AppError::text(language, "errors.invalidValue", &[]);
    let fields = patch.as_object().ok_or_else(invalid)?;
    let mut config = get_config(db);
    for (name, value) in fields {
        match name.as_str() {
            "theme" => {
                config.theme = value.as_str().filter(|theme| THEMES.contains(theme)).ok_or_else(invalid)?.to_string();
            }
            "startOnLaunch" => config.start_on_launch = to_bool(value, language)?,
            "musicPlayback" => config.music_playback = to_bool(value, language)?,
            "musicVolume" => {
                config.music_volume = value
                    .as_u64()
                    .filter(|volume| *volume <= 100)
                    .ok_or_else(|| AppError::text(language, "errors.invalidThemeMusicVolume", &[]))?
                    as u8;
            }
            "startDestination" => {
                config.start_destination = match value.as_str() {
                    Some("hub") => StartDestination::Hub,
                    Some("library") => StartDestination::Library,
                    _ => return Err(invalid()),
                }
            }
            "profileName" => {
                let name = value.as_str().map(str::trim).filter(|name| valid_name(name)).ok_or_else(invalid)?;
                config.profile_name = name.to_string();
            }
            "profileAvatar" => {
                config.profile_avatar = value.as_str().filter(|avatar| AVATARS.contains(avatar)).ok_or_else(invalid)?.to_string();
            }
            "anikiAvatarIndex" => {
                config.aniki_avatar_index = if value.is_null() {
                    None
                } else {
                    Some(value.as_u64().filter(|index| (1..=61).contains(index)).ok_or_else(invalid)? as u8)
                };
            }
            "controllerIconStyle" => {
                config.controller_icon_style =
                    value.as_str().filter(|style| CONTROLLER_ICON_STYLES.contains(style)).ok_or_else(invalid)?.to_string();
            }
            "inGameOverlayEnabled" => config.in_game_overlay_enabled = to_bool(value, language)?,
            "startupIntroVideoEnabled" => config.startup_intro_video_enabled = to_bool(value, language)?,
            "shutdownVideoEnabled" => config.shutdown_video_enabled = to_bool(value, language)?,
            "screenSaverEnabled" => config.screen_saver_enabled = to_bool(value, language)?,
            "screenSaverIdleDelayMinutes" => {
                config.screen_saver_idle_delay_minutes =
                    value.as_i64().filter(|value| valid_idle_delay(*value)).ok_or_else(invalid)? as i16;
            }
            "screenSaverChangeIntervalSeconds" => {
                config.screen_saver_change_interval_seconds =
                    value.as_u64().filter(|value| (5..=300).contains(value)).ok_or_else(invalid)? as u16;
            }
            "screenSaverSource" => {
                config.screen_saver_source =
                    value.as_str().filter(|value| SCREEN_SAVER_SOURCES.contains(value)).ok_or_else(invalid)?.to_string()
            }
            "screenSaverAmbientMusicEnabled" => config.screen_saver_ambient_music_enabled = to_bool(value, language)?,
            "screenSaverShowLogo" => config.screen_saver_show_logo = to_bool(value, language)?,
            "screenSaverShowInfoCard" => config.screen_saver_show_info_card = to_bool(value, language)?,
            "screenSaverAnimateBackground" => config.screen_saver_animate_background = to_bool(value, language)?,
            "screenSaverUseFadeTransitions" => config.screen_saver_use_fade_transitions = to_bool(value, language)?,
            "gameLaunchSplashEnabled" => config.game_launch_splash_enabled = to_bool(value, language)?,
            "gameLaunchSplashMinimumDurationMs" => {
                config.game_launch_splash_minimum_duration_ms =
                    value.as_u64().filter(|value| (500..=600000).contains(value)).ok_or_else(invalid)?;
            }
            "gameLaunchSplashMaximumWaitMs" => {
                config.game_launch_splash_maximum_wait_ms =
                    value.as_u64().filter(|value| (1000..=120000).contains(value)).ok_or_else(invalid)?;
            }
            "gameLaunchSplashShowLogo" => config.game_launch_splash_show_logo = to_bool(value, language)?,
            "gameLaunchSplashLogoPosition" => {
                config.game_launch_splash_logo_position = value
                    .as_str()
                    .filter(|value| GAME_LAUNCH_SPLASH_LOGO_POSITIONS.contains(value))
                    .ok_or_else(invalid)?
                    .to_string();
            }
            "gameLaunchSplashBackgroundDimming" => {
                config.game_launch_splash_background_dimming =
                    value.as_f64().filter(|value| value.is_finite() && (0.0..=0.8).contains(value)).ok_or_else(invalid)?;
            }
            "gameLaunchSplashSelectionMode" => {
                config.game_launch_splash_selection_mode = value
                    .as_str()
                    .filter(|value| GAME_LAUNCH_SPLASH_SELECTION_MODES.contains(value))
                    .ok_or_else(invalid)?
                    .to_string();
            }
            "inGameOverlayHotkey" => {
                config.in_game_overlay_hotkey =
                    value.as_str().filter(|hotkey| OVERLAY_HOTKEYS.contains(hotkey)).ok_or_else(invalid)?.to_string();
            }
            "libraryLayout" => {
                config.library_layout =
                    value.as_str().filter(|layout| LIBRARY_LAYOUTS.contains(layout)).ok_or_else(invalid)?.to_string();
            }
            "colorPreset" => {
                config.color_preset =
                    value.as_str().filter(|preset| COLOR_PRESETS.contains(preset)).ok_or_else(invalid)?.to_string();
            }
            "dynamicColors" => config.dynamic_colors = to_bool(value, language)?,
            "loginScreen" => config.login_screen = to_bool(value, language)?,
            "setupDone" => config.setup_done = to_bool(value, language)?,
            "coverRows" => {
                config.cover_rows =
                    value.as_u64().filter(|rows| COVER_ROWS.contains(&(*rows as u8)) && *rows <= 3).ok_or_else(invalid)? as u8;
            }
            "showClock" => config.show_clock = to_bool(value, language)?,
            "uiSounds" => config.ui_sounds = to_bool(value, language)?,
            "uiSoundsVolume" => {
                config.ui_sounds_volume = value.as_u64().filter(|volume| *volume <= 100).ok_or_else(invalid)? as u8;
            }
            "swapConfirm" => config.swap_confirm = to_bool(value, language)?,
            "playtroveTrailers" => {
                config.playtrove_trailers =
                    value.as_str().filter(|trailers| TRAILERS.contains(trailers)).ok_or_else(invalid)?.to_string();
            }
            "interface" => {
                config.interface =
                    value.as_str().filter(|interface| INTERFACES.contains(interface)).ok_or_else(invalid)?.to_string();
            }
            "trailers" => {
                config.trailers = value.as_str().filter(|trailers| TRAILERS.contains(trailers)).ok_or_else(invalid)?.to_string();
            }
            "effects" => {
                config.effects = value.as_str().filter(|effects| EFFECTS.contains(effects)).ok_or_else(invalid)?.to_string();
            }
            "detailsLayout" => {
                config.details_layout =
                    value.as_str().filter(|layout| DETAILS_LAYOUTS.contains(layout)).ok_or_else(invalid)?.to_string();
            }
            _ => return Err(invalid()),
        }
    }
    let transaction = db.unchecked_transaction()?;
    set_setting(&transaction, "fullscreenTheme", Some(&config.theme))?;
    set_setting(&transaction, "fullscreenStartOnLaunch", Some(if config.start_on_launch { "1" } else { "0" }))?;
    set_setting(&transaction, "fullscreenMusicPlayback", Some(if config.music_playback { "1" } else { "0" }))?;
    set_setting(&transaction, "fullscreenMusicVolume", Some(&config.music_volume.to_string()))?;
    let destination = match config.start_destination {
        StartDestination::Hub => "hub",
        StartDestination::Library => "library",
    };
    set_setting(&transaction, "fullscreenStartDestination", Some(destination))?;
    set_setting(&transaction, "fullscreenProfileName", Some(&config.profile_name))?;
    set_setting(&transaction, "fullscreenProfileAvatar", Some(&config.profile_avatar))?;
    set_setting(&transaction, "fullscreenAnikiAvatarIndex", config.aniki_avatar_index.map(|index| index.to_string()).as_deref())?;
    set_setting(&transaction, "fullscreenControllerIconStyle", Some(&config.controller_icon_style))?;
    set_setting(&transaction, "fullscreenInGameOverlayEnabled", Some(if config.in_game_overlay_enabled { "1" } else { "0" }))?;
    set_setting(&transaction, "fullscreenInGameOverlayHotkey", Some(&config.in_game_overlay_hotkey))?;
    for (key, value) in [
        ("fullscreenStartupIntroVideoEnabled", config.startup_intro_video_enabled),
        ("fullscreenShutdownVideoEnabled", config.shutdown_video_enabled),
        ("fullscreenScreenSaverEnabled", config.screen_saver_enabled),
        ("fullscreenScreenSaverAmbientMusicEnabled", config.screen_saver_ambient_music_enabled),
        ("fullscreenScreenSaverShowLogo", config.screen_saver_show_logo),
        ("fullscreenScreenSaverShowInfoCard", config.screen_saver_show_info_card),
        ("fullscreenScreenSaverAnimateBackground", config.screen_saver_animate_background),
        ("fullscreenScreenSaverUseFadeTransitions", config.screen_saver_use_fade_transitions),
        ("fullscreenGameLaunchSplashEnabled", config.game_launch_splash_enabled),
        ("fullscreenGameLaunchSplashShowLogo", config.game_launch_splash_show_logo),
    ] {
        set_setting(&transaction, key, Some(if value { "1" } else { "0" }))?;
    }
    set_setting(
        &transaction,
        "fullscreenScreenSaverIdleDelayMinutes",
        Some(&config.screen_saver_idle_delay_minutes.to_string()),
    )?;
    set_setting(
        &transaction,
        "fullscreenScreenSaverChangeIntervalSeconds",
        Some(&config.screen_saver_change_interval_seconds.to_string()),
    )?;
    set_setting(&transaction, "fullscreenScreenSaverSource", Some(&config.screen_saver_source))?;
    set_setting(
        &transaction,
        "fullscreenGameLaunchSplashMinimumDurationMs",
        Some(&config.game_launch_splash_minimum_duration_ms.to_string()),
    )?;
    set_setting(
        &transaction,
        "fullscreenGameLaunchSplashMaximumWaitMs",
        Some(&config.game_launch_splash_maximum_wait_ms.to_string()),
    )?;
    set_setting(&transaction, "fullscreenGameLaunchSplashLogoPosition", Some(&config.game_launch_splash_logo_position))?;
    set_setting(
        &transaction,
        "fullscreenGameLaunchSplashBackgroundDimming",
        Some(&config.game_launch_splash_background_dimming.to_string()),
    )?;
    set_setting(&transaction, "fullscreenGameLaunchSplashSelectionMode", Some(&config.game_launch_splash_selection_mode))?;
    set_setting(&transaction, "fullscreenLibraryLayout", Some(&config.library_layout))?;
    set_setting(&transaction, "fullscreenDetailsLayout", Some(&config.details_layout))?;
    set_setting(&transaction, "fullscreenColorPreset", Some(&config.color_preset))?;
    set_setting(&transaction, "fullscreenDynamicColors", Some(if config.dynamic_colors { "1" } else { "0" }))?;
    set_setting(&transaction, "fullscreenEffects", Some(&config.effects))?;
    set_setting(&transaction, "fullscreenInterface", Some(&config.interface))?;
    set_setting(&transaction, "fullscreenLoginScreen", Some(if config.login_screen { "1" } else { "0" }))?;
    set_setting(&transaction, "fullscreenTrailers", Some(&config.trailers))?;
    set_setting(&transaction, "fullscreenSetupDone", Some(if config.setup_done { "1" } else { "0" }))?;
    set_setting(&transaction, "fullscreenCoverRows", Some(&config.cover_rows.to_string()))?;
    set_setting(&transaction, "fullscreenShowClock", Some(if config.show_clock { "1" } else { "0" }))?;
    set_setting(&transaction, "fullscreenUiSounds", Some(if config.ui_sounds { "1" } else { "0" }))?;
    set_setting(&transaction, "fullscreenUiSoundsVolume", Some(&config.ui_sounds_volume.to_string()))?;
    set_setting(&transaction, "fullscreenSwapConfirm", Some(if config.swap_confirm { "1" } else { "0" }))?;
    set_setting(&transaction, "fullscreenPlaytroveTrailers", Some(&config.playtrove_trailers))?;
    transaction.commit()?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{get_setting, set_setting};
    use crate::test_support::memory_database;
    use serde_json::json;

    #[test]
    fn splash_defaults_limits_and_patch_validation_are_atomic() {
        let db = memory_database();
        let defaults = serde_json::to_value(get_config(&db)).unwrap();
        for (key, value) in [
            ("gameLaunchSplashEnabled", json!(true)),
            ("gameLaunchSplashMinimumDurationMs", json!(2400)),
            ("gameLaunchSplashMaximumWaitMs", json!(90000)),
            ("gameLaunchSplashShowLogo", json!(true)),
            ("gameLaunchSplashLogoPosition", json!("leftCenter")),
            ("gameLaunchSplashBackgroundDimming", json!(95.0 / 255.0)),
            ("gameLaunchSplashSelectionMode", json!("automatic")),
        ] {
            assert_eq!(defaults[key], value, "{key}");
        }
        for patch in [
            json!({"gameLaunchSplashMinimumDurationMs": 500, "gameLaunchSplashMaximumWaitMs": 1000, "gameLaunchSplashBackgroundDimming": 0}),
            json!({"gameLaunchSplashMinimumDurationMs": 600000, "gameLaunchSplashMaximumWaitMs": 120000, "gameLaunchSplashBackgroundDimming": 0.8}),
            json!({"gameLaunchSplashEnabled": false, "gameLaunchSplashShowLogo": false, "gameLaunchSplashSelectionMode": "global", "profileAvatar": "custom"}),
        ] {
            let saved = set_config(&db, &patch, Language::En).unwrap();
            assert_eq!(get_config(&db), saved);
            let serialized = serde_json::to_value(saved).unwrap();
            for (key, value) in patch.as_object().unwrap() {
                if key == "gameLaunchSplashBackgroundDimming" {
                    assert_eq!(serialized[key].as_f64(), value.as_f64(), "{key}");
                } else {
                    assert_eq!(&serialized[key], value, "{key}");
                }
            }
        }
        for position in [
            "leftTop",
            "leftCenter",
            "leftBottom",
            "centerTop",
            "center",
            "centerBottom",
            "rightTop",
            "rightCenter",
            "rightBottom",
        ] {
            let saved = set_config(&db, &json!({"gameLaunchSplashLogoPosition": position}), Language::En).unwrap();
            assert_eq!(serde_json::to_value(saved).unwrap()["gameLaunchSplashLogoPosition"], position);
        }
        let before = get_config(&db);
        for invalid in [
            json!({"gameLaunchSplashEnabled": 1}),
            json!({"gameLaunchSplashShowLogo": "true"}),
            json!({"gameLaunchSplashMinimumDurationMs": 499}),
            json!({"gameLaunchSplashMinimumDurationMs": 600001}),
            json!({"gameLaunchSplashMinimumDurationMs": 500.5}),
            json!({"gameLaunchSplashMinimumDurationMs": "2400"}),
            json!({"gameLaunchSplashMaximumWaitMs": 999}),
            json!({"gameLaunchSplashMaximumWaitMs": 120001}),
            json!({"gameLaunchSplashMaximumWaitMs": -1}),
            json!({"gameLaunchSplashMaximumWaitMs": null}),
            json!({"gameLaunchSplashBackgroundDimming": -0.01}),
            json!({"gameLaunchSplashBackgroundDimming": 0.80001}),
            json!({"gameLaunchSplashBackgroundDimming": "NaN"}),
            json!({"gameLaunchSplashBackgroundDimming": null}),
            json!({"gameLaunchSplashLogoPosition": "Center"}),
            json!({"gameLaunchSplashSelectionMode": "video"}),
        ] {
            let mut patch = invalid.as_object().unwrap().clone();
            patch.insert("profileName".into(), json!("Changed"));
            assert!(set_config(&db, &Value::Object(patch), Language::En).is_err());
            assert_eq!(get_config(&db), before);
        }
    }

    #[test]
    fn splash_corrupt_persisted_values_fall_back_and_late_write_failure_rolls_back_every_field() {
        let db = memory_database();
        for (key, value) in [
            ("fullscreenGameLaunchSplashEnabled", "unknown"),
            ("fullscreenGameLaunchSplashShowLogo", "9"),
            ("fullscreenGameLaunchSplashMinimumDurationMs", "600001"),
            ("fullscreenGameLaunchSplashMaximumWaitMs", "999"),
            ("fullscreenGameLaunchSplashLogoPosition", "wrong"),
            ("fullscreenGameLaunchSplashSelectionMode", "external"),
        ] {
            set_setting(&db, key, Some(value)).unwrap();
        }
        for invalid in ["NaN", "inf", "-inf", "0.80001", "-1", "not-a-number"] {
            set_setting(&db, "fullscreenGameLaunchSplashBackgroundDimming", Some(invalid)).unwrap();
            assert_eq!(get_config(&db), get_config(&memory_database()));
        }
        let clean = memory_database();
        clean.execute_batch("CREATE TRIGGER fail_splash BEFORE INSERT ON settings WHEN NEW.key='fullscreenGameLaunchSplashSelectionMode' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;").unwrap();
        let before = get_config(&clean);
        assert!(
            set_config(
                &clean,
                &json!({"musicVolume": 80, "gameLaunchSplashMinimumDurationMs": 500, "gameLaunchSplashSelectionMode": "global"}),
                Language::En
            )
            .is_err()
        );
        assert_eq!(get_config(&clean), before);
        assert_eq!(get_setting(&clean, "fullscreenTheme").unwrap(), None);
        assert_eq!(get_setting(&clean, "fullscreenGameLaunchSplashMinimumDurationMs").unwrap(), None);
    }

    #[test]
    fn apresentacao_aniki_aceita_tempos_da_referencia_e_rejeita_patch_parcial() {
        let db = memory_database();
        let patch = json!({"startupIntroVideoEnabled": false, "shutdownVideoEnabled": false,
            "screenSaverEnabled": true, "screenSaverIdleDelayMinutes": -30,
            "screenSaverChangeIntervalSeconds": 300, "screenSaverSource": "weighted"});
        let saved = set_config(&db, &patch, Language::PtBr).unwrap();
        let saved = serde_json::to_value(saved).unwrap();
        assert_eq!(saved["screenSaverIdleDelayMinutes"], -30);
        assert_eq!(saved["screenSaverChangeIntervalSeconds"], 300);
        for invalid in [
            json!({"screenSaverIdleDelayMinutes": -1}),
            json!({"screenSaverIdleDelayMinutes": 0}),
            json!({"screenSaverIdleDelayMinutes": 121}),
            json!({"screenSaverIdleDelayMinutes": 1.5}),
            json!({"screenSaverChangeIntervalSeconds": 4}),
            json!({"screenSaverChangeIntervalSeconds": 301}),
            json!({"screenSaverSource": "external"}),
        ] {
            let mut invalid = invalid;
            invalid["startupIntroVideoEnabled"] = json!(true);
            assert!(set_config(&db, &invalid, Language::PtBr).is_err());
            assert_eq!(serde_json::to_value(get_config(&db)).unwrap(), saved);
        }
    }

    #[test]
    fn padroes_e_contrato_serializado() {
        let db = memory_database();
        let mut expected = json!({
            "theme": "playtrove", "startOnLaunch": false, "musicPlayback": true, "musicVolume": 20,
            "startDestination": "hub", "profileName": "", "profileAvatar": "gamepad",
            "controllerIconStyle": "playstation", "anikiAvatarIndex": null,
            "inGameOverlayEnabled": false, "inGameOverlayHotkey": "CtrlShiftF12",
            "startupIntroVideoEnabled": true, "shutdownVideoEnabled": true, "screenSaverEnabled": true,
            "screenSaverIdleDelayMinutes": 1, "screenSaverChangeIntervalSeconds": 15, "screenSaverSource": "installed",
            "screenSaverAmbientMusicEnabled": true, "screenSaverShowLogo": true, "screenSaverShowInfoCard": true,
            "screenSaverAnimateBackground": true, "screenSaverUseFadeTransitions": true,
            "libraryLayout": "horizontal", "detailsLayout": "signature",
            "colorPreset": "default", "dynamicColors": false, "effects": "balanced",
            "interface": "standard", "loginScreen": false, "trailers": "details", "setupDone": false,
            "coverRows": 1, "showClock": true, "uiSounds": true, "uiSoundsVolume": 40, "swapConfirm": false,
            "playtroveTrailers": "all",
        });
        expected.as_object_mut().unwrap().extend(
            json!({
                "gameLaunchSplashEnabled": true, "gameLaunchSplashMinimumDurationMs": 2400,
                "gameLaunchSplashMaximumWaitMs": 90000, "gameLaunchSplashShowLogo": true,
                "gameLaunchSplashLogoPosition": "leftCenter", "gameLaunchSplashBackgroundDimming": 95.0 / 255.0,
                "gameLaunchSplashSelectionMode": "automatic",
            })
            .as_object()
            .unwrap()
            .clone(),
        );
        assert_eq!(serde_json::to_value(get_config(&db)).unwrap(), expected);
    }

    #[test]
    fn patches_persistem_sem_alterar_as_preferencias_desktop() {
        let db = memory_database();
        set_setting(&db, "themeMusicVolume", Some("72")).unwrap();
        set_config(&db, &json!({"startOnLaunch": true, "musicVolume": 100}), Language::PtBr).unwrap();
        let saved = set_config(&db, &json!({"musicPlayback": false}), Language::PtBr).unwrap();
        assert_eq!(
            saved,
            FullscreenConfig {
                start_on_launch: true,
                music_playback: false,
                music_volume: 100,
                ..get_config(&memory_database())
            }
        );
        assert_eq!(get_config(&db), saved);
        assert_eq!(get_setting(&db, "themeMusicVolume").unwrap().as_deref(), Some("72"));
        assert_eq!(set_config(&db, &json!({"musicVolume": 0}), Language::PtBr).unwrap().music_volume, 0);
        assert_eq!(set_config(&db, &json!({}), Language::PtBr).unwrap(), get_config(&db));
    }

    #[test]
    fn patches_invalidos_sao_rejeitados_por_inteiro() {
        let db = memory_database();
        let before = get_config(&db);
        for invalid in [
            json!(null),
            json!([]),
            json!(true),
            json!({"other": true}),
            json!({"startOnLaunch": 1}),
            json!({"musicPlayback": "false"}),
            json!({"musicVolume": -1}),
            json!({"musicVolume": 101}),
            json!({"musicVolume": 2.5}),
            json!({"musicVolume": "20"}),
            json!({"musicVolume": null}),
            json!({"startOnLaunch": true, "musicVolume": 300}),
            json!({"startDestination": "details"}),
            json!({"startDestination": null}),
            json!({"profileName": 7}),
            json!({"profileName": "a".repeat(33)}),
            json!({"profileName": "nome\nquebrado"}),
            json!({"profileAvatar": "personagem"}),
            json!({"libraryLayout": "grade"}),
            json!({"detailsLayout": "Signature"}),
            json!({"detailsLayout": 1}),
            json!({"colorPreset": "neon"}),
            json!({"dynamicColors": "true"}),
            json!({"effects": "maximo"}),
            json!({"interface": "minima"}),
            json!({"trailers": "sempre"}),
            json!({"loginScreen": 1}),
            json!({"setupDone": null}),
            json!({"theme": "Aniki"}),
            json!({"coverRows": 0}),
            json!({"coverRows": 4}),
            json!({"coverRows": 260}),
            json!({"showClock": "sim"}),
            json!({"uiSoundsVolume": 101}),
            json!({"swapConfirm": 1}),
            json!({"playtroveTrailers": "sempre"}),
            json!({"theme": null}),
        ] {
            assert!(set_config(&db, &invalid, Language::En).is_err(), "patch aceito: {invalid}");
            assert_eq!(get_config(&db), before);
        }
    }

    #[test]
    fn falha_na_gravacao_reverte_o_patch() {
        let db = memory_database();
        db.execute_batch("CREATE TRIGGER falha_fullscreen BEFORE INSERT ON settings WHEN NEW.key = 'fullscreenMusicVolume' BEGIN SELECT RAISE(ABORT, 'falha simulada'); END;").unwrap();
        assert!(set_config(&db, &json!({"startOnLaunch": true, "musicVolume": 50}), Language::PtBr).is_err());
        assert!(!get_config(&db).start_on_launch);
        assert_eq!(get_setting(&db, "fullscreenStartOnLaunch").unwrap(), None);
    }

    #[test]
    fn valores_persistidos_invalidos_voltam_aos_padroes() {
        let db = memory_database();
        set_setting(&db, "fullscreenStartOnLaunch", Some("inválido")).unwrap();
        set_setting(&db, "fullscreenMusicPlayback", Some("inválido")).unwrap();
        set_setting(&db, "fullscreenMusicVolume", Some("250")).unwrap();
        set_setting(&db, "fullscreenStartDestination", Some("detalhes")).unwrap();
        set_setting(&db, "fullscreenProfileName", Some(" nome com espaço ")).unwrap();
        set_setting(&db, "fullscreenProfileAvatar", Some("personagem")).unwrap();
        set_setting(&db, "fullscreenLibraryLayout", Some("grade")).unwrap();
        set_setting(&db, "fullscreenDetailsLayout", Some("outro")).unwrap();
        set_setting(&db, "fullscreenColorPreset", Some("neon")).unwrap();
        set_setting(&db, "fullscreenDynamicColors", Some("talvez")).unwrap();
        set_setting(&db, "fullscreenEffects", Some("maximo")).unwrap();
        set_setting(&db, "fullscreenInterface", Some("minima")).unwrap();
        set_setting(&db, "fullscreenTrailers", Some("sempre")).unwrap();
        assert_eq!(get_config(&db), get_config(&memory_database()));
    }

    #[test]
    fn perfil_e_destino_do_inicio_persistem() {
        let db = memory_database();
        let saved = set_config(
            &db,
            &json!({"startDestination": "library", "profileName": "  Ação Jogador  ", "profileAvatar": "crown"}),
            Language::PtBr,
        )
        .unwrap();
        assert_eq!(saved.start_destination, StartDestination::Library);
        assert_eq!(saved.profile_name, "Ação Jogador");
        assert_eq!(saved.profile_avatar, "crown");
        assert_eq!(get_config(&db), saved);
        assert_eq!(set_config(&db, &json!({"profileName": ""}), Language::PtBr).unwrap().profile_name, "");
    }

    #[test]
    fn layouts_da_biblioteca_e_dos_detalhes_persistem() {
        let db = memory_database();
        for layout in LIBRARY_LAYOUTS {
            assert_eq!(set_config(&db, &json!({"libraryLayout": layout}), Language::PtBr).unwrap().library_layout, layout);
        }
        for layout in DETAILS_LAYOUTS {
            assert_eq!(set_config(&db, &json!({"detailsLayout": layout}), Language::PtBr).unwrap().details_layout, layout);
        }
        assert_eq!(get_config(&db).details_layout, "panel");
    }

    #[test]
    fn paleta_cor_dinamica_e_efeitos_persistem() {
        let db = memory_database();
        let saved = set_config(
            &db,
            &json!({"colorPreset": "orbis-blue", "dynamicColors": true, "effects": "performance"}),
            Language::PtBr,
        )
        .unwrap();
        assert_eq!(
            (saved.color_preset.as_str(), saved.dynamic_colors, saved.effects.as_str()),
            ("orbis-blue", true, "performance")
        );
        assert_eq!(get_config(&db), saved);
        assert!(COLOR_PRESETS.contains(&"sapphire-prestige") && COLOR_PRESETS[0] == "default");
    }

    #[test]
    fn interface_login_trailers_e_assistente_persistem() {
        let db = memory_database();
        let saved = set_config(
            &db,
            &json!({"interface": "complete", "loginScreen": true, "trailers": "all", "setupDone": true}),
            Language::PtBr,
        )
        .unwrap();
        assert_eq!(
            (saved.interface.as_str(), saved.login_screen, saved.trailers.as_str(), saved.setup_done),
            ("complete", true, "all", true)
        );
        assert_eq!(get_config(&db), saved);
    }

    #[test]
    fn preferencias_do_tema_playtrove_persistem() {
        let db = memory_database();
        let saved = set_config(
            &db,
            &json!({"coverRows": 3, "showClock": false, "uiSounds": false, "uiSoundsVolume": 0, "swapConfirm": true, "playtroveTrailers": "details"}),
            Language::PtBr,
        )
        .unwrap();
        assert_eq!(
            (
                saved.cover_rows,
                saved.show_clock,
                saved.ui_sounds,
                saved.ui_sounds_volume,
                saved.swap_confirm,
                saved.playtrove_trailers.as_str()
            ),
            (3, false, false, 0, true, "details")
        );
        assert_eq!(get_config(&db), saved);
        set_setting(&db, "fullscreenCoverRows", Some("9")).unwrap();
        assert_eq!(get_config(&db).cover_rows, 1);
    }

    #[test]
    fn tema_persiste_e_valor_desconhecido_volta_ao_playtrove() {
        let db = memory_database();
        assert_eq!(set_config(&db, &json!({"theme": "aniki"}), Language::PtBr).unwrap().theme, "aniki");
        assert_eq!(get_config(&db).theme, "aniki");
        set_setting(&db, "fullscreenTheme", Some("outro")).unwrap();
        assert_eq!(get_config(&db).theme, "playtrove");
    }

    #[test]
    fn aparencia_do_pacote_persiste_sem_substituir_o_avatar_proprio() {
        let db = memory_database();
        let saved = set_config(
            &db,
            &json!({"profileAvatar": "crown", "controllerIconStyle": "switch-dark", "anikiAvatarIndex": 61}),
            Language::PtBr,
        )
        .unwrap();
        let value = serde_json::to_value(&saved).unwrap();
        assert_eq!(value["controllerIconStyle"], "switch-dark");
        assert_eq!(value["anikiAvatarIndex"], 61);
        assert_eq!(saved.profile_avatar, "crown");
        assert_eq!(get_config(&db), saved);
        let own = set_config(&db, &json!({"anikiAvatarIndex": null}), Language::PtBr).unwrap();
        assert!(serde_json::to_value(&own).unwrap()["anikiAvatarIndex"].is_null());
        assert_eq!(own.profile_avatar, "crown");
        assert_eq!(get_config(&db), own);
    }

    #[test]
    fn aparencia_invalida_rejeita_o_patch_inteiro() {
        let db = memory_database();
        for invalid in [
            json!({"controllerIconStyle": "dualsense"}),
            json!({"controllerIconStyle": null}),
            json!({"anikiAvatarIndex": 0}),
            json!({"anikiAvatarIndex": 62}),
            json!({"anikiAvatarIndex": -1}),
            json!({"anikiAvatarIndex": 1.5}),
            json!({"anikiAvatarIndex": "2"}),
            json!({"anikiAvatarIndex": true}),
        ] {
            let mut patch = invalid.as_object().unwrap().clone();
            patch.insert("profileAvatar".to_string(), json!("star"));
            assert!(set_config(&db, &Value::Object(patch), Language::PtBr).is_err());
            assert_eq!(get_config(&db).profile_avatar, "gamepad");
        }
    }

    #[test]
    fn aparencia_persistida_invalida_preserva_o_perfil_antigo() {
        let db = memory_database();
        set_setting(&db, "fullscreenProfileAvatar", Some("trophy")).unwrap();
        set_setting(&db, "fullscreenControllerIconStyle", Some("invalid")).unwrap();
        set_setting(&db, "fullscreenAnikiAvatarIndex", Some("99")).unwrap();
        let value = serde_json::to_value(get_config(&db)).unwrap();
        assert_eq!(value["controllerIconStyle"], "playstation");
        assert!(value["anikiAvatarIndex"].is_null());
        assert_eq!(value["profileAvatar"], "trophy");
    }

    #[test]
    fn preferencias_do_overlay_sao_validadas_e_persistidas_sem_patch_parcial() {
        let db = memory_database();
        let saved =
            set_config(&db, &json!({"inGameOverlayEnabled": true, "inGameOverlayHotkey": "AltF12"}), Language::PtBr).unwrap();
        let value = serde_json::to_value(&saved).unwrap();
        assert_eq!(value["inGameOverlayEnabled"], true);
        assert_eq!(value["inGameOverlayHotkey"], "AltF12");
        assert_eq!(get_config(&db), saved);
        for patch in
            [json!({"inGameOverlayEnabled": "true"}), json!({"inGameOverlayEnabled": false, "inGameOverlayHotkey": "CtrlF9"})]
        {
            assert!(set_config(&db, &patch, Language::PtBr).is_err());
            assert_eq!(get_config(&db), saved);
        }
    }
}
