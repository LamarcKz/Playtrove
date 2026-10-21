//! As tabelas do banco. Cada migração leva o banco de uma versão para a seguinte, e a versão fica
//! guardada no próprio banco (PRAGMA user_version): um banco novo roda todas; um banco antigo roda só
//! as que faltam. São as mesmas do app em Electron (src/main/migrations.ts), na mesma ordem, para os
//! dois abrirem o mesmo banco. Nunca mude uma migração que já saiu numa versão do app: crie uma nova
//! no fim da lista.

use rusqlite::{Connection, Transaction};
use serde_json::Value;

/// Os status com que a biblioteca começa (o usuário pode mudar tudo em Configurações → Status).
const DEFAULT_STATUSES: [&str; 9] =
    ["Planejo jogar", "Parei por um tempo", "Abandonei", "Jogando", "Fazendo 100%", "Platinando", "Zerado", "100%", "Platinado"];

type Migration = fn(&Transaction) -> rusqlite::Result<()>;

const MIGRATIONS: [Migration; 8] = [
    // 1: status, jogos, emuladores, pastas de ROMs e configurações.
    |db| {
        db.execute_batch(
            "CREATE TABLE statuses (
               id INTEGER PRIMARY KEY,
               name TEXT NOT NULL,
               position INTEGER NOT NULL
             );

             CREATE TABLE games (
               id INTEGER PRIMARY KEY,
               title TEXT NOT NULL,
               status_id INTEGER NOT NULL REFERENCES statuses(id),
               favorite INTEGER NOT NULL DEFAULT 0,
               playtime_seconds INTEGER NOT NULL DEFAULT 0,
               last_played_at TEXT,
               added_at TEXT NOT NULL,
               platform TEXT,
               library TEXT,
               rom_path TEXT UNIQUE,
               emulator_id TEXT,
               core TEXT,
               description TEXT,
               genres TEXT,
               developer TEXT,
               publisher TEXT,
               release_date TEXT,
               igdb_id INTEGER,
               sgdb_id INTEGER,
               cover_image TEXT,
               icon_image TEXT,
               background_image TEXT,
               metadata_updated_at TEXT
             );

             CREATE TABLE emulators (
               id TEXT PRIMARY KEY,
               path TEXT NOT NULL
             );

             CREATE TABLE rom_folders (
               id INTEGER PRIMARY KEY,
               path TEXT NOT NULL UNIQUE,
               emulator_id TEXT NOT NULL,
               core TEXT,
               platform TEXT NOT NULL
             );

             CREATE TABLE settings (
               key TEXT PRIMARY KEY,
               value TEXT
             );",
        )?;
        for (position, name) in DEFAULT_STATUSES.iter().enumerate() {
            db.execute("INSERT INTO statuses (name, position) VALUES (?1, ?2)", (name, position as i64))?;
        }
        let id_of = |name: &str| db.query_row("SELECT id FROM statuses WHERE name = ?1", [name], |row| row.get::<_, i64>(0));
        crate::settings::set_setting(db, "newGameStatusId", Some(&id_of("Planejo jogar")?.to_string()))?;
        crate::settings::set_setting(db, "firstPlayStatusId", Some(&id_of("Jogando")?.to_string()))
    },
    // 2: cada vez que um jogo foi jogado (para as estatísticas de atividade por dia).
    |db| {
        db.execute_batch(
            "CREATE TABLE play_sessions (
               id INTEGER PRIMARY KEY,
               game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
               started_at TEXT NOT NULL,
               ended_at TEXT NOT NULL,
               seconds INTEGER NOT NULL
             );
             CREATE INDEX play_sessions_ended_at ON play_sessions (ended_at);",
        )
    },
    // 3: tempo jogado registrado pelos próprios emuladores, o código do disco (ex.: SLUS-20100, para
    // achar o jogo nos registros deles) e de onde veio cada sessão.
    |db| {
        db.execute_batch(
            "ALTER TABLE games ADD COLUMN serial TEXT;
             ALTER TABLE games ADD COLUMN emulator_playtime_seconds INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE games ADD COLUMN emulator_last_played_at TEXT;
             ALTER TABLE games ADD COLUMN emulator_synced_at TEXT;
             ALTER TABLE play_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'app';",
        )
    },
    // 4: faz o app ler os registros dos emuladores como se fosse a primeira vez, para o tempo que eles
    // já tinham guardado entrar na atividade por dia das Estatísticas.
    |db| db.execute_batch("UPDATE games SET emulator_synced_at = NULL"),
    // 5: a avaliação do usuário: nota e dificuldade (de 1 a 10), a análise e quando avaliou.
    |db| {
        db.execute_batch(
            "ALTER TABLE games ADD COLUMN rating INTEGER;
             ALTER TABLE games ADD COLUMN difficulty INTEGER;
             ALTER TABLE games ADD COLUMN review TEXT;
             ALTER TABLE games ADD COLUMN evaluated_at TEXT;",
        )
    },
    // 6: conquistas do RetroAchievements: qual jogo de lá é cada jogo da biblioteca, o catálogo de
    // cada console, os jogos e as conquistas com o que o usuário fez.
    |db| {
        db.execute_batch(
            "ALTER TABLE games ADD COLUMN ra_game_id INTEGER;
             ALTER TABLE games ADD COLUMN ra_matched_at TEXT;

             CREATE TABLE ra_catalog (
               console_id INTEGER NOT NULL,
               ra_game_id INTEGER NOT NULL,
               title TEXT NOT NULL,
               num_achievements INTEGER NOT NULL DEFAULT 0,
               PRIMARY KEY (console_id, ra_game_id)
             );

             CREATE TABLE ra_games (
               id INTEGER PRIMARY KEY,
               title TEXT NOT NULL,
               num_distinct_players INTEGER NOT NULL DEFAULT 0,
               synced_at TEXT NOT NULL
             );

             CREATE TABLE achievements (
               id INTEGER PRIMARY KEY,
               ra_game_id INTEGER NOT NULL,
               title TEXT NOT NULL,
               description TEXT NOT NULL DEFAULT '',
               points INTEGER NOT NULL DEFAULT 0,
               badge_name TEXT,
               display_order INTEGER NOT NULL DEFAULT 0,
               num_awarded INTEGER NOT NULL DEFAULT 0,
               earned_at TEXT,
               earned_hardcore_at TEXT
             );
             CREATE INDEX achievements_game ON achievements (ra_game_id);
             CREATE INDEX achievements_earned ON achievements (earned_at);",
        )
    },
    // 7: troféus dos jogos de PS3, que o RPCS3 guarda: o conjunto de cada jogo (o código do disco,
    // em PS3_GAME/TROPDIR), os conjuntos que o RPCS3 instalou e os troféus.
    |db| {
        db.execute_batch(
            "ALTER TABLE games ADD COLUMN trophy_set TEXT;
             ALTER TABLE games ADD COLUMN trophy_checked_at TEXT;

             CREATE TABLE trophy_sets (
               id TEXT PRIMARY KEY,
               title TEXT NOT NULL,
               file_stamp TEXT NOT NULL,
               synced_at TEXT NOT NULL
             );

             CREATE TABLE trophies (
               set_id TEXT NOT NULL,
               id INTEGER NOT NULL,
               name TEXT NOT NULL,
               detail TEXT NOT NULL DEFAULT '',
               grade TEXT NOT NULL,
               hidden INTEGER NOT NULL DEFAULT 0,
               group_name TEXT,
               unlocked_at TEXT,
               PRIMARY KEY (set_id, id)
             );
             CREATE INDEX trophies_unlocked ON trophies (unlocked_at);",
        )
    },
    // 8: o app em português e inglês. Os status padrão ganham a marca de qual status eles são, e os
    // gêneros passam a ficar como vêm do IGDB, em inglês (a tela traduz).
    |db| {
        db.execute_batch("ALTER TABLE statuses ADD COLUMN preset TEXT")?;
        upgrade_to_languages(db)
    },
];

/// O status padrão (a chave do dicionário) de cada nome de DEFAULT_STATUSES.
const DEFAULT_STATUS_PRESETS: [(&str, &str); 9] = [
    ("Planejo jogar", "planToPlay"),
    ("Parei por um tempo", "onHold"),
    ("Abandonei", "abandoned"),
    ("Jogando", "playing"),
    ("Fazendo 100%", "goingFor100"),
    ("Platinando", "goingForPlatinum"),
    ("Zerado", "beaten"),
    ("100%", "complete100"),
    ("Platinado", "platinum"),
];

/// Os gêneros que o app gravava em português até a migração 8, com o nome original do IGDB.
const OLD_GENRE_NAMES: [(&str, &str); 18] = [
    ("Aventura", "Adventure"),
    ("Cartas e tabuleiro", "Card & Board Game"),
    ("Luta", "Fighting"),
    ("Hack and slash", "Hack and slash/Beat 'em up"),
    ("Música", "Music"),
    ("Plataforma", "Platform"),
    ("Quebra-cabeça", "Puzzle"),
    ("Quiz", "Quiz/Trivia"),
    ("Corrida", "Racing"),
    ("Estratégia em tempo real", "Real Time Strategy (RTS)"),
    ("RPG", "Role-playing (RPG)"),
    ("Tiro", "Shooter"),
    ("Simulação", "Simulator"),
    ("Esporte", "Sport"),
    ("Estratégia", "Strategy"),
    ("Tático", "Tactical"),
    ("Estratégia por turnos", "Turn-based strategy (TBS)"),
    ("Visual novel", "Visual Novel"),
];

/// A versão do banco em que o app ficou em português e inglês (migração 8).
pub const LANGUAGES_VERSION: i64 = 8;

/// O que a migração 8 faz nos dados: marca os status padrão (o nome deles passa a mudar com o
/// idioma) e volta os gêneros para o nome do IGDB. O conserto de um banco de antes dela também usa,
/// nas linhas que recuperou.
pub fn upgrade_to_languages(db: &Connection) -> rusqlite::Result<()> {
    for (name, preset) in DEFAULT_STATUS_PRESETS {
        db.execute("UPDATE statuses SET preset = ?1 WHERE name = ?2 AND preset IS NULL", (preset, name))?;
    }
    let games = {
        let mut query = db.prepare("SELECT id, genres FROM games WHERE genres IS NOT NULL")?;
        query.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (id, genres) in games {
        let Ok(Value::Array(genres)) = serde_json::from_str::<Value>(&genres) else { continue };
        let original: Vec<Value> = genres.into_iter().map(original_genre).collect();
        let json = serde_json::to_string(&original).unwrap_or_default();
        db.execute("UPDATE games SET genres = ?1 WHERE id = ?2", (json, id))?;
    }
    Ok(())
}

/// O nome do IGDB de um gênero gravado em português (os outros ficam como estão).
fn original_genre(genre: Value) -> Value {
    match &genre {
        Value::String(name) => match OLD_GENRE_NAMES.iter().find(|(old, _)| old == name) {
            Some((_, original)) => Value::String(original.to_string()),
            None => genre,
        },
        _ => genre,
    }
}

/// Cria as tabelas num banco novo e aplica as mudanças que faltam num banco antigo, cada uma numa
/// transação (ou vai inteira, ou nada muda).
pub fn run_migrations(db: &mut Connection) -> rusqlite::Result<()> {
    let current: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
    for (version, migration) in (1_i64..).zip(MIGRATIONS.iter()).skip(current.max(0) as usize) {
        let transaction = db.transaction()?;
        migration(&transaction)?;
        transaction.pragma_update(None, "user_version", version)?;
        transaction.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_database() -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        db
    }

    #[test]
    fn um_banco_novo_chega_na_ultima_versao_com_os_status_padrao() {
        let db = fresh_database();
        let version: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0)).unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);

        let presets: Vec<String> = db
            .prepare("SELECT preset FROM statuses ORDER BY position")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        let expected: Vec<&str> = DEFAULT_STATUS_PRESETS.iter().map(|(_, preset)| *preset).collect();
        assert_eq!(presets, expected);
    }

    #[test]
    fn as_regras_automaticas_apontam_para_planejo_jogar_e_jogando() {
        let db = fresh_database();
        let rule = |key: &str| crate::settings::get_setting(&db, key).unwrap().unwrap();
        let name_of =
            |id: String| db.query_row("SELECT name FROM statuses WHERE id = ?1", [id], |row| row.get::<_, String>(0)).unwrap();
        assert_eq!(name_of(rule("newGameStatusId")), "Planejo jogar");
        assert_eq!(name_of(rule("firstPlayStatusId")), "Jogando");
    }

    #[test]
    fn abrir_de_novo_nao_roda_as_migracoes_outra_vez() {
        let mut db = fresh_database();
        run_migrations(&mut db).unwrap();
        let count: i64 = db.query_row("SELECT COUNT(*) FROM statuses", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 9);
    }

    #[test]
    fn a_migracao_8_volta_os_generos_para_o_nome_do_igdb() {
        let mut db = Connection::open_in_memory().unwrap();
        for migration in &MIGRATIONS[..7] {
            let transaction = db.transaction().unwrap();
            migration(&transaction).unwrap();
            transaction.commit().unwrap();
        }
        db.pragma_update(None, "user_version", 7).unwrap();
        db.execute(
            "INSERT INTO games (title, status_id, added_at, genres) VALUES ('Jogo', 1, '2026-01-01T00:00:00.000Z', ?1)",
            [r#"["Corrida","Simulação","Outro",3]"#],
        )
        .unwrap();

        run_migrations(&mut db).unwrap();
        let genres: String = db.query_row("SELECT genres FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(genres, r#"["Racing","Simulator","Outro",3]"#);
    }
}
