//! A conexão com o banco SQLite (a biblioteca), aberta quando o app inicia.

use std::path::Path;

use rusqlite::Connection;

use crate::migrations::run_migrations;

/// Abre o banco (o arquivo é criado na primeira vez) e atualiza as tabelas.
///
/// Sem WAL (journal_mode = DELETE), como no app em Electron: cada gravação vai direto para o arquivo do
/// banco, e nada fica só num arquivo de registro à parte, que pode se perder se o app for fechado à força.
pub fn open_database(path: &Path) -> rusqlite::Result<Connection> {
    let mut db = Connection::open(path)?;
    db.query_row("PRAGMA journal_mode = DELETE", [], |_| Ok(()))?;
    db.pragma_update(None, "foreign_keys", true)?;
    run_migrations(&mut db)?;
    Ok(db)
}
