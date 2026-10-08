import { existsSync, renameSync, rmSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import Database from "better-sqlite3"
import type { StatusPreset } from "../shared/i18n"
import { LANGUAGES_VERSION, runMigrations, upgradeToLanguages } from "./migrations"

/** As tabelas do banco, na ordem em que o conserto copia (os status antes dos jogos). */
const TABLES = [
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
] as const
type TableName = (typeof TABLES)[number]

/** O que o conserto de um banco danificado conseguiu salvar. */
export interface RepairReport {
  /** Tabelas copiadas para o banco novo, com quantas linhas cada uma. */
  recovered: { table: TableName; rows: number }[]
  /** Tabelas que não deu para ler: voltaram ao padrão (status) ou ficaram vazias. */
  lost: TableName[]
  /** Onde ficou guardado o arquivo danificado (nada é apagado). */
  damagedFile: string
}

/**
 * Abre o banco do arquivo (criando se não existir) e deixa ele pronto para uso:
 * 1. confere se ele está íntegro; se não estiver, conserta (veja `repairDatabase`);
 * 2. usa o diário comum do SQLite (sem WAL): cada gravação vai direto para o arquivo do banco,
 *    e não fica só num arquivo de registro à parte, que pode se perder num fechamento forçado;
 * 3. aplica as migrações que faltam.
 */
export function openDatabaseFile(filePath: string): { db: Database.Database; repair: RepairReport | null } {
  let db = new Database(filePath)
  let repair: RepairReport | null = null
  if (!isHealthy(db)) {
    repair = repairDatabase(db, filePath)
    db = new Database(filePath)
  }
  db.pragma("journal_mode = DELETE")
  db.pragma("foreign_keys = ON")
  runMigrations(db)
  return { db, repair }
}

/** O banco está íntegro? (Um arquivo que nem é um banco também conta como danificado.) */
function isHealthy(db: Database.Database): boolean {
  try {
    return db.pragma("quick_check", { simple: true }) === "ok"
  } catch {
    return false
  }
}

/**
 * Conserta um banco danificado: cria um banco novo (com os status e as regras padrão), copia para
 * ele cada tabela que ainda dá para ler e acerta o que ficou sem par (ex.: jogo com um status que
 * sumiu). O arquivo danificado é guardado ao lado, com "danificado" e a data no nome, e o novo
 * toma o lugar dele. Fecha a conexão `damaged`.
 */
function repairDatabase(damaged: Database.Database, filePath: string): RepairReport {
  const tempPath = `${filePath}.recuperando`
  removeDatabaseFiles(tempPath)
  const fresh = new Database(tempPath)
  fresh.pragma("journal_mode = DELETE")
  runMigrations(fresh)

  const existing = readTableNames(damaged)
  const version = readVersion(damaged)
  const recovered: RepairReport["recovered"] = []
  const lost: TableName[] = []
  fresh.transaction(() => {
    for (const table of TABLES) {
      // Tabela que o banco antigo nem tinha (versão mais antiga do app): não é dano.
      if (existing && !existing.has(table)) continue
      let rows: Record<string, unknown>[]
      try {
        rows = damaged.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
      } catch {
        lost.push(table)
        continue
      }
      copyRows(fresh, table, rows)
      recovered.push({ table, rows: rows.length })
    }
    // O banco novo já está na última versão; o que veio de um banco de antes dos idiomas é acertado aqui.
    if (version !== null && version < LANGUAGES_VERSION) upgradeToLanguages(fresh)
    fixReferences(fresh)
  })()

  fresh.close()
  try {
    damaged.close()
  } catch {
    // Mesmo que o fechamento reclame do dano, o arquivo é guardado do jeito que está.
  }
  const damagedFile = keepDamagedFiles(filePath)
  renameSync(tempPath, filePath)
  return { recovered, lost, damagedFile }
}

/** A versão do banco (PRAGMA user_version), ou null se nem ela der para ler. */
function readVersion(db: Database.Database): number | null {
  try {
    return db.pragma("user_version", { simple: true }) as number
  } catch {
    return null
  }
}

/** Os nomes das tabelas do banco, ou null se nem a lista de tabelas der para ler. */
function readTableNames(db: Database.Database): Set<string> | null {
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[]
    return new Set(names)
  } catch {
    return null
  }
}

/** Copia as linhas para o banco novo, só com as colunas que ele conhece. */
function copyRows(fresh: Database.Database, table: TableName, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return
  const columns = new Set(
    (fresh.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name)
  )
  // Os status recuperados substituem os padrão (os ids precisam ser os mesmos dos jogos).
  if (table === "statuses") fresh.prepare("DELETE FROM statuses").run()
  for (const row of rows) {
    const keys = Object.keys(row).filter((key) => columns.has(key))
    if (keys.length === 0) continue
    fresh
      .prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
      .run(...keys.map((key) => row[key]))
  }
}

/** Acerta as referências que podem ter ficado sem par depois de perder uma tabela. */
function fixReferences(fresh: Database.Database): void {
  const statusIds = new Set(fresh.prepare("SELECT id FROM statuses ORDER BY position").pluck().all() as number[])
  const idByPreset = (preset: StatusPreset) =>
    fresh.prepare("SELECT id FROM statuses WHERE preset = ?").pluck().get(preset) as number | undefined
  const firstStatus = fresh.prepare("SELECT id FROM statuses ORDER BY position LIMIT 1").pluck().get() as number
  const setting = (key: string) => Number(fresh.prepare("SELECT value FROM settings WHERE key = ?").pluck().get(key))
  const writeSetting = (key: string, value: number) =>
    fresh
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, String(value))

  // Regras automáticas apontando para status que não existem: voltam ao padrão.
  if (!statusIds.has(setting("newGameStatusId"))) writeSetting("newGameStatusId", idByPreset("planToPlay") ?? firstStatus)
  if (!statusIds.has(setting("firstPlayStatusId"))) writeSetting("firstPlayStatusId", idByPreset("playing") ?? firstStatus)
  // Jogos com um status que sumiu vão para o status de jogo novo.
  fresh.prepare("UPDATE games SET status_id = ? WHERE status_id NOT IN (SELECT id FROM statuses)").run(setting("newGameStatusId"))
  // Sessões de jogos que não existem mais saem.
  fresh.prepare("DELETE FROM play_sessions WHERE game_id NOT IN (SELECT id FROM games)").run()
}

/**
 * Guarda o arquivo danificado (e os arquivos auxiliares dele) com outro nome, na mesma pasta:
 * playtrove-danificado-2026-09-19T19-30-00-000Z.db. Devolve o caminho do principal.
 */
function keepDamagedFiles(filePath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const name = basename(filePath).replace(/\.db$/, "")
  const target = join(dirname(filePath), `${name}-danificado-${stamp}.db`)
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    if (existsSync(filePath + suffix)) renameSync(filePath + suffix, target + suffix)
  }
  return target
}

/** Apaga um banco temporário e os arquivos auxiliares dele (sobras de um conserto interrompido). */
function removeDatabaseFiles(filePath: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(filePath + suffix, { force: true })
}
