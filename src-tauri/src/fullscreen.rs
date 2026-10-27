//! Preferências independentes do modo de tela cheia.

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

use crate::errors::{AppError, AppResult};
use crate::i18n::Language;
use crate::settings::{get_setting, set_setting};
use crate::validation::to_bool;

pub const CONFIG_EVENT: &str = "fullscreen:config";

/// Avatares próprios do Playtrove para o perfil do Aniki (os do tema têm arte de terceiros).
pub const AVATARS: [&str; 12] =
    ["gamepad", "trophy", "star", "crown", "ghost", "swords", "rocket", "flame", "skull", "sparkles", "shield", "zap"];
/// Layouts da biblioteca e dos detalhes do Aniki; o primeiro de cada lista é o padrão.
pub const LIBRARY_LAYOUTS: [&str; 3] = ["horizontal", "vertical", "list"];
pub const DETAILS_LAYOUTS: [&str; 6] = ["signature", "modern", "classic", "original", "showcase", "panel"];
/// Tamanho máximo do nome do perfil, em caracteres.
const PROFILE_NAME_MAX: usize = 32;

/// Onde a tela cheia abre, como no assistente do Aniki: no Welcome Hub ou na biblioteca.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StartDestination {
    Hub,
    Library,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullscreenConfig {
    pub start_on_launch: bool,
    pub music_playback: bool,
    pub music_volume: u8,
    pub start_destination: StartDestination,
    /// Vazio usa o nome padrão da tela ("Jogador").
    pub profile_name: String,
    pub profile_avatar: String,
    pub library_layout: String,
    pub details_layout: String,
}

pub fn get_config(db: &Connection) -> FullscreenConfig {
    let boolean = |key, default| match get_setting(db, key).ok().flatten().as_deref() {
        Some("1" | "true") => true,
        Some("0" | "false") => false,
        _ => default,
    };
    FullscreenConfig {
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
        library_layout: choice(db, "fullscreenLibraryLayout", &LIBRARY_LAYOUTS),
        details_layout: choice(db, "fullscreenDetailsLayout", &DETAILS_LAYOUTS),
    }
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
            "libraryLayout" => {
                config.library_layout =
                    value.as_str().filter(|layout| LIBRARY_LAYOUTS.contains(layout)).ok_or_else(invalid)?.to_string();
            }
            "detailsLayout" => {
                config.details_layout =
                    value.as_str().filter(|layout| DETAILS_LAYOUTS.contains(layout)).ok_or_else(invalid)?.to_string();
            }
            _ => return Err(invalid()),
        }
    }
    let transaction = db.unchecked_transaction()?;
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
    set_setting(&transaction, "fullscreenLibraryLayout", Some(&config.library_layout))?;
    set_setting(&transaction, "fullscreenDetailsLayout", Some(&config.details_layout))?;
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
    fn padroes_e_contrato_serializado() {
        let db = memory_database();
        assert_eq!(
            serde_json::to_value(get_config(&db)).unwrap(),
            json!({
                "startOnLaunch": false, "musicPlayback": true, "musicVolume": 20,
                "startDestination": "hub", "profileName": "", "profileAvatar": "gamepad",
                "libraryLayout": "horizontal", "detailsLayout": "signature",
            })
        );
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
}
