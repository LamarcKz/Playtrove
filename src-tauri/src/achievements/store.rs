//! O banco das conquistas do RetroAchievements: a conta, o catálogo de cada console, qual jogo de lá é
//! cada jogo da biblioteca, o progresso e o que as telas mostram.

use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use rusqlite::{Connection, OptionalExtension, Row};

use super::client::{RaAccount, RaCatalogGame, RaConsole, RaGameProgress};
use super::types::{
    AchievementGameRow, AchievementProgress, AchievementSource, GameAchievement, GameAchievements, UnlockedAchievement,
    count_grades, grade_for_points, rarity_of,
};
use crate::dates::iso;
use crate::errors::AppResult;
use crate::i18n::Language;
use crate::secrets::Secrets;
use crate::settings::{get_setting, set_setting};

/// Onde cada coisa fica na tabela settings (os mesmos nomes do Electron; a chave vai criptografada).
const USERNAME: &str = "raUsername";
const API_KEY: &str = "raApiKey";
const LAST_SYNC_AT: &str = "raLastSyncAt";
const LAST_ERROR: &str = "raLastError";
const CONSOLES: &str = "raConsoles";

fn catalog_at(console_id: i64) -> String {
    format!("raCatalogAt:{console_id}")
}

/// Mostra a insígnia de uma conquista (o endereço vem de badges.rs, que sabe onde ficam as imagens).
pub type BadgeUrl<'a> = &'a dyn Fn(Option<&str>, bool) -> Option<String>;

// ---------------------------------------------------------------- conta e situação

pub fn get_ra_account(db: &Connection, secrets: &Secrets) -> Option<RaAccount> {
    let username = get_setting(db, USERNAME).ok().flatten().filter(|name| !name.is_empty())?;
    Some(RaAccount { username, api_key: secrets.read(db, API_KEY)? })
}

/// Salva a conta (ou apaga, com None). Trocar de conta apaga o que era da conta anterior.
pub fn save_ra_account(db: &Connection, secrets: &Secrets, language: Language, account: Option<&RaAccount>) -> AppResult<()> {
    let username = account.map(|account| account.username.as_str());
    if get_setting(db, USERNAME)?.as_deref() != username {
        clear_user_progress(db)?;
    }
    set_setting(db, USERNAME, username)?;
    secrets.save(db, language, API_KEY, account.map(|account| account.api_key.as_str()))?;
    set_setting(db, LAST_SYNC_AT, None)?;
    set_setting(db, LAST_ERROR, None)?;
    Ok(())
}

pub fn get_ra_username(db: &Connection) -> Option<String> {
    get_setting(db, USERNAME).ok().flatten()
}

/// A última atualização que deu certo e o erro da última que falhou.
pub fn get_ra_status(db: &Connection) -> (Option<String>, Option<String>) {
    (get_setting(db, LAST_SYNC_AT).ok().flatten(), get_setting(db, LAST_ERROR).ok().flatten())
}

pub fn set_ra_last_sync(db: &Connection, at: &str) -> rusqlite::Result<()> {
    set_setting(db, LAST_SYNC_AT, Some(at))?;
    set_setting(db, LAST_ERROR, None)
}

pub fn set_ra_error(db: &Connection, message: &str) -> rusqlite::Result<()> {
    set_setting(db, LAST_ERROR, Some(message))
}

/// Esquece o que o usuário tinha desbloqueado (o catálogo e as ligações dos jogos continuam).
fn clear_user_progress(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch("UPDATE achievements SET earned_at = NULL, earned_hardcore_at = NULL; DELETE FROM ra_games;")
}

// ---------------------------------------------------------------- consoles e catálogo

/// Os consoles guardados, se forem de menos de 30 dias.
pub fn load_consoles(db: &Connection, now: DateTime<Utc>) -> Option<Vec<RaConsole>> {
    let saved: serde_json::Value = serde_json::from_str(&get_setting(db, CONSOLES).ok()??).ok()?;
    let at = DateTime::parse_from_rfc3339(saved.get("at")?.as_str()?).ok()?;
    if now - at.with_timezone(&Utc) >= Duration::days(30) {
        return None;
    }
    serde_json::from_value(saved.get("list")?.clone()).ok()
}

pub fn save_consoles(db: &Connection, consoles: &[RaConsole], now: DateTime<Utc>) -> rusqlite::Result<()> {
    let saved = serde_json::json!({ "at": iso(now), "list": consoles });
    set_setting(db, CONSOLES, Some(&saved.to_string()))
}

/// O catálogo de um console, se tiver sido buscado há menos de 7 dias (o RetroAchievements pede para guardar).
pub fn load_catalog(db: &Connection, console_id: i64, now: DateTime<Utc>) -> rusqlite::Result<Option<Vec<RaCatalogGame>>> {
    let at = get_setting(db, &catalog_at(console_id))?.and_then(|at| DateTime::parse_from_rfc3339(&at).ok());
    if at.is_none_or(|at| now - at.with_timezone(&Utc) >= Duration::days(7)) {
        return Ok(None);
    }
    let games = db
        .prepare("SELECT ra_game_id, title, num_achievements FROM ra_catalog WHERE console_id = ?1")?
        .query_map([console_id], |row| Ok(RaCatalogGame { id: row.get(0)?, title: row.get(1)?, num_achievements: row.get(2)? }))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Some(games))
}

pub fn save_catalog(db: &Connection, console_id: i64, games: &[RaCatalogGame], now: DateTime<Utc>) -> rusqlite::Result<()> {
    let transaction = db.unchecked_transaction()?;
    transaction.execute("DELETE FROM ra_catalog WHERE console_id = ?1", [console_id])?;
    for game in games {
        transaction.execute(
            "INSERT OR REPLACE INTO ra_catalog (console_id, ra_game_id, title, num_achievements) VALUES (?1, ?2, ?3, ?4)",
            (console_id, game.id, &game.title, game.num_achievements),
        )?;
    }
    set_setting(&transaction, &catalog_at(console_id), Some(&iso(now)))?;
    transaction.commit()
}

// ---------------------------------------------------------------- jogos da biblioteca

/// Um jogo da biblioteca para procurar no RetroAchievements.
pub struct GameToMatch {
    pub id: i64,
    pub title: String,
    pub platform: String,
}

/// Jogos que ainda precisam ser procurados no RetroAchievements: sem jogo achado e sem tentativa nos
/// últimos 7 dias (com `force`, todos os que não foram achados).
pub fn games_to_match(db: &Connection, now: DateTime<Utc>, force: bool) -> rusqlite::Result<Vec<GameToMatch>> {
    let limit = iso(now - Duration::days(7));
    db.prepare(
        "SELECT id, title, platform FROM games
         WHERE platform IS NOT NULL AND ra_game_id IS NULL AND (?1 OR ra_matched_at IS NULL OR ra_matched_at < ?2)",
    )?
    .query_map((force, limit), |row| Ok(GameToMatch { id: row.get(0)?, title: row.get(1)?, platform: row.get(2)? }))?
    .collect()
}

pub fn set_ra_match(db: &Connection, game_id: i64, ra_game_id: Option<i64>, now: DateTime<Utc>) -> rusqlite::Result<()> {
    db.execute("UPDATE games SET ra_game_id = ?1, ra_matched_at = ?2 WHERE id = ?3", (ra_game_id, iso(now), game_id))?;
    Ok(())
}

/// Os jogos do RetroAchievements que estão na biblioteca, com a data da última atualização (ou None).
pub fn matched_ra_games(db: &Connection) -> rusqlite::Result<Vec<(i64, Option<String>)>> {
    db.prepare(
        "SELECT DISTINCT g.ra_game_id, rg.synced_at FROM games g LEFT JOIN ra_games rg ON rg.id = g.ra_game_id WHERE g.ra_game_id IS NOT NULL",
    )?
    .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
    .collect()
}

/// Guarda o que veio do RetroAchievements para um jogo e devolve as conquistas desbloqueadas desde a
/// última vez (para o aviso). Na primeira vez de um jogo, nada conta como novo (seriam todas as antigas).
pub fn save_game_progress(db: &Connection, progress: &RaGameProgress, now: DateTime<Utc>) -> rusqlite::Result<Vec<i64>> {
    let first_time = db.query_row("SELECT 1 FROM ra_games WHERE id = ?1", [progress.id], |_| Ok(())).optional()?.is_none();
    let before: HashMap<i64, Option<String>> = db
        .prepare("SELECT id, earned_at FROM achievements WHERE ra_game_id = ?1")?
        .query_map([progress.id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;

    let mut newly_earned = Vec::new();
    let transaction = db.unchecked_transaction()?;
    transaction.execute(
        "INSERT INTO ra_games (id, title, num_distinct_players, synced_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, num_distinct_players = excluded.num_distinct_players, synced_at = excluded.synced_at",
        (progress.id, &progress.title, progress.num_distinct_players, iso(now)),
    )?;
    // Conquistas que saíram do jogo no RetroAchievements saem daqui também.
    let ids: Vec<i64> = progress.achievements.iter().map(|item| item.id).collect();
    let marks = if ids.is_empty() { "NULL".to_string() } else { vec!["?"; ids.len()].join(",") };
    let values = std::iter::once(progress.id).chain(ids.iter().copied());
    transaction.execute(
        &format!("DELETE FROM achievements WHERE ra_game_id = ? AND id NOT IN ({marks})"),
        rusqlite::params_from_iter(values),
    )?;
    for item in &progress.achievements {
        let earned_at = item.earned_at.clone().or_else(|| item.earned_hardcore_at.clone());
        transaction.execute(
            "INSERT INTO achievements (id, ra_game_id, title, description, points, badge_name, display_order, num_awarded, earned_at, earned_hardcore_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET ra_game_id = excluded.ra_game_id, title = excluded.title, description = excluded.description,
               points = excluded.points, badge_name = excluded.badge_name, display_order = excluded.display_order,
               num_awarded = excluded.num_awarded, earned_at = excluded.earned_at, earned_hardcore_at = excluded.earned_hardcore_at",
            rusqlite::params![
                item.id,
                progress.id,
                item.title,
                item.description,
                item.points,
                item.badge_name,
                item.display_order,
                item.num_awarded,
                earned_at,
                item.earned_hardcore_at,
            ],
        )?;
        if !first_time && earned_at.is_some() && before.get(&item.id).cloned().flatten().is_none() {
            newly_earned.push(item.id);
        }
    }
    transaction.commit()?;
    Ok(newly_earned)
}

// ---------------------------------------------------------------- o que a interface mostra

/// O progresso de cada jogo da biblioteca (id do jogo → desbloqueadas, total e platina). Só dos jogos já
/// atualizados com a conta atual: sem conta (ou logo depois de trocar), nada aparece.
pub fn ra_progress_by_game(db: &Connection) -> rusqlite::Result<HashMap<i64, AchievementProgress>> {
    db.prepare(
        "SELECT g.id, COUNT(a.id), COUNT(a.earned_at)
         FROM games g JOIN ra_games rg ON rg.id = g.ra_game_id JOIN achievements a ON a.ra_game_id = g.ra_game_id
         GROUP BY g.id",
    )?
    .query_map([], |row| {
        let (total, unlocked): (i64, i64) = (row.get(1)?, row.get(2)?);
        let progress = AchievementProgress {
            unlocked,
            total,
            platinum: total > 0 && unlocked == total,
            source: AchievementSource::Retroachievements,
        };
        Ok((row.get(0)?, progress))
    })?
    .collect()
}

struct AchievementRow {
    id: i64,
    title: String,
    description: String,
    points: i64,
    badge_name: Option<String>,
    num_awarded: i64,
    earned_at: Option<String>,
    earned_hardcore_at: Option<String>,
    num_distinct_players: i64,
}

fn achievement_row(row: &Row) -> rusqlite::Result<AchievementRow> {
    Ok(AchievementRow {
        id: row.get("id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        points: row.get("points")?,
        badge_name: row.get("badge_name")?,
        num_awarded: row.get("num_awarded")?,
        earned_at: row.get("earned_at")?,
        earned_hardcore_at: row.get("earned_hardcore_at")?,
        num_distinct_players: row.get("num_distinct_players")?,
    })
}

fn to_achievement(row: AchievementRow, badge: BadgeUrl) -> GameAchievement {
    let percent = if row.num_distinct_players > 0 {
        (row.num_awarded as f64 / row.num_distinct_players as f64 * 100.0).min(100.0)
    } else {
        0.0
    };
    GameAchievement {
        key: format!("ra-{}", row.id),
        source: AchievementSource::Retroachievements,
        id: row.id,
        badge_url: badge(row.badge_name.as_deref(), row.earned_at.is_some()),
        title: row.title,
        description: row.description,
        points: Some(row.points),
        percent: Some(percent),
        rarity: Some(rarity_of(percent)),
        grade: grade_for_points(row.points),
        hidden: false,
        group: None,
        hardcore: row.earned_hardcore_at.is_some(),
        earned_at: row.earned_at,
    }
}

/// As conquistas de um jogo da biblioteca, ou None se ele não estiver no RetroAchievements.
pub fn get_ra_game_achievements(db: &Connection, game_id: i64, badge: BadgeUrl) -> rusqlite::Result<Option<GameAchievements>> {
    let game: Option<(i64, String)> = db
        .query_row(
            "SELECT g.ra_game_id, rg.title FROM games g JOIN ra_games rg ON rg.id = g.ra_game_id WHERE g.id = ?1",
            [game_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((ra_game_id, title)) = game else { return Ok(None) };
    let rows: Vec<AchievementRow> = db
        .prepare(
            "SELECT a.*, rg.num_distinct_players FROM achievements a JOIN ra_games rg ON rg.id = a.ra_game_id
             WHERE a.ra_game_id = ?1 ORDER BY a.display_order, a.id",
        )?
        .query_map([ra_game_id], achievement_row)?
        .collect::<rusqlite::Result<_>>()?;
    if rows.is_empty() {
        return Ok(None);
    }
    let achievements: Vec<GameAchievement> = rows.into_iter().map(|row| to_achievement(row, badge)).collect();
    let earned: Vec<&GameAchievement> = achievements.iter().filter(|item| item.earned_at.is_some()).collect();
    let points = |items: &mut dyn Iterator<Item = &GameAchievement>| items.map(|item| item.points.unwrap_or(0)).sum::<i64>();
    let grades: Vec<_> = achievements.iter().map(|item| (item.grade, item.earned_at.is_some())).collect();
    Ok(Some(GameAchievements {
        game_id,
        source: AchievementSource::Retroachievements,
        source_title: title,
        unlocked: earned.len() as i64,
        total: achievements.len() as i64,
        points: Some(points(&mut earned.iter().copied())),
        total_points: Some(points(&mut achievements.iter())),
        platinum: earned.len() == achievements.len(),
        by_grade: count_grades(&grades, true),
        achievements,
    }))
}

/// Os jogos com conquistas e as desbloqueadas, para a aba Conquistas (junto com os troféus do PS3).
pub fn ra_overview_parts(
    db: &Connection,
    badge: BadgeUrl,
) -> rusqlite::Result<(Vec<AchievementGameRow>, Vec<UnlockedAchievement>)> {
    // Um jogo do RetroAchievements pode estar duas vezes na biblioteca: vale o primeiro.
    let rows: Vec<(AchievementRow, i64, String)> = db
        .prepare(
            "SELECT a.*, rg.num_distinct_players, lg.game_id, lg.title AS game_title
             FROM achievements a JOIN ra_games rg ON rg.id = a.ra_game_id
             JOIN (SELECT ra_game_id, MIN(id) AS game_id, title FROM games WHERE ra_game_id IS NOT NULL GROUP BY ra_game_id) lg
               ON lg.ra_game_id = a.ra_game_id",
        )?
        .query_map([], |row| Ok((achievement_row(row)?, row.get("game_id")?, row.get("game_title")?)))?
        .collect::<rusqlite::Result<_>>()?;

    let mut games: Vec<(AchievementGameRow, Vec<(super::types::TrophyGrade, bool)>)> = Vec::new();
    let mut unlocked = Vec::new();
    for (row, game_id, game_title) in rows {
        let achievement = to_achievement(row, badge);
        let index = match games.iter().position(|(game, _)| game.game_id == game_id) {
            Some(index) => index,
            None => {
                let progress =
                    AchievementProgress { unlocked: 0, total: 0, platinum: false, source: AchievementSource::Retroachievements };
                let game = AchievementGameRow {
                    progress,
                    game_id,
                    title: game_title.clone(),
                    points: Some(0),
                    last_unlocked_at: None,
                    by_grade: count_grades(&[], true),
                };
                games.push((game, Vec::new()));
                games.len() - 1
            }
        };
        let (game, grades) = &mut games[index];
        game.progress.total += 1;
        grades.push((achievement.grade, achievement.earned_at.is_some()));
        if let Some(earned_at) = &achievement.earned_at {
            game.progress.unlocked += 1;
            game.points = Some(game.points.unwrap_or(0) + achievement.points.unwrap_or(0));
            if game.last_unlocked_at.as_ref().is_none_or(|last| earned_at > last) {
                game.last_unlocked_at = Some(earned_at.clone());
            }
            unlocked.push(UnlockedAchievement { achievement, game_id, game_title });
        }
    }
    let games = games
        .into_iter()
        .map(|(mut game, grades)| {
            game.progress.platinum = game.progress.total > 0 && game.progress.unlocked == game.progress.total;
            game.by_grade = count_grades(&grades, true);
            game
        })
        .collect();
    Ok((games, unlocked))
}

/// As conquistas de uma lista de ids, com o jogo (para o aviso de conquista nova).
pub fn unlocked_by_ids(db: &Connection, ids: &[i64], badge: BadgeUrl) -> rusqlite::Result<Vec<UnlockedAchievement>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let marks = vec!["?"; ids.len()].join(",");
    db.prepare(&format!(
        "SELECT a.*, rg.num_distinct_players, g.id AS game_id, g.title AS game_title
         FROM achievements a JOIN ra_games rg ON rg.id = a.ra_game_id
         JOIN (SELECT ra_game_id, MIN(id) AS id, title FROM games WHERE ra_game_id IS NOT NULL GROUP BY ra_game_id) g
           ON g.ra_game_id = a.ra_game_id
         WHERE a.id IN ({marks})
         ORDER BY a.earned_at"
    ))?
    .query_map(rusqlite::params_from_iter(ids), |row| {
        Ok(UnlockedAchievement {
            achievement: to_achievement(achievement_row(row)?, badge),
            game_id: row.get("game_id")?,
            game_title: row.get("game_title")?,
        })
    })?
    .collect()
}
