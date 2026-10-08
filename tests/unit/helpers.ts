import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import Database from "better-sqlite3"
import type { Game } from "@shared/types"
import { runMigrations } from "../../src/main/migrations"

const DAY = 24 * 60 * 60 * 1000

/** Um jogo de teste: só o que importa para cada teste precisa ser informado. */
export function makeGame(overrides: Partial<Game> & { id: number; title: string }): Game {
  return {
    statusId: 1,
    favorite: false,
    playtimeMinutes: 0,
    lastPlayedAt: null,
    addedAt: new Date().toISOString(),
    platform: null,
    library: null,
    romPath: null,
    emulatorId: null,
    description: null,
    genres: [],
    developers: [],
    publishers: [],
    releaseDate: null,
    coverUrl: null,
    backgroundUrl: null,
    metadataUpdatedAt: null,
    rating: null,
    difficulty: null,
    review: null,
    achievements: null,
    ...overrides,
  }
}

/** Data de alguns dias atrás, no formato ISO. */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString()
}

/** Um banco novo, só na memória, já com as tabelas criadas. */
export function memoryDatabase(): Database.Database {
  const db = new Database(":memory:")
  db.pragma("foreign_keys = ON")
  runMigrations(db)
  return db
}

/** Pastas temporárias criadas pelos testes (apagadas por removeTempDirs). */
const tempDirs: string[] = []

/**
 * Cria uma pasta temporária com arquivos vazios (ou com o texto dado), para testar a leitura de
 * pastas sem mexer em nada de verdade. Os caminhos usam "/" e podem ter subpastas.
 */
export function makeTempDir(files: Record<string, string> | string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "playtrove-unit-"))
  tempDirs.push(root)
  const entries = Array.isArray(files) ? files.map((file) => [file, ""]) : Object.entries(files)
  for (const [file, content] of entries) {
    const path = join(root, ...file.split("/"))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  return root
}

/** Apaga as pastas temporárias (chamar no afterEach). */
export function removeTempDirs(): void {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}
