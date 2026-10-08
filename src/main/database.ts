import type Database from "better-sqlite3"
import { openDatabaseFile, type RepairReport } from "./databaseFile"

/** Conexão única com o banco SQLite, aberta quando o app inicia. */
let db: Database.Database | null = null
/** O conserto feito ao abrir, se o banco estava danificado (para avisar o usuário). */
let repairReport: RepairReport | null = null

/**
 * Abre o banco (o arquivo é criado na primeira vez), conserta se ele estiver danificado e atualiza as
 * tabelas. O caminho vem de locateData(), na pasta de dados do app.
 */
export function openDatabase(filePath: string): Database.Database {
  if (db) return db

  const opened = openDatabaseFile(filePath)
  db = opened.db
  repairReport = opened.repair
  console.log(`[banco] conectado em ${filePath}${repairReport ? " (consertado)" : ""}`)
  return db
}

/** Devolve a conexão aberta. */
export function getDatabase(): Database.Database {
  if (!db) throw new Error("O banco ainda não foi aberto: chame openDatabase() antes.")
  return db
}

/** O conserto feito ao abrir o banco, se houve (só uma vez: depois de lido, some). */
export function takeRepairReport(): RepairReport | null {
  const report = repairReport
  repairReport = null
  return report
}

/** Fecha a conexão (o app chama isto ao sair). */
export function closeDatabase(): void {
  db?.close()
  db = null
}
