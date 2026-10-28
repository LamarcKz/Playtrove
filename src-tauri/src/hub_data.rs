//! Atividade local do Welcome Hub, sem aproximar sessões ou meses pelo tempo total da biblioteca.

use std::collections::BTreeMap;

use chrono::{DateTime, Datelike, Local};
use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubGameActivity {
    pub game_id: i64,
    pub playtime_seconds: i64,
    pub play_count: i64,
    pub month_minutes: i64,
}

/// Conta sessões abertas no app e soma o mês pelo horário local em que cada sessão terminou.
/// Um delta importado do emulador contribui para o tempo, mas não inventa uma nova abertura.
pub fn get_game_activity(db: &Connection, now: DateTime<Local>) -> rusqlite::Result<Vec<HubGameActivity>> {
    let mut totals: BTreeMap<i64, (i64, i64, i64)> = BTreeMap::new();
    let mut games = db.prepare("SELECT id, MAX(playtime_seconds, emulator_playtime_seconds) FROM games")?;
    for row in games.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))? {
        let (id, seconds) = row?;
        totals.insert(id, (0, 0, seconds));
    }
    let mut query = db.prepare("SELECT game_id, source, ended_at, seconds FROM play_sessions")?;
    for row in query.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?))
    })? {
        let (game_id, source, ended_at, seconds) = row?;
        let Some((count, month_seconds, _)) = totals.get_mut(&game_id) else { continue };
        if source == "app" {
            *count += 1;
        }
        if let Ok(date) = DateTime::parse_from_rfc3339(&ended_at) {
            let date = date.with_timezone(&Local);
            if date.year() == now.year() && date.month() == now.month() && date <= now {
                *month_seconds += seconds.max(0);
            }
        }
    }
    Ok(totals
        .into_iter()
        .map(|(game_id, (play_count, seconds, playtime_seconds))| HubGameActivity {
            game_id,
            playtime_seconds,
            play_count,
            month_minutes: seconds / 60,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dates::iso;
    use crate::test_support::memory_database;
    use chrono::{TimeZone, Utc};

    #[test]
    fn conta_aberturas_do_app_e_soma_o_mes_local_sem_contar_importacoes_como_aberturas() {
        let db = memory_database();
        for title in ["Jogo A", "Jogo B", "Sem sessão"] {
            db.execute("INSERT INTO games (title, status_id, added_at) VALUES (?1, 1, '2026-09-01T00:00:00.000Z')", [title])
                .unwrap();
        }
        db.execute("UPDATE games SET playtime_seconds=7190, emulator_playtime_seconds=6000 WHERE id=1", []).unwrap();
        db.execute("UPDATE games SET playtime_seconds=0, emulator_playtime_seconds=1780 WHERE id=2", []).unwrap();
        for (game_id, date, seconds, source) in [
            (1, Local.with_ymd_and_hms(2026, 9, 30, 23, 59, 0).unwrap(), 300, "app"),
            (1, Local.with_ymd_and_hms(2026, 10, 1, 0, 1, 0).unwrap(), 20, "app"),
            (1, Local.with_ymd_and_hms(2026, 10, 2, 12, 0, 0).unwrap(), 170, "emulador"),
            (2, Local.with_ymd_and_hms(2026, 10, 3, 12, 0, 0).unwrap(), 300, "emulador"),
        ] {
            db.execute(
                "INSERT INTO play_sessions (game_id, started_at, ended_at, seconds, source) VALUES (?1, ?2, ?2, ?3, ?4)",
                (game_id, iso(date.with_timezone(&Utc)), seconds, source),
            )
            .unwrap();
        }
        assert_eq!(
            get_game_activity(&db, Local.with_ymd_and_hms(2026, 10, 28, 12, 0, 0).unwrap()).unwrap(),
            [
                HubGameActivity { game_id: 1, playtime_seconds: 7190, play_count: 2, month_minutes: 3 },
                HubGameActivity { game_id: 2, playtime_seconds: 1780, play_count: 0, month_minutes: 5 },
                HubGameActivity { game_id: 3, playtime_seconds: 0, play_count: 0, month_minutes: 0 },
            ]
        );
    }
}
