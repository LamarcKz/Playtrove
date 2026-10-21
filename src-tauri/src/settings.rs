//! As configurações do app (tabela settings): o idioma, as regras de status...

use rusqlite::{Connection, OptionalExtension};

/// Lê uma configuração. None se ela nunca foi gravada.
pub fn get_setting(db: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    let value =
        db.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get::<_, Option<String>>(0)).optional()?;
    Ok(value.flatten())
}

/// Grava (ou troca) uma configuração.
pub fn set_setting(db: &Connection, key: &str, value: Option<&str>) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )?;
    Ok(())
}
