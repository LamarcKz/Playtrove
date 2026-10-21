//! O arquivo do banco SQLite (a biblioteca): abrir, conferir e, se ele estiver danificado, consertar.
//! O mesmo que o app em Electron faz (src/main/databaseFile.ts e repairNotice.ts).

use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension};

use crate::i18n::{Language, text};
use crate::migrations::{LANGUAGES_VERSION, run_migrations, upgrade_to_languages};

/// As tabelas do banco, na ordem em que o conserto copia (os status antes dos jogos).
const TABLES: [&str; 11] = [
    "statuses",
    "games",
    "emulators",
    "rom_folders",
    "settings",
    "play_sessions",
    "ra_catalog",
    "ra_games",
    "achievements",
    "trophy_sets",
    "trophies",
];

/// Os arquivos que o SQLite pode deixar ao lado do banco (o nome do banco + o sufixo).
const SIDE_SUFFIXES: [&str; 4] = ["", "-wal", "-shm", "-journal"];

/// O que o conserto de um banco danificado conseguiu salvar.
pub struct RepairReport {
    /// Tabelas copiadas para o banco novo, com quantas linhas cada uma.
    recovered: Vec<(&'static str, usize)>,
    /// Tabelas que não deu para ler: voltaram ao padrão (status) ou ficaram vazias.
    lost: Vec<&'static str>,
    /// Onde ficou guardado o arquivo danificado (nada é apagado).
    damaged_file: PathBuf,
}

/// Abre o banco do arquivo (criando se não existir) e deixa ele pronto para uso:
/// 1. confere se ele está íntegro; se não estiver, conserta (veja `repair_database`);
/// 2. usa o diário comum do SQLite (sem WAL): cada gravação vai direto para o arquivo do banco, e não
///    fica só num arquivo de registro à parte, que pode se perder num fechamento forçado;
/// 3. aplica as migrações que faltam.
pub fn open_database(path: &Path) -> Result<(Connection, Option<RepairReport>), Box<dyn Error>> {
    let existing = Connection::open(path)?;
    let repair = if is_healthy(&existing) {
        drop(existing);
        None
    } else {
        Some(repair_database(existing, path)?)
    };
    let mut db = Connection::open(path)?;
    db.query_row("PRAGMA journal_mode = DELETE", [], |_| Ok(()))?;
    db.pragma_update(None, "foreign_keys", true)?;
    run_migrations(&mut db)?;
    Ok((db, repair))
}

/// O banco está íntegro? (Um arquivo que nem é um banco também conta como danificado.)
fn is_healthy(db: &Connection) -> bool {
    db.query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0)).is_ok_and(|result| result == "ok")
}

/// Conserta um banco danificado: cria um banco novo (com os status e as regras padrão), copia para ele
/// cada tabela que ainda dá para ler e acerta o que ficou sem par (ex.: jogo com um status que sumiu).
/// O arquivo danificado é guardado ao lado, com "danificado" e a data no nome, e o novo toma o lugar
/// dele. Fecha a conexão `damaged`.
fn repair_database(damaged: Connection, path: &Path) -> Result<RepairReport, Box<dyn Error>> {
    let temp_path = with_suffix(path, ".recuperando");
    remove_database_files(&temp_path)?;
    let mut fresh = Connection::open(&temp_path)?;
    fresh.query_row("PRAGMA journal_mode = DELETE", [], |_| Ok(()))?;
    run_migrations(&mut fresh)?;

    let existing = table_names(&damaged);
    let version: Option<i64> = damaged.pragma_query_value(None, "user_version", |row| row.get(0)).ok();
    let mut recovered = Vec::new();
    let mut lost = Vec::new();
    let transaction = fresh.transaction()?;
    for table in TABLES {
        // Tabela que o banco antigo nem tinha (versão mais antiga do app): não é dano.
        if existing.as_ref().is_some_and(|names| !names.iter().any(|name| name == table)) {
            continue;
        }
        match read_rows(&damaged, table) {
            Ok((columns, rows)) => {
                copy_rows(&transaction, table, &columns, &rows)?;
                recovered.push((table, rows.len()));
            }
            Err(_) => lost.push(table),
        }
    }
    // O banco novo já está na última versão; o que veio de um banco de antes dos idiomas é acertado aqui.
    if version.is_some_and(|version| version < LANGUAGES_VERSION) {
        upgrade_to_languages(&transaction)?;
    }
    fix_references(&transaction)?;
    transaction.commit()?;

    drop(fresh);
    // Mesmo que o fechamento reclame do dano, o arquivo é guardado do jeito que está.
    let _ = damaged.close();
    let damaged_file = keep_damaged_files(path)?;
    fs::rename(&temp_path, path)?;
    Ok(RepairReport { recovered, lost, damaged_file })
}

/// Os nomes das tabelas do banco, ou None se nem a lista de tabelas der para ler.
fn table_names(db: &Connection) -> Option<Vec<String>> {
    let mut query = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").ok()?;
    query.query_map([], |row| row.get(0)).ok()?.collect::<rusqlite::Result<_>>().ok()
}

/// Todas as linhas de uma tabela, com os nomes das colunas.
fn read_rows(db: &Connection, table: &str) -> rusqlite::Result<(Vec<String>, Vec<Vec<Value>>)> {
    let mut query = db.prepare(&format!("SELECT * FROM {table}"))?;
    let columns: Vec<String> = query.column_names().into_iter().map(str::to_string).collect();
    let rows = query
        .query_map([], |row| (0..columns.len()).map(|index| row.get::<_, Value>(index)).collect::<rusqlite::Result<Vec<_>>>())?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok((columns, rows))
}

/// Copia as linhas para o banco novo, só com as colunas que ele conhece.
fn copy_rows(fresh: &Connection, table: &str, columns: &[String], rows: &[Vec<Value>]) -> rusqlite::Result<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let known: Vec<String> = fresh
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |row| row.get("name"))?
        .collect::<rusqlite::Result<_>>()?;
    let kept: Vec<usize> = (0..columns.len()).filter(|index| known.contains(&columns[*index])).collect();
    if kept.is_empty() {
        return Ok(());
    }
    // Os status recuperados substituem os padrão (os ids precisam ser os mesmos dos jogos).
    if table == "statuses" {
        fresh.execute("DELETE FROM statuses", [])?;
    }
    let names: Vec<&str> = kept.iter().map(|index| columns[*index].as_str()).collect();
    let marks = vec!["?"; kept.len()].join(", ");
    let mut insert = fresh.prepare(&format!("INSERT OR REPLACE INTO {table} ({}) VALUES ({marks})", names.join(", ")))?;
    for row in rows {
        insert.execute(rusqlite::params_from_iter(kept.iter().map(|index| &row[*index])))?;
    }
    Ok(())
}

/// Acerta as referências que podem ter ficado sem par depois de perder uma tabela.
fn fix_references(fresh: &Connection) -> rusqlite::Result<()> {
    let status_ids: Vec<i64> =
        fresh.prepare("SELECT id FROM statuses")?.query_map([], |row| row.get(0))?.collect::<rusqlite::Result<_>>()?;
    let id_by_preset = |preset: &str| -> rusqlite::Result<Option<i64>> {
        fresh.query_row("SELECT id FROM statuses WHERE preset = ?1", [preset], |row| row.get(0)).optional()
    };
    let first_status: i64 = fresh.query_row("SELECT id FROM statuses ORDER BY position LIMIT 1", [], |row| row.get(0))?;
    let setting = |key: &str| -> rusqlite::Result<i64> {
        let value: Option<Option<String>> =
            fresh.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0)).optional()?;
        Ok(value.flatten().and_then(|value| value.parse().ok()).unwrap_or(0))
    };
    let write_setting = |key: &str, value: i64| {
        fresh.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value.to_string()),
        )
    };

    // Regras automáticas apontando para status que não existem: voltam ao padrão.
    if !status_ids.contains(&setting("newGameStatusId")?) {
        write_setting("newGameStatusId", id_by_preset("planToPlay")?.unwrap_or(first_status))?;
    }
    if !status_ids.contains(&setting("firstPlayStatusId")?) {
        write_setting("firstPlayStatusId", id_by_preset("playing")?.unwrap_or(first_status))?;
    }
    // Jogos com um status que sumiu vão para o status de jogo novo.
    fresh.execute(
        "UPDATE games SET status_id = ?1 WHERE status_id NOT IN (SELECT id FROM statuses)",
        [setting("newGameStatusId")?],
    )?;
    // Sessões de jogos que não existem mais saem.
    fresh.execute("DELETE FROM play_sessions WHERE game_id NOT IN (SELECT id FROM games)", [])?;
    Ok(())
}

/// Guarda o arquivo danificado (e os arquivos auxiliares dele) com outro nome, na mesma pasta:
/// playtrove-danificado-2026-09-19T19-30-00-000Z.db. Devolve o caminho do principal.
fn keep_damaged_files(path: &Path) -> std::io::Result<PathBuf> {
    let stamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true).replace([':', '.'], "-");
    let name = path.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    let target = path.with_file_name(format!("{name}-danificado-{stamp}.db"));
    for suffix in SIDE_SUFFIXES {
        let file = with_suffix(path, suffix);
        if file.exists() {
            fs::rename(file, with_suffix(&target, suffix))?;
        }
    }
    Ok(target)
}

/// Apaga um banco temporário e os arquivos auxiliares dele (sobras de um conserto interrompido).
fn remove_database_files(path: &Path) -> std::io::Result<()> {
    for suffix in SIDE_SUFFIXES {
        let file = with_suffix(path, suffix);
        if file.exists() {
            fs::remove_file(file)?;
        }
    }
    Ok(())
}

/// O caminho com um sufixo no fim do nome (ex.: playtrove.db-journal).
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// O aviso mostrado quando o banco estava danificado e foi consertado ao abrir o app: o título, a
/// mensagem e o que voltou, o que não voltou e onde ficou o arquivo.
pub fn describe_repair(report: &RepairReport, language: Language) -> (String, String) {
    let table_name = |table: &str| text(language, &format!("repair.tables.{table}"), &[]);
    let recovered: Vec<String> = report.recovered.iter().map(|(table, rows)| format!("{} ({rows})", table_name(table))).collect();
    let mut lines = vec![if recovered.is_empty() {
        text(language, "repair.nothingRecovered", &[])
    } else {
        text(language, "repair.recovered", &[&recovered.join(", ")])
    }];
    for table in &report.lost {
        lines.push(text(
            language,
            "repair.lost",
            &[&table_name(table), &text(language, &format!("repair.effects.{table}"), &[])],
        ));
    }
    lines.push(String::new());
    lines.push(text(language, "repair.damagedFile", &[&report.damaged_file.to_string_lossy()]));
    let message = format!("{}\n\n{}", text(language, "repair.message", &[]), lines.join("\n"));
    (text(language, "dialogs.repairedTitle", &[]), message)
}

#[cfg(test)]
mod tests {
    use std::io::{Seek, SeekFrom, Write};

    use super::*;

    fn temp_database(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("playtrove-teste-banco-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        folder.join("playtrove.db")
    }

    /// Um banco com jogos, uma sessão, uma pasta de ROMs, um emulador e o primeiro status renomeado.
    fn library_file(name: &str) -> PathBuf {
        let path = temp_database(name);
        let (db, _) = open_database(&path).unwrap();
        db.execute_batch(
            "INSERT INTO games (title, status_id, added_at) VALUES ('Jogo A', 4, '2026-09-01T00:00:00.000Z'), ('Jogo B', 7, '2026-09-02T00:00:00.000Z');
             INSERT INTO play_sessions (game_id, started_at, ended_at, seconds) VALUES (1, '2026-09-03T00:00:00.000Z', '2026-09-03T01:00:00.000Z', 3600);
             INSERT INTO rom_folders (path, emulator_id, platform) VALUES ('D:\\PS2', 'pcsx2', 'PlayStation 2');
             INSERT INTO emulators (id, path) VALUES ('pcsx2', 'D:\\PCSX2\\pcsx2-qt.exe');
             UPDATE statuses SET name = 'Quero jogar', preset = NULL WHERE position = 0;",
        )
        .unwrap();
        path
    }

    /// Zera as páginas onde começam essas tabelas, como um arquivo que perdeu pedaços.
    fn damage_tables(path: &Path, tables: &[&str]) {
        let db = Connection::open(path).unwrap();
        let page_size: i64 = db.pragma_query_value(None, "page_size", |row| row.get(0)).unwrap();
        let pages: Vec<i64> = tables
            .iter()
            .map(|table| db.query_row("SELECT rootpage FROM sqlite_master WHERE name = ?1", [table], |row| row.get(0)).unwrap())
            .collect();
        drop(db);
        let mut file = fs::OpenOptions::new().write(true).open(path).unwrap();
        for page in pages {
            file.seek(SeekFrom::Start(((page - 1) * page_size) as u64)).unwrap();
            file.write_all(&vec![0; page_size as usize]).unwrap();
        }
    }

    fn damaged_files(path: &Path) -> Vec<String> {
        fs::read_dir(path.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains("danificado"))
            .collect()
    }

    #[test]
    fn banco_novo_com_o_diario_comum_e_todas_as_migracoes() {
        let path = temp_database("novo");
        let (db, repair) = open_database(&path).unwrap();
        assert!(repair.is_none());
        let mode: String = db.query_row("PRAGMA journal_mode", [], |row| row.get(0)).unwrap();
        assert_eq!(mode, "delete");
        let version: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0)).unwrap();
        assert_eq!(version, LANGUAGES_VERSION);
    }

    #[test]
    fn banco_antigo_em_wal_passa_para_o_diario_comum_sem_perder_nada() {
        let path = library_file("wal");
        let db = Connection::open(&path).unwrap();
        db.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(())).unwrap();
        drop(db);
        let (db, repair) = open_database(&path).unwrap();
        assert!(repair.is_none());
        let mode: String = db.query_row("PRAGMA journal_mode", [], |row| row.get(0)).unwrap();
        assert_eq!(mode, "delete");
        let games: i64 = db.query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(games, 2);
    }

    #[test]
    fn recupera_o_que_da_para_ler_acerta_os_status_e_guarda_o_arquivo_danificado() {
        let path = library_file("danificado");
        damage_tables(&path, &["statuses", "emulators"]);

        let (db, repair) = open_database(&path).unwrap();
        let repair = repair.expect("o banco devia ter sido consertado");
        assert_eq!(repair.lost, ["statuses", "emulators"]);
        assert!(repair.recovered.contains(&("games", 2)));
        assert!(repair.recovered.contains(&("rom_folders", 1)));
        assert_eq!(damaged_files(&path).len(), 1);

        // Os status voltaram ao padrão, e os jogos continuam com status que existem.
        let statuses: i64 = db.query_row("SELECT COUNT(*) FROM statuses", [], |row| row.get(0)).unwrap();
        assert_eq!(statuses, 9);
        let orphans: i64 = db
            .query_row("SELECT COUNT(*) FROM games WHERE status_id NOT IN (SELECT id FROM statuses)", [], |row| row.get(0))
            .unwrap();
        assert_eq!(orphans, 0);
        assert!(is_healthy(&db));
    }

    #[test]
    fn com_os_status_inteiros_eles_sao_mantidos() {
        let path = library_file("status-inteiros");
        damage_tables(&path, &["emulators"]);
        let (db, repair) = open_database(&path).unwrap();
        assert_eq!(repair.unwrap().lost, ["emulators"]);
        let first: String = db.query_row("SELECT name FROM statuses ORDER BY position LIMIT 1", [], |row| row.get(0)).unwrap();
        assert_eq!(first, "Quero jogar");
    }

    #[test]
    fn um_arquivo_que_nem_e_banco_vira_um_banco_novo_e_o_arquivo_fica_guardado() {
        let path = temp_database("lixo");
        fs::write(&path, "isto não é um banco de dados, mas tem mais de cem bytes para o SQLite olhar o cabeçalho.").unwrap();
        let (db, repair) = open_database(&path).unwrap();
        let repair = repair.unwrap();
        assert!(repair.recovered.is_empty());
        let statuses: i64 = db.query_row("SELECT COUNT(*) FROM statuses", [], |row| row.get(0)).unwrap();
        assert_eq!(statuses, 9);
        assert_eq!(damaged_files(&path).len(), 1);
    }

    #[test]
    fn o_aviso_diz_o_que_voltou_o_que_nao_voltou_e_onde_ficou_o_arquivo() {
        let report = RepairReport {
            recovered: vec![("games", 12), ("settings", 3)],
            lost: vec!["statuses"],
            damaged_file: PathBuf::from("C:\\dados\\playtrove-danificado.db"),
        };
        let (title, message) = describe_repair(&report, Language::PtBr);
        assert_eq!(title, "Banco de dados consertado");
        assert!(message.starts_with("O banco de dados da biblioteca estava danificado e foi consertado."));
        assert!(message.contains("Recuperado: jogos (12), configurações e chaves (3)."));
        assert!(message.contains("Não deu para recuperar: status. Por isso, os status voltaram ao padrão"));
        assert!(message.ends_with("O arquivo danificado foi guardado em: C:\\dados\\playtrove-danificado.db"));
    }
}
