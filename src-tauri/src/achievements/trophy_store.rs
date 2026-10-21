//! O banco dos troféus do PS3 (tabelas trophy_sets e trophies, e a coluna trophy_set dos jogos): o que o
//! RPCS3 tem guardado, qual conjunto é de qual jogo e o que as telas mostram.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, Row};

use super::matching::ra_match_score;
use super::trophy_files::{TrophySetDefinition, TrophyUnlocks};
use super::types::{
    AchievementGameRow, AchievementProgress, AchievementSource, GameAchievement, GameAchievements, TrophyGrade,
    UnlockedAchievement, count_grades,
};
use crate::dates::iso;

/// Mostra a imagem de um troféu (o endereço vem de trophy_icons.rs, que sabe onde ficam as imagens).
pub type TrophyIconUrl<'a> = &'a dyn Fn(&str, i64) -> Option<String>;

/// Os jogos que abrem no RPCS3.
const PS3_GAMES: &str = "(emulator_id = 'rpcs3' OR platform = 'PlayStation 3')";

// ---------------------------------------------------------------- guardar o que o RPCS3 tem

/// A "assinatura" dos arquivos na última leitura de um conjunto, ou None se ele nunca foi lido.
pub fn trophy_set_stamp(db: &Connection, set_id: &str) -> rusqlite::Result<Option<String>> {
    db.query_row("SELECT file_stamp FROM trophy_sets WHERE id = ?1", [set_id], |row| row.get(0)).optional()
}

/// Guarda um conjunto de troféus e devolve os que foram pegos desde a última leitura (na primeira,
/// nenhum: seriam os antigos).
pub fn save_trophy_set(
    db: &Connection,
    set_id: &str,
    definition: &TrophySetDefinition,
    unlocks: &TrophyUnlocks,
    stamp: &str,
    now: DateTime<Utc>,
) -> rusqlite::Result<Vec<i64>> {
    let first_time = trophy_set_stamp(db, set_id)?.is_none();
    let before: HashMap<i64, Option<String>> = db
        .prepare("SELECT id, unlocked_at FROM trophies WHERE set_id = ?1")?
        .query_map([set_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;

    let mut newly_unlocked = Vec::new();
    let transaction = db.unchecked_transaction()?;
    transaction.execute(
        "INSERT INTO trophy_sets (id, title, file_stamp, synced_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, file_stamp = excluded.file_stamp, synced_at = excluded.synced_at",
        (set_id, &definition.title, stamp, iso(now)),
    )?;
    let ids: Vec<i64> = definition.trophies.iter().map(|trophy| trophy.id).collect();
    let marks = if ids.is_empty() { "NULL".to_string() } else { vec!["?"; ids.len()].join(",") };
    let mut values: Vec<rusqlite::types::Value> = vec![set_id.to_string().into()];
    values.extend(ids.iter().map(|id| rusqlite::types::Value::from(*id)));
    transaction
        .execute(&format!("DELETE FROM trophies WHERE set_id = ? AND id NOT IN ({marks})"), rusqlite::params_from_iter(values))?;
    for trophy in &definition.trophies {
        let previous = before.get(&trophy.id).cloned().flatten();
        // Sem uma data que faça sentido no arquivo, fica a da leitura anterior (ou a de agora).
        let unlocked_at =
            unlocks.get(&trophy.id).map(|date| date.clone().or_else(|| previous.clone()).unwrap_or_else(|| iso(now)));
        transaction.execute(
            "INSERT INTO trophies (set_id, id, name, detail, grade, hidden, group_name, unlocked_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(set_id, id) DO UPDATE SET name = excluded.name, detail = excluded.detail, grade = excluded.grade,
               hidden = excluded.hidden, group_name = excluded.group_name, unlocked_at = excluded.unlocked_at",
            rusqlite::params![
                set_id,
                trophy.id,
                trophy.name,
                trophy.detail,
                trophy.grade.id(),
                trophy.hidden,
                trophy.group,
                unlocked_at
            ],
        )?;
        if !first_time && unlocked_at.is_some() && previous.is_none() {
            newly_unlocked.push(trophy.id);
        }
    }
    transaction.commit()?;
    Ok(newly_unlocked)
}

/// Liga os jogos de PS3 aos conjuntos de troféus: pelo disco (as pastas de PS3_GAME/TROPDIR, lidas uma
/// vez por jogo) ou, se não der, pelo nome do jogo no conjunto instalado. Devolve quantos jogos foram
/// ligados agora.
pub fn link_trophy_sets(
    db: &Connection,
    read_game_sets: &dyn Fn(&str) -> Vec<String>,
    now: DateTime<Utc>,
) -> rusqlite::Result<usize> {
    let games: Vec<(i64, String, Option<String>, Option<String>)> = db
        .prepare(&format!("SELECT id, title, rom_path, trophy_checked_at FROM games WHERE {PS3_GAMES} AND trophy_set IS NULL"))?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?
        .collect::<rusqlite::Result<_>>()?;
    if games.is_empty() {
        return Ok(0);
    }
    let installed: Vec<(String, String)> = db
        .prepare("SELECT id, title FROM trophy_sets")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let installed_ids: HashSet<&String> = installed.iter().map(|(id, _)| id).collect();
    let mut linked = 0;
    for (id, title, rom_path, checked_at) in games {
        let mut set_id = None;
        if checked_at.is_none() {
            // O código fica no disco mesmo antes de o RPCS3 instalar os troféus (na primeira vez que o jogo abre).
            let sets = rom_path.as_deref().map(read_game_sets).unwrap_or_default();
            set_id = sets.iter().find(|set| installed_ids.contains(set)).or(sets.first()).cloned();
        }
        let set_id = set_id.or_else(|| match_by_name(&title, &installed));
        if set_id.is_none() && checked_at.is_some() {
            continue;
        }
        db.execute(
            "UPDATE games SET trophy_set = ?1, trophy_checked_at = ?2 WHERE id = ?3",
            (&set_id, checked_at.unwrap_or_else(|| iso(now)), id),
        )?;
        if set_id.is_some() {
            linked += 1;
        }
    }
    Ok(linked)
}

/// O conjunto instalado com o mesmo nome do jogo (os números da série têm que bater), ou None.
fn match_by_name(title: &str, sets: &[(String, String)]) -> Option<String> {
    let mut best = None;
    let mut best_score = 1;
    for (id, set_title) in sets {
        let score = ra_match_score(title, set_title);
        if score > best_score {
            best = Some(id.clone());
            best_score = score;
        }
    }
    best
}

// ---------------------------------------------------------------- o que as telas mostram

/// Os jogos ligados a um conjunto de troféus que o RPCS3 ainda não instalou (ele instala na primeira vez
/// que o jogo abre).
pub fn games_waiting_for_trophies(db: &Connection) -> rusqlite::Result<HashSet<i64>> {
    db.prepare("SELECT id FROM games WHERE trophy_set IS NOT NULL AND trophy_set NOT IN (SELECT DISTINCT set_id FROM trophies)")?
        .query_map([], |row| row.get(0))?
        .collect()
}

struct TrophyRow {
    set_id: String,
    id: i64,
    name: String,
    detail: String,
    grade: TrophyGrade,
    hidden: bool,
    group_name: Option<String>,
    unlocked_at: Option<String>,
}

fn trophy_row(row: &Row) -> rusqlite::Result<TrophyRow> {
    Ok(TrophyRow {
        set_id: row.get("set_id")?,
        id: row.get("id")?,
        name: row.get("name")?,
        detail: row.get("detail")?,
        grade: TrophyGrade::from_id(&row.get::<_, String>("grade")?).unwrap_or(TrophyGrade::Bronze),
        hidden: row.get::<_, i64>("hidden")? == 1,
        group_name: row.get("group_name")?,
        unlocked_at: row.get("unlocked_at")?,
    })
}

fn to_achievement(row: TrophyRow, icon: TrophyIconUrl) -> GameAchievement {
    GameAchievement {
        key: format!("{}-{}", row.set_id, row.id),
        source: AchievementSource::Rpcs3,
        id: row.id,
        badge_url: icon(&row.set_id, row.id),
        title: row.name,
        description: row.detail,
        points: None,
        percent: None,
        rarity: None,
        grade: row.grade,
        hidden: row.hidden,
        group: row.group_name,
        earned_at: row.unlocked_at,
        hardcore: false,
    }
}

/// A platina do PS3: o troféu de platina pego. Jogo sem platina (os menores, da PSN) conta como platinado
/// com todos os troféus.
fn is_platinum(trophies: &[(TrophyGrade, bool)]) -> bool {
    let platinum: Vec<_> = trophies.iter().filter(|(grade, _)| *grade == TrophyGrade::Platina).collect();
    if platinum.is_empty() {
        !trophies.is_empty() && trophies.iter().all(|(_, earned)| *earned)
    } else {
        platinum.iter().any(|(_, earned)| *earned)
    }
}

/// O progresso de cada jogo nos troféus (id do jogo → pegos, total e platina).
pub fn trophy_progress_by_game(db: &Connection) -> rusqlite::Result<HashMap<i64, AchievementProgress>> {
    let mut by_game: HashMap<i64, Vec<(TrophyGrade, bool)>> = HashMap::new();
    let mut query =
        db.prepare("SELECT g.id, t.grade, t.unlocked_at IS NOT NULL FROM games g JOIN trophies t ON t.set_id = g.trophy_set")?;
    for row in query.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, bool>(2)?)))? {
        let (game_id, grade, earned) = row?;
        by_game.entry(game_id).or_default().push((TrophyGrade::from_id(&grade).unwrap_or(TrophyGrade::Bronze), earned));
    }
    Ok(by_game
        .into_iter()
        .map(|(game_id, trophies)| {
            let unlocked = trophies.iter().filter(|(_, earned)| *earned).count() as i64;
            let progress = AchievementProgress {
                unlocked,
                total: trophies.len() as i64,
                platinum: is_platinum(&trophies),
                source: AchievementSource::Rpcs3,
            };
            (game_id, progress)
        })
        .collect())
}

/// Os troféus de um jogo da biblioteca, ou None se ele não tiver (ou se o RPCS3 ainda não instalou).
pub fn get_game_trophies(db: &Connection, game_id: i64, icon: TrophyIconUrl) -> rusqlite::Result<Option<GameAchievements>> {
    let game: Option<(String, String)> = db
        .query_row(
            "SELECT s.id, s.title FROM games g JOIN trophy_sets s ON s.id = g.trophy_set WHERE g.id = ?1",
            [game_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((set_id, title)) = game else { return Ok(None) };
    let rows: Vec<TrophyRow> = db
        .prepare("SELECT * FROM trophies WHERE set_id = ?1 ORDER BY id")?
        .query_map([&set_id], trophy_row)?
        .collect::<rusqlite::Result<_>>()?;
    if rows.is_empty() {
        return Ok(None);
    }
    let achievements: Vec<GameAchievement> = rows.into_iter().map(|row| to_achievement(row, icon)).collect();
    let trophies: Vec<(TrophyGrade, bool)> =
        achievements.iter().map(|trophy| (trophy.grade, trophy.earned_at.is_some())).collect();
    Ok(Some(GameAchievements {
        game_id,
        source: AchievementSource::Rpcs3,
        source_title: title,
        unlocked: trophies.iter().filter(|(_, earned)| *earned).count() as i64,
        total: achievements.len() as i64,
        points: None,
        total_points: None,
        platinum: is_platinum(&trophies),
        by_grade: count_grades(&trophies, false),
        achievements,
    }))
}

/// Os jogos com troféus e os troféus pegos, para a aba Conquistas (junto com o RetroAchievements).
pub fn trophy_overview_parts(
    db: &Connection,
    icon: TrophyIconUrl,
) -> rusqlite::Result<(Vec<AchievementGameRow>, Vec<UnlockedAchievement>)> {
    // Um conjunto pode estar em dois jogos da biblioteca: vale o primeiro.
    let rows: Vec<(TrophyRow, i64, String)> = db
        .prepare(
            "SELECT t.*, lg.game_id, lg.title AS game_title FROM trophies t
             JOIN (SELECT trophy_set, MIN(id) AS game_id, title FROM games WHERE trophy_set IS NOT NULL GROUP BY trophy_set) lg
               ON lg.trophy_set = t.set_id
             ORDER BY t.set_id, t.id",
        )?
        .query_map([], |row| Ok((trophy_row(row)?, row.get("game_id")?, row.get("game_title")?)))?
        .collect::<rusqlite::Result<_>>()?;

    let mut games: Vec<(AchievementGameRow, Vec<(TrophyGrade, bool)>)> = Vec::new();
    let mut unlocked = Vec::new();
    for (row, game_id, game_title) in rows {
        let trophy = to_achievement(row, icon);
        let index = match games.iter().position(|(game, _)| game.game_id == game_id) {
            Some(index) => index,
            None => {
                let progress = AchievementProgress { unlocked: 0, total: 0, platinum: false, source: AchievementSource::Rpcs3 };
                let game = AchievementGameRow {
                    progress,
                    game_id,
                    title: game_title.clone(),
                    points: None,
                    last_unlocked_at: None,
                    by_grade: count_grades(&[], false),
                };
                games.push((game, Vec::new()));
                games.len() - 1
            }
        };
        let (game, trophies) = &mut games[index];
        game.progress.total += 1;
        trophies.push((trophy.grade, trophy.earned_at.is_some()));
        if let Some(earned_at) = &trophy.earned_at {
            game.progress.unlocked += 1;
            if game.last_unlocked_at.as_ref().is_none_or(|last| earned_at > last) {
                game.last_unlocked_at = Some(earned_at.clone());
            }
            unlocked.push(UnlockedAchievement { achievement: trophy, game_id, game_title });
        }
    }
    let games = games
        .into_iter()
        .map(|(mut game, trophies)| {
            game.progress.platinum = is_platinum(&trophies);
            game.by_grade = count_grades(&trophies, false);
            game
        })
        .collect();
    Ok((games, unlocked))
}

/// Troféus recém-pegos, com o jogo da biblioteca (para o aviso). Os de jogos fora dela ficam de fora.
pub fn unlocked_trophies(
    db: &Connection,
    items: &[(String, i64)],
    icon: TrophyIconUrl,
) -> rusqlite::Result<Vec<UnlockedAchievement>> {
    let mut query = db.prepare(
        "SELECT t.*, g.id AS game_id, g.title AS game_title FROM trophies t
         JOIN (SELECT trophy_set, MIN(id) AS id, title FROM games WHERE trophy_set IS NOT NULL GROUP BY trophy_set) g
           ON g.trophy_set = t.set_id
         WHERE t.set_id = ?1 AND t.id = ?2",
    )?;
    let mut unlocked = Vec::new();
    for (set_id, id) in items {
        let row = query
            .query_row((set_id, id), |row| Ok((trophy_row(row)?, row.get("game_id")?, row.get("game_title")?)))
            .optional()?;
        if let Some((row, game_id, game_title)) = row {
            unlocked.push(UnlockedAchievement { achievement: to_achievement(row, icon), game_id, game_title });
        }
    }
    Ok(unlocked)
}
