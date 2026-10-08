import { cpSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import Database from "better-sqlite3"
import { DATABASE_FILE, type DataLocation } from "./dataFolder"

/** A pasta da biblioteca do npm run dev, ao lado da de verdade: %APPDATA%\Playtrove Dev. */
export const DEV_FOLDER = "Playtrove Dev"

/** O que vai junto com o banco na cópia: as imagens e a chave que tranca as senhas (as chaves das APIs). */
const COPIED_ALONG = ["images", "Local State"]

/**
 * A biblioteca do npm run dev: uma cópia da de verdade, numa pasta à parte, para o código em
 * desenvolvimento nunca mexer nos jogos de verdade (escolha do usuário em 2026-09-29). Na primeira vez,
 * ou depois do `npm run dev:nova-copia`, copia o banco, as imagens e a chave das senhas; a biblioteca
 * de verdade só é lida. Sem biblioteca de verdade, a do dev começa vazia.
 */
export function devLibrary(real: DataLocation, devFolder: string): DataLocation {
  const dev = { folder: devFolder, databaseFile: DATABASE_FILE }
  const devDatabase = join(devFolder, DATABASE_FILE)
  if (existsSync(devDatabase)) return dev

  mkdirSync(devFolder, { recursive: true })
  const realDatabase = join(real.folder, real.databaseFile)
  if (!existsSync(realDatabase)) return dev

  // O VACUUM INTO grava uma cópia inteira e coerente, mesmo com o app instalado aberto e gravando.
  const source = new Database(realDatabase, { readonly: true, fileMustExist: true })
  try {
    source.prepare("VACUUM INTO ?").run(devDatabase)
  } finally {
    source.close()
  }
  for (const name of COPIED_ALONG) {
    const from = join(real.folder, name)
    if (existsSync(from)) cpSync(from, join(devFolder, name), { recursive: true })
  }
  return dev
}
