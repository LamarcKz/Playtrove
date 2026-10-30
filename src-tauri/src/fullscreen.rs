//! Preferências independentes do modo de tela cheia. As do tema Aniki ficam no próprio Aniki, no Playnite.

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

use crate::errors::{AppError, AppResult};
use crate::i18n::Language;
use crate::settings::{get_setting, set_setting};
use crate::validation::to_bool;

pub const CONFIG_EVENT: &str = "fullscreen:config";
/// Onde o trailer do tema Playtrove toca: na biblioteca e nos detalhes (padrão), só nos detalhes ou em
/// nenhum lugar.
pub const TRAILERS: [&str; 3] = ["all", "details", "off"];
/// Os temas da tela cheia, como os do Playnite: o próprio Playtrove (padrão) e o Aniki ReMake, que roda no
/// Playnite baixado das páginas oficiais (`theme_pack.rs`).
pub const THEMES: [&str; 2] = ["playtrove", "aniki"];
/// Quantas linhas de capas a biblioteca do tema Playtrove mostra (como no Playnite).
const COVER_ROWS: std::ops::RangeInclusive<u8> = 1..=3;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullscreenConfig {
    pub theme: String,
    pub start_on_launch: bool,
    pub music_playback: bool,
    pub music_volume: u8,
    /// Tema Playtrove: linhas de capas, relógio na barra do topo, sons da navegação e troca de × por ○ no
    /// controle.
    pub cover_rows: u8,
    pub show_clock: bool,
    pub ui_sounds: bool,
    pub ui_sounds_volume: u8,
    pub swap_confirm: bool,
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
        music_volume: number(db, "fullscreenMusicVolume").filter(|volume| *volume <= 100).unwrap_or(20),
        cover_rows: number(db, "fullscreenCoverRows").filter(|rows| COVER_ROWS.contains(rows)).unwrap_or(1),
        show_clock: boolean("fullscreenShowClock", true),
        ui_sounds: boolean("fullscreenUiSounds", true),
        ui_sounds_volume: number(db, "fullscreenUiSoundsVolume").filter(|volume| *volume <= 100).unwrap_or(40),
        swap_confirm: boolean("fullscreenSwapConfirm", false),
        playtrove_trailers: choice(db, "fullscreenPlaytroveTrailers", &TRAILERS),
    }
}

fn number(db: &Connection, key: &str) -> Option<u8> {
    get_setting(db, key).ok().flatten().and_then(|value| value.parse::<u8>().ok())
}

/// Um valor salvo que precisa estar na lista; qualquer outro volta ao primeiro (o padrão).
fn choice(db: &Connection, key: &str, options: &[&str]) -> String {
    get_setting(db, key)
        .ok()
        .flatten()
        .filter(|value| options.contains(&value.as_str()))
        .unwrap_or_else(|| options[0].to_string())
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
            _ => return Err(invalid()),
        }
    }
    let flag = |value: bool| Some(if value { "1" } else { "0" });
    let transaction = db.unchecked_transaction()?;
    set_setting(&transaction, "fullscreenTheme", Some(&config.theme))?;
    set_setting(&transaction, "fullscreenStartOnLaunch", flag(config.start_on_launch))?;
    set_setting(&transaction, "fullscreenMusicPlayback", flag(config.music_playback))?;
    set_setting(&transaction, "fullscreenMusicVolume", Some(&config.music_volume.to_string()))?;
    set_setting(&transaction, "fullscreenCoverRows", Some(&config.cover_rows.to_string()))?;
    set_setting(&transaction, "fullscreenShowClock", flag(config.show_clock))?;
    set_setting(&transaction, "fullscreenUiSounds", flag(config.ui_sounds))?;
    set_setting(&transaction, "fullscreenUiSoundsVolume", Some(&config.ui_sounds_volume.to_string()))?;
    set_setting(&transaction, "fullscreenSwapConfirm", flag(config.swap_confirm))?;
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
    fn padroes_e_contrato_serializado() {
        let db = memory_database();
        let expected = json!({
            "theme": "playtrove", "startOnLaunch": false, "musicPlayback": true, "musicVolume": 20,
            "coverRows": 1, "showClock": true, "uiSounds": true, "uiSoundsVolume": 40, "swapConfirm": false,
            "playtroveTrailers": "all",
        });
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
            // As preferências do Aniki em React não existem mais.
            json!({"libraryLayout": "horizontal"}),
            json!({"profileName": "Jogador"}),
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
        set_setting(&db, "fullscreenPlaytroveTrailers", Some("sempre")).unwrap();
        assert_eq!(get_config(&db), get_config(&memory_database()));
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
}
