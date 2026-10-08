import { existsSync, openSync, readdirSync, writeFileSync, writeSync, closeSync } from "node:fs"
import { join } from "node:path"
import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import { openDatabaseFile } from "../../src/main/databaseFile"
import { setEmulatorPath } from "../../src/main/emulators"
import { addEmulatedGame, getStatusRules, listGames, listStatuses, renameStatus } from "../../src/main/library"
import { DEFAULT_STATUSES, runMigrations } from "../../src/main/migrations"
import { describeRepair } from "../../src/main/repairNotice"
import { makeTempDir, removeTempDirs } from "./helpers"

afterEach(removeTempDirs)

/** Um banco com um jogo, uma pasta, um emulador e um status renomeado; fecha e devolve o caminho. */
function createLibrary(): { dir: string; file: string } {
  const dir = makeTempDir()
  const file = join(dir, "playtrove.db")
  const { db } = openDatabaseFile(file)
  addEmulatedGame(db, { title: "Salto Estelar", romPath: "D:\\PS2\\Salto Estelar.iso", platform: "PlayStation 2", library: "PCSX2", emulatorId: "pcsx2", core: null })
  db.prepare("INSERT INTO rom_folders (path, emulator_id, core, platform) VALUES (?, ?, ?, ?)").run("D:\\PS2", "pcsx2", null, "PlayStation 2")
  setEmulatorPath(db, "pcsx2", "D:\\PCSX2\\pcsx2-qt.exe")
  renameStatus(db, listStatuses(db)[0].id, "Quero jogar")
  db.close()
  return { dir, file }
}

/** Zera as páginas onde começam essas tabelas, como um arquivo que perdeu pedaços. */
function damageTables(file: string, tables: string[]): void {
  const db = new Database(file, { readonly: true })
  const pageSize = db.pragma("page_size", { simple: true }) as number
  const pages = tables.map((table) => db.prepare("SELECT rootpage FROM sqlite_master WHERE name = ?").pluck().get(table) as number)
  db.close()
  const fd = openSync(file, "r+")
  for (const page of pages) writeSync(fd, Buffer.alloc(pageSize), 0, pageSize, (page - 1) * pageSize)
  closeSync(fd)
}

describe("abrir o banco", () => {
  it("banco novo: diário comum (sem WAL), todas as migrações", () => {
    const file = join(makeTempDir(), "playtrove.db")
    const { db, repair } = openDatabaseFile(file)
    expect(repair).toBeNull()
    expect(db.pragma("journal_mode", { simple: true })).toBe("delete")
    expect(db.pragma("user_version", { simple: true })).toBe(8)
    db.close()
    expect(existsSync(`${file}-wal`)).toBe(false)
  })

  it("banco antigo em WAL passa para o diário comum sem perder nada", () => {
    const dir = makeTempDir()
    const file = join(dir, "playtrove.db")
    const old = new Database(file)
    old.pragma("journal_mode = WAL")
    old.exec("CREATE TABLE teste (valor TEXT); INSERT INTO teste VALUES ('ainda aqui')")
    old.close()

    const { db } = openDatabaseFile(file)
    expect(db.pragma("journal_mode", { simple: true })).toBe("delete")
    expect(db.prepare("SELECT valor FROM teste").pluck().get()).toBe("ainda aqui")
    db.close()
  })
})

describe("conserto de um banco danificado", () => {
  it("recupera o que dá para ler, acerta os status e guarda o arquivo danificado", () => {
    const { dir, file } = createLibrary()
    damageTables(file, ["statuses", "emulators"])

    const { db, repair } = openDatabaseFile(file)

    expect(repair?.lost).toEqual(["statuses", "emulators"])
    expect(repair?.recovered).toEqual([
      { table: "games", rows: 1 },
      { table: "rom_folders", rows: 1 },
      { table: "settings", rows: 2 },
      { table: "play_sessions", rows: 0 },
      { table: "ra_catalog", rows: 0 },
      { table: "ra_games", rows: 0 },
      { table: "achievements", rows: 0 },
      { table: "trophy_sets", rows: 0 },
      { table: "trophies", rows: 0 },
    ])
    expect(db.pragma("quick_check", { simple: true })).toBe("ok")
    // Os status voltaram ao padrão (o nome trocado se perdeu) e o jogo aponta para um que existe.
    expect(listStatuses(db).map((status) => status.name)).toEqual(DEFAULT_STATUSES)
    expect(listGames(db)).toMatchObject([{ title: "Salto Estelar", statusId: getStatusRules(db).newGameStatusId }])
    expect(db.prepare("SELECT COUNT(*) FROM emulators").pluck().get()).toBe(0)
    // O arquivo danificado ficou guardado ao lado, e nada foi apagado.
    expect(repair?.damagedFile).toMatch(/playtrove-danificado-.+\.db$/)
    expect(existsSync(repair?.damagedFile as string)).toBe(true)
    expect(readdirSync(dir).filter((name) => name.includes("recuperando"))).toEqual([])
    db.close()
  })

  it("com os status inteiros, eles são mantidos (inclusive os nomes trocados)", () => {
    const { file } = createLibrary()
    damageTables(file, ["emulators"])
    const { db, repair } = openDatabaseFile(file)
    expect(repair?.lost).toEqual(["emulators"])
    expect(listStatuses(db)[0].name).toBe("Quero jogar")
    db.close()
  })

  it("banco de antes dos idiomas (versão 7): os status padrão e os gêneros recuperados também são acertados", () => {
    const dir = makeTempDir()
    const file = join(dir, "playtrove.db")
    const old = new Database(file)
    old.pragma("journal_mode = DELETE")
    runMigrations(old, 7)
    old.prepare("UPDATE statuses SET name = 'Quero jogar' WHERE name = 'Planejo jogar'").run()
    const statusId = old.prepare("SELECT id FROM statuses WHERE name = 'Jogando'").pluck().get()
    old.prepare("INSERT INTO games (title, status_id, added_at, genres) VALUES (?, ?, ?, ?)").run(
      "Salto Estelar",
      statusId,
      new Date().toISOString(),
      JSON.stringify(["Corrida", "RPG"])
    )
    old.close()
    damageTables(file, ["emulators"])

    const { db, repair } = openDatabaseFile(file)
    expect(repair?.lost).toEqual(["emulators"])
    expect(db.pragma("user_version", { simple: true })).toBe(8)
    expect(db.prepare("SELECT name, preset FROM statuses ORDER BY position LIMIT 4").all()).toEqual([
      { name: "Quero jogar", preset: null },
      { name: "Parei por um tempo", preset: "onHold" },
      { name: "Abandonei", preset: "abandoned" },
      { name: "Jogando", preset: "playing" },
    ])
    expect(listGames(db)[0].genres).toEqual(["Racing", "Role-playing (RPG)"])
    db.close()
  })

  it("um arquivo que nem é banco vira um banco novo, e o arquivo fica guardado", () => {
    const dir = makeTempDir()
    const file = join(dir, "playtrove.db")
    writeFileSync(file, "isto não é um banco de dados, mas tem mais de cem bytes para o SQLite olhar o cabeçalho.")
    const { db, repair } = openDatabaseFile(file)
    expect(repair?.recovered).toEqual([])
    expect(repair?.lost).toHaveLength(11)
    expect(listStatuses(db)).toHaveLength(DEFAULT_STATUSES.length)
    db.close()
  })

  it("o aviso diz o que voltou, o que não voltou e onde ficou o arquivo", () => {
    const { message, detail } = describeRepair({
      recovered: [
        { table: "games", rows: 7 },
        { table: "settings", rows: 5 },
      ],
      lost: ["statuses", "emulators"],
      damagedFile: "C:\\dados\\playtrove-danificado.db",
    })
    expect(message).toBe("O banco de dados da biblioteca estava danificado e foi consertado.")
    expect(detail).toContain("Recuperado: jogos (7), configurações e chaves (5).")
    expect(detail).toContain("Não deu para recuperar: status. Por isso, os status voltaram ao padrão")
    expect(detail).toContain("Não deu para recuperar: emuladores. Por isso, os emuladores vão ser procurados de novo.")
    expect(detail).toContain("C:\\dados\\playtrove-danificado.db")
  })
})
