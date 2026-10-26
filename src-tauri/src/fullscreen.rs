//! Preferências independentes do modo de tela cheia.

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

use crate::errors::{AppError, AppResult};
use crate::i18n::Language;
use crate::settings::{get_setting, set_setting};
use crate::validation::to_bool;

pub const CONFIG_EVENT: &str = "fullscreen:config";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullscreenConfig {
    pub start_on_launch: bool,
    pub music_playback: bool,
    pub music_volume: u8,
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
    }
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
            _ => return Err(invalid()),
        }
    }
    let transaction = db.unchecked_transaction()?;
    set_setting(&transaction, "fullscreenStartOnLaunch", Some(if config.start_on_launch { "1" } else { "0" }))?;
    set_setting(&transaction, "fullscreenMusicPlayback", Some(if config.music_playback { "1" } else { "0" }))?;
    set_setting(&transaction, "fullscreenMusicVolume", Some(&config.music_volume.to_string()))?;
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
            })
        );
    }

    #[test]
    fn patches_persistem_sem_alterar_as_preferencias_desktop() {
        let db = memory_database();
        set_setting(&db, "themeMusicVolume", Some("72")).unwrap();
        set_config(&db, &json!({"startOnLaunch": true, "musicVolume": 100}), Language::PtBr).unwrap();
        let saved = set_config(&db, &json!({"musicPlayback": false}), Language::PtBr).unwrap();
        assert_eq!(saved, FullscreenConfig { start_on_launch: true, music_playback: false, music_volume: 100 });
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
        assert_eq!(get_config(&db), FullscreenConfig { start_on_launch: false, music_playback: true, music_volume: 20 });
    }
}
