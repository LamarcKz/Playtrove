//! 12 jogos FALSOS (títulos inventados), usados só nos testes automáticos: o app só coloca estes jogos
//! quando é aberto com PLAYTROVE_SAMPLE_GAMES=1 e a biblioteca está vazia.

use chrono::{Duration, Utc};
use rusqlite::Connection;

use crate::dates::iso;

/// Nome, minutos jogados, status (pelo nome), favorito, dias desde a última vez, plataforma e biblioteca.
type SampleGame = (&'static str, i64, &'static str, bool, Option<i64>, &'static str, &'static str);

const SAMPLE_GAMES: [SampleGame; 12] = [
    ("Crônicas de Valdoria: Ecos do Abismo", 4380, "Fazendo 100%", true, Some(2), "PlayStation 2", "PCSX2"),
    ("Neon Madrugada", 750, "Jogando", false, Some(0), "PlayStation", "DuckStation"),
    ("Horizonte Partido", 0, "Planejo jogar", false, None, "PlayStation 2", "PCSX2"),
    ("Cidadela Sombria", 2215, "Parei por um tempo", false, Some(60), "Game Boy Advance", "RetroArch"),
    ("Cavaleiros de Pixel", 95, "Abandonei", false, Some(200), "Nintendo DS", "RetroArch"),
    ("Mar de Estrelas", 12040, "Platinado", true, Some(45), "PlayStation 2", "PCSX2"),
    ("Operação Tempestade", 320, "Jogando", false, Some(5), "PlayStation", "DuckStation"),
    ("Jardim dos Autômatos", 45, "Jogando", false, Some(1), "Game Boy Advance", "RetroArch"),
    ("Rally Extremo 3", 1980, "Platinando", true, Some(10), "PlayStation 2", "PCSX2"),
    ("Lendas de Kitsune", 610, "Zerado", false, Some(120), "Nintendo DS", "RetroArch"),
    ("Colônia Ártica", 0, "Planejo jogar", false, None, "PlayStation", "DuckStation"),
    ("Detetive Noturno", 1335, "Zerado", false, Some(400), "PlayStation 2", "PCSX2"),
];

/// Sessões de exemplo: os jogados nos últimos 30 dias ganham uma sessão (de até 90 min) no último dia jogado.
const SAMPLE_SESSION_DAYS: i64 = 30;
const SAMPLE_SESSION_MAX_MINUTES: i64 = 90;

/// Coloca os jogos de exemplo, se a biblioteca estiver vazia.
pub fn seed_sample_games(db: &Connection) -> rusqlite::Result<()> {
    let total: i64 = db.query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0))?;
    if total > 0 {
        return Ok(());
    }

    let now = Utc::now();
    let transaction = db.unchecked_transaction()?;
    for (index, (title, minutes, status, favorite, days_ago, platform, library)) in SAMPLE_GAMES.into_iter().enumerate() {
        let status_id: i64 = transaction.query_row("SELECT id FROM statuses WHERE name = ?1", [status], |row| row.get(0))?;
        let last_played = days_ago.map(|days| now - Duration::days(days));
        let added_at = now - Duration::days(500 - index as i64);
        transaction.execute(
            "INSERT INTO games (title, status_id, favorite, playtime_seconds, last_played_at, added_at, platform, library)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            (title, status_id, i64::from(favorite), minutes * 60, last_played.map(iso), iso(added_at), platform, library),
        )?;
        let game_id = transaction.last_insert_rowid();
        if let (Some(last_played), Some(days)) = (last_played, days_ago)
            && days <= SAMPLE_SESSION_DAYS
        {
            let seconds = minutes.min(SAMPLE_SESSION_MAX_MINUTES) * 60;
            transaction.execute(
                "INSERT INTO play_sessions (game_id, started_at, ended_at, seconds) VALUES (?1, ?2, ?3, ?4)",
                (game_id, iso(last_played - Duration::seconds(seconds)), iso(last_played), seconds),
            )?;
        }
    }
    transaction.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::run_migrations;

    #[test]
    fn doze_jogos_so_com_a_biblioteca_vazia() {
        let mut db = Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        seed_sample_games(&db).unwrap();
        seed_sample_games(&db).unwrap();
        let count = |sql: &str| db.query_row(sql, [], |row| row.get::<_, i64>(0)).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM games"), 12);
        assert_eq!(count("SELECT COUNT(*) FROM games WHERE favorite = 1"), 3);
        // Jogados nos últimos 30 dias: 0, 1, 2, 5 e 10 dias atrás.
        assert_eq!(count("SELECT COUNT(*) FROM play_sessions"), 5);
    }
}
