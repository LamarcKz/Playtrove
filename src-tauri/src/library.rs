//! A biblioteca que a interface mostra: os jogos, os status e as regras automáticas. Os campos e as
//! regras são os mesmos do app em Electron (src/main/library.ts), e o formato é o de LibrarySnapshot
//! (src/shared/types.ts).

use std::cmp::Ordering;
use std::collections::HashMap;

use chrono::DateTime;
use rusqlite::Connection;
use serde::Serialize;
use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;

use crate::i18n::{Language, status_preset_name};
use crate::images::image_url;
use crate::settings::get_setting;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    games: Vec<Game>,
    statuses: Vec<Status>,
    rules: StatusRules,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    id: i64,
    name: String,
    position: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusRules {
    new_game_status_id: i64,
    first_play_status_id: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AchievementProgress {
    unlocked: i64,
    total: i64,
    platinum: bool,
    source: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Game {
    id: i64,
    title: String,
    status_id: i64,
    favorite: bool,
    playtime_minutes: i64,
    last_played_at: Option<String>,
    added_at: String,
    platform: Option<String>,
    library: Option<String>,
    rom_path: Option<String>,
    emulator_id: Option<String>,
    description: Option<String>,
    genres: Vec<String>,
    developers: Vec<String>,
    publishers: Vec<String>,
    release_date: Option<String>,
    cover_url: Option<String>,
    background_url: Option<String>,
    metadata_updated_at: Option<String>,
    rating: Option<i64>,
    difficulty: Option<i64>,
    review: Option<String>,
    achievements: Option<AchievementProgress>,
    trophies_pending: bool,
}

/// Tudo o que a interface precisa: jogos, status e regras.
pub fn get_library(db: &Connection, language: Language) -> rusqlite::Result<LibrarySnapshot> {
    Ok(LibrarySnapshot { games: list_games(db)?, statuses: list_statuses(db, language)?, rules: status_rules(db, language)? })
}

/// Os jogos, em ordem alfabética (ignorando acentos e maiúsculas).
fn list_games(db: &Connection) -> rusqlite::Result<Vec<Game>> {
    let mut achievements = progress_by_game(db)?;
    let waiting_for_trophies = games_waiting_for_trophies(db)?;
    let mut query = db.prepare(
        "SELECT id, title, status_id, favorite, playtime_seconds, last_played_at, added_at, platform, library,
                rom_path, emulator_id, description, genres, developer, publisher, release_date, cover_image,
                background_image, metadata_updated_at, emulator_playtime_seconds, emulator_last_played_at,
                rating, difficulty, review
         FROM games",
    )?;
    let mut games = query
        .query_map([], |row| {
            let id: i64 = row.get("id")?;
            let metadata_updated_at: Option<String> = row.get("metadata_updated_at")?;
            let image = |file: Option<String>| file.map(|file| image_url(id, &file, metadata_updated_at.as_deref()));
            // Vale o maior tempo entre o contado pelo app e o registrado pelo emulador (que inclui o que
            // foi jogado fora do app), e a última vez mais recente das duas.
            let seconds = row.get::<_, i64>("playtime_seconds")?.max(row.get("emulator_playtime_seconds")?);
            let achievements = achievements.remove(&id);
            Ok(Game {
                id,
                title: row.get("title")?,
                status_id: row.get("status_id")?,
                favorite: row.get::<_, i64>("favorite")? == 1,
                playtime_minutes: playtime_minutes(seconds),
                last_played_at: latest(row.get("last_played_at")?, row.get("emulator_last_played_at")?),
                added_at: row.get("added_at")?,
                platform: row.get("platform")?,
                library: row.get("library")?,
                rom_path: row.get("rom_path")?,
                emulator_id: row.get("emulator_id")?,
                description: row.get("description")?,
                genres: parse_list(row.get("genres")?),
                developers: parse_list(row.get("developer")?),
                publishers: parse_list(row.get("publisher")?),
                release_date: row.get("release_date")?,
                cover_url: image(row.get("cover_image")?),
                background_url: image(row.get("background_image")?),
                rating: row.get("rating")?,
                difficulty: row.get("difficulty")?,
                review: row.get("review")?,
                trophies_pending: achievements.is_none() && waiting_for_trophies.contains(&id),
                achievements,
                metadata_updated_at,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    games.sort_by(|a, b| compare_titles(&a.title, &b.title));
    Ok(games)
}

/// Jogado por menos de um minuto conta como 1 min (e não como "nunca jogado").
fn playtime_minutes(seconds: i64) -> i64 {
    if seconds > 0 { ((seconds as f64 / 60.0).round() as i64).max(1) } else { 0 }
}

/// A data mais recente (ISO) entre duas, ignorando as vazias.
fn latest(a: Option<String>, b: Option<String>) -> Option<String> {
    match (a, b) {
        (Some(a), Some(b)) => match (DateTime::parse_from_rfc3339(&a), DateTime::parse_from_rfc3339(&b)) {
            (Ok(first), Ok(second)) if first >= second => Some(a),
            _ => Some(b),
        },
        (a, b) => a.or(b),
    }
}

/// Lê uma lista guardada como JSON (ex.: ["Racing"]). Qualquer coisa estranha vira lista vazia.
fn parse_list(value: Option<String>) -> Vec<String> {
    let Some(value) = value else { return Vec::new() };
    match serde_json::from_str::<serde_json::Value>(&value) {
        Ok(serde_json::Value::Array(items)) => items.into_iter().filter_map(|item| item.as_str().map(str::to_string)).collect(),
        _ => Vec::new(),
    }
}

/// Compara dois nomes como a ordem alfabética do app: sem diferença entre maiúsculas e minúsculas nem
/// acentos, e com espaços e pontuação antes dos números, e os números antes das letras.
fn compare_titles(a: &str, b: &str) -> Ordering {
    sort_key(a).cmp(&sort_key(b))
}

fn sort_key(title: &str) -> Vec<(u8, char)> {
    title
        .nfd()
        .filter(|character| !is_combining_mark(*character))
        .flat_map(char::to_lowercase)
        .map(|character| {
            let group = if character.is_whitespace() {
                0
            } else if character.is_ascii_punctuation() {
                1
            } else if character.is_numeric() {
                2
            } else {
                3
            };
            (group, character)
        })
        .collect()
}

/// O progresso de cada jogo nas conquistas (id do jogo → pegos, total e platina): os troféus do RPCS3
/// e, por cima, o RetroAchievements.
fn progress_by_game(db: &Connection) -> rusqlite::Result<HashMap<i64, AchievementProgress>> {
    let mut progress = trophy_progress_by_game(db)?;
    let mut query = db.prepare(
        "SELECT g.id, COUNT(a.id), COUNT(a.earned_at)
         FROM games g JOIN ra_games rg ON rg.id = g.ra_game_id JOIN achievements a ON a.ra_game_id = g.ra_game_id
         GROUP BY g.id",
    )?;
    let rows = query.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)))?;
    for row in rows {
        let (game_id, total, unlocked) = row?;
        let platinum = total > 0 && unlocked == total;
        progress.insert(game_id, AchievementProgress { unlocked, total, platinum, source: "retroachievements" });
    }
    Ok(progress)
}

fn trophy_progress_by_game(db: &Connection) -> rusqlite::Result<HashMap<i64, AchievementProgress>> {
    let mut query =
        db.prepare("SELECT g.id, t.grade, t.unlocked_at IS NOT NULL FROM games g JOIN trophies t ON t.set_id = g.trophy_set")?;
    let mut by_game: HashMap<i64, Vec<(String, bool)>> = HashMap::new();
    for row in query.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, bool>(2)?)))? {
        let (game_id, grade, earned) = row?;
        by_game.entry(game_id).or_default().push((grade, earned));
    }
    Ok(by_game
        .into_iter()
        .map(|(game_id, trophies)| {
            let unlocked = trophies.iter().filter(|(_, earned)| *earned).count() as i64;
            let progress =
                AchievementProgress { unlocked, total: trophies.len() as i64, platinum: is_platinum(&trophies), source: "rpcs3" };
            (game_id, progress)
        })
        .collect())
}

/// A platina do PS3: o troféu de platina pego; num conjunto sem platina, todos os troféus pegos.
fn is_platinum(trophies: &[(String, bool)]) -> bool {
    let platinum: Vec<_> = trophies.iter().filter(|(grade, _)| grade == "platina").collect();
    if platinum.is_empty() {
        !trophies.is_empty() && trophies.iter().all(|(_, earned)| *earned)
    } else {
        platinum.iter().any(|(_, earned)| *earned)
    }
}

/// Os jogos de PS3 com conjunto de troféus (do disco) que o RPCS3 ainda não instalou.
fn games_waiting_for_trophies(db: &Connection) -> rusqlite::Result<Vec<i64>> {
    db.prepare("SELECT id FROM games WHERE trophy_set IS NOT NULL AND trophy_set NOT IN (SELECT DISTINCT set_id FROM trophies)")?
        .query_map([], |row| row.get(0))?
        .collect()
}

/// Os status, na ordem das colunas do Kanban, com o nome no idioma do app: o dos status que vêm com o
/// app sai do dicionário; o dos outros é o que o usuário escreveu.
fn list_statuses(db: &Connection, language: Language) -> rusqlite::Result<Vec<Status>> {
    db.prepare("SELECT id, name, preset, position FROM statuses ORDER BY position")?
        .query_map([], |row| {
            let preset: Option<String> = row.get("preset")?;
            let name = preset.and_then(|preset| status_preset_name(language, &preset));
            Ok(Status { id: row.get("id")?, name: name.map_or_else(|| row.get("name"), Ok)?, position: row.get("position")? })
        })?
        .collect()
}

/// As regras automáticas de status (sem regra gravada, vale o primeiro status).
fn status_rules(db: &Connection, language: Language) -> rusqlite::Result<StatusRules> {
    let first = list_statuses(db, language)?.first().map_or(0, |status| status.id);
    let rule = |key: &str| -> rusqlite::Result<i64> {
        let saved = get_setting(db, key)?.and_then(|value| value.parse::<i64>().ok());
        Ok(saved.filter(|id| *id != 0).unwrap_or(first))
    };
    Ok(StatusRules { new_game_status_id: rule("newGameStatusId")?, first_play_status_id: rule("firstPlayStatusId")? })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::run_migrations;

    fn library_database() -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        db
    }

    fn add_game(db: &Connection, title: &str) -> i64 {
        db.execute("INSERT INTO games (title, status_id, added_at) VALUES (?1, 1, '2026-10-01T12:00:00.000Z')", [title]).unwrap();
        db.last_insert_rowid()
    }

    #[test]
    fn os_status_padrao_mudam_de_nome_com_o_idioma_e_os_renomeados_nao() {
        let db = library_database();
        db.execute("UPDATE statuses SET name = 'Na fila', preset = NULL WHERE position = 0", []).unwrap();
        let names = |language| list_statuses(&db, language).unwrap().into_iter().map(|status| status.name).collect::<Vec<_>>();
        assert_eq!(names(Language::PtBr)[..2], ["Na fila", "Parei por um tempo"]);
        assert_eq!(names(Language::En)[..2], ["Na fila", "On hold"]);
    }

    #[test]
    fn os_jogos_saem_em_ordem_alfabetica_sem_contar_acentos_nem_maiusculas() {
        let db = library_database();
        for title in ["zelda", "Ávalon", "Crash Bandicoot", "Burnout 3", "Burnout"] {
            add_game(&db, title);
        }
        let titles: Vec<_> = list_games(&db).unwrap().into_iter().map(|game| game.title).collect();
        assert_eq!(titles, ["Ávalon", "Burnout", "Burnout 3", "Crash Bandicoot", "zelda"]);
    }

    #[test]
    fn vale_o_maior_tempo_e_a_ultima_vez_mais_recente() {
        let db = library_database();
        let id = add_game(&db, "Jogo");
        db.execute(
            "UPDATE games SET playtime_seconds = 600, emulator_playtime_seconds = 1500,
               last_played_at = '2026-10-02T10:00:00.000Z', emulator_last_played_at = '2026-10-05T08:30:00.000Z',
               genres = '[\"Racing\",3]', cover_image = 'cover.png', metadata_updated_at = '2026-10-03T00:00:00.000Z'
             WHERE id = ?1",
            [id],
        )
        .unwrap();
        let game = list_games(&db).unwrap().remove(0);
        assert_eq!(game.playtime_minutes, 25);
        assert_eq!(game.last_played_at.as_deref(), Some("2026-10-05T08:30:00.000Z"));
        assert_eq!(game.genres, ["Racing"]);
        assert_eq!(
            game.cover_url.as_deref(),
            Some(format!("http://playtrove-img.localhost/{id}/cover.png?v=2026-10-03T00%3A00%3A00.000Z").as_str())
        );
        assert_eq!(game.background_url, None);
    }

    #[test]
    fn menos_de_um_minuto_conta_como_um() {
        assert_eq!(playtime_minutes(0), 0);
        assert_eq!(playtime_minutes(5), 1);
        assert_eq!(playtime_minutes(90), 2);
    }

    #[test]
    fn o_progresso_vem_dos_trofeus_e_do_retroachievements() {
        let db = library_database();
        let ps3 = add_game(&db, "Jogo de PS3");
        let gba = add_game(&db, "Jogo de GBA");
        let waiting = add_game(&db, "Jogo de PS3 sem abrir");
        db.execute("UPDATE games SET trophy_set = 'NPWR00001_00' WHERE id = ?1", [ps3]).unwrap();
        db.execute("UPDATE games SET trophy_set = 'NPWR00002_00' WHERE id = ?1", [waiting]).unwrap();
        db.execute_batch(
            "INSERT INTO trophies (set_id, id, name, grade, unlocked_at) VALUES
               ('NPWR00001_00', 0, 'Platina', 'platina', '2026-10-01T00:00:00.000Z'),
               ('NPWR00001_00', 1, 'Bronze', 'bronze', NULL);
             INSERT INTO ra_games (id, title, synced_at) VALUES (77, 'Jogo de GBA', '2026-10-01T00:00:00.000Z');
             INSERT INTO achievements (id, ra_game_id, title, earned_at) VALUES
               (1, 77, 'Primeira', '2026-10-01T00:00:00.000Z'), (2, 77, 'Segunda', '2026-10-02T00:00:00.000Z');",
        )
        .unwrap();
        db.execute("UPDATE games SET ra_game_id = 77 WHERE id = ?1", [gba]).unwrap();

        let games: HashMap<i64, Game> = list_games(&db).unwrap().into_iter().map(|game| (game.id, game)).collect();
        let trophies = games[&ps3].achievements.as_ref().unwrap();
        assert_eq!((trophies.unlocked, trophies.total, trophies.platinum, trophies.source), (1, 2, true, "rpcs3"));
        let retro = games[&gba].achievements.as_ref().unwrap();
        assert_eq!((retro.unlocked, retro.total, retro.platinum, retro.source), (2, 2, true, "retroachievements"));
        assert!(games[&waiting].trophies_pending);
        assert!(!games[&ps3].trophies_pending);
    }

    #[test]
    fn sem_regra_gravada_vale_o_primeiro_status() {
        let db = library_database();
        db.execute("DELETE FROM settings WHERE key = 'firstPlayStatusId'", []).unwrap();
        let rules = status_rules(&db, Language::PtBr).unwrap();
        let first = list_statuses(&db, Language::PtBr).unwrap()[0].id;
        assert_eq!(rules.first_play_status_id, first);
        assert_ne!(rules.new_game_status_id, 0);
    }
}
