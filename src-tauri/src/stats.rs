//! A atividade por dia das Estatísticas, a partir das sessões de jogo. O mesmo do app em Electron
//! (src/main/stats.ts).

use std::collections::HashMap;

use chrono::{DateTime, Days, Local, NaiveDate, TimeZone, Utc};
use rusqlite::Connection;
use serde::Serialize;

use crate::dates::iso;

/// Quantos dias o gráfico de atividade mostra.
pub const ACTIVITY_DAYS: u64 = 30;

/// Quanto se jogou num dia (para o gráfico de atividade das Estatísticas).
#[derive(Debug, PartialEq, Serialize)]
pub struct DailyPlaytime {
    /// Data no horário do computador, AAAA-MM-DD.
    date: String,
    minutes: i64,
}

/// Quanto se jogou em cada um dos últimos `days` dias (hoje incluído), do mais antigo para o mais novo.
/// Cada sessão conta no dia (no horário do computador) em que terminou.
pub fn get_daily_playtime(db: &Connection, days: u64, now: DateTime<Local>) -> rusqlite::Result<Vec<DailyPlaytime>> {
    let first = now.date_naive() - Days::new(days.saturating_sub(1));
    // Um dia a mais de margem na consulta, por causa do horário de verão; o filtro exato é por data.
    let since = Local
        .from_local_datetime(&(first - Days::new(1)).and_hms_opt(0, 0, 0).unwrap_or_default())
        .earliest()
        .map(|start| start.with_timezone(&Utc));
    let since = since.map(iso).unwrap_or_default();

    let mut seconds_by_date: HashMap<NaiveDate, i64> = HashMap::new();
    let mut query = db.prepare("SELECT ended_at, seconds FROM play_sessions WHERE ended_at >= ?1")?;
    for row in query.query_map([since], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))? {
        let (ended_at, seconds) = row?;
        if let Ok(ended_at) = DateTime::parse_from_rfc3339(&ended_at) {
            *seconds_by_date.entry(ended_at.with_timezone(&Local).date_naive()).or_default() += seconds;
        }
    }

    Ok((0..days)
        .map(|index| {
            let date = first + Days::new(index);
            let seconds = seconds_by_date.get(&date).copied().unwrap_or(0);
            DailyPlaytime { date: date.format("%Y-%m-%d").to_string(), minutes: (seconds as f64 / 60.0).round() as i64 }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::memory_database;

    fn local(year: i32, month: u32, day: u32, hour: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(year, month, day, hour, 0, 0).unwrap()
    }

    #[test]
    fn soma_as_sessoes_de_cada_dia_e_completa_os_dias_sem_jogo() {
        let db = memory_database();
        db.execute("INSERT INTO games (title, status_id, added_at) VALUES ('Jogo', 1, '2026-09-01T00:00:00.000Z')", []).unwrap();
        for (ended_at, seconds) in [
            (local(2026, 9, 18, 23), 1800),
            (local(2026, 9, 18, 10), 600),
            (local(2026, 9, 19, 8), 90),
            (local(2026, 8, 1, 12), 9999),
        ] {
            db.execute(
                "INSERT INTO play_sessions (game_id, started_at, ended_at, seconds) VALUES (1, ?1, ?1, ?2)",
                (iso(ended_at.with_timezone(&Utc)), seconds),
            )
            .unwrap();
        }
        let days = get_daily_playtime(&db, 3, local(2026, 9, 19, 20)).unwrap();
        assert_eq!(
            days,
            [
                DailyPlaytime { date: "2026-09-17".into(), minutes: 0 },
                DailyPlaytime { date: "2026-09-18".into(), minutes: 40 },
                DailyPlaytime { date: "2026-09-19".into(), minutes: 2 },
            ]
        );
        assert_eq!(get_daily_playtime(&db, ACTIVITY_DAYS, local(2026, 9, 19, 20)).unwrap().len(), 30);
    }
}
