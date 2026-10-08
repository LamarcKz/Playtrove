import type Database from "better-sqlite3"

/** Lê uma configuração do app (tabela settings). null se ela nunca foi gravada. */
export function getSetting(db: Database.Database, key: string): string | null {
  const value = db.prepare("SELECT value FROM settings WHERE key = ?").pluck().get(key)
  return typeof value === "string" ? value : null
}

/** Grava (ou troca) uma configuração do app. */
export function setSetting(db: Database.Database, key: string, value: string | null): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value
  )
}
