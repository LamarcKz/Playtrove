import { writeFileSync } from "node:fs"
import { join } from "node:path"
import type Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import {
  findPlaytimeFiles,
  parsePlaytimeDat,
  parseRetroArchLog,
  parseRpcs3Settings,
  syncEmulatorPlaytime,
  type EmulatorPlaytime,
  type EmulatorRecords,
} from "../../src/main/emulatorPlaytime"
import { addEmulatedGame, listGames, recordPlaySession } from "../../src/main/library"
import { buildIso } from "../fakeDiscs"
import { makeTempDir, memoryDatabase, removeTempDirs } from "./helpers"

afterEach(removeTempDirs)

/** Uma linha do playtime.dat, do jeitinho que o PCSX2 e o DuckStation escrevem (campos alinhados). */
const line = (serial: string, seconds: number, lastPlayed: number) =>
  `${serial.padEnd(32)} ${String(seconds).padEnd(20)} ${String(lastPlayed).padEnd(20)}`

const localIso = (text: string) => {
  const [year, month, day, hour, minute, second] = text.split(/[-T :]/).map(Number)
  return new Date(year, month - 1, day, hour, minute, second).toISOString()
}

describe("registros de tempo dos emuladores", () => {
  it("playtime.dat do PCSX2 e do DuckStation", () => {
    const records = parsePlaytimeDat(
      [line("SLUS-20100", 2237, 1789843213), line("SLUS-00100", 0, 0), "linha estranha", ""].join("\n")
    )
    expect(records.get("SLUS-20100")).toEqual({ seconds: 2237, lastPlayedAt: new Date(1789843213 * 1000).toISOString() })
    expect(records.get("SLUS-00100")).toEqual({ seconds: 0, lastPlayedAt: null })
    expect(records.size).toBe(2)
  })

  it("persistent_settings.dat do RPCS3 (milissegundos e data do computador)", () => {
    const records = parseRpcs3Settings("[Playtime]\nBLUS30100=294145\n\n[LastPlayed]\nBLUS30100=2026-09-12T21:27:47\n")
    expect(records.get("BLUS30100")).toEqual({ seconds: 294, lastPlayedAt: localIso("2026-09-12T21:27:47") })
  })

  it("registro do RetroArch (.lrtl)", () => {
    const log = '{"version": "1.0", "runtime": "1:02:25", "last_played": "2026-09-12 19:37:50", "play_count": "4"}'
    expect(parseRetroArchLog(log)).toEqual({ seconds: 3745, lastPlayedAt: localIso("2026-09-12 19:37:50") })
    expect(parseRetroArchLog("{}")).toBeNull()
    expect(parseRetroArchLog("não é json")).toBeNull()
  })
})

describe("onde ficam os registros de cada emulador", () => {
  it("PCSX2 portátil e comum, DuckStation no AppData, RPCS3 e RetroArch na pasta deles", () => {
    const dir = makeTempDir({
      // PCSX2 portátil: tudo na pasta dele.
      "PCSX2/portable.ini": "",
      "PCSX2/inis/playtime.dat": "",
      "PCSX2/pcsx2-qt.exe": "",
      // DuckStation comum: os dados ficam no AppData\Local.
      "DuckStation/duckstation-qt.exe": "",
      "LocalAppData/DuckStation/playtime.dat": "",
      "RPCS3/rpcs3.exe": "",
      "RPCS3/GuiConfigs/persistent_settings.dat": "",
      "RetroArch/retroarch.exe": "",
      "RetroArch/playlists/logs/mGBA/Jogo.lrtl": "",
    })
    const paths = {
      pcsx2: join(dir, "PCSX2", "pcsx2-qt.exe"),
      duckstation: join(dir, "DuckStation", "duckstation-qt.exe"),
      rpcs3: join(dir, "RPCS3", "rpcs3.exe"),
      retroarch: join(dir, "RetroArch", "retroarch.exe"),
    }

    expect(findPlaytimeFiles(paths, { documents: join(dir, "Documentos"), localAppData: join(dir, "LocalAppData") })).toEqual({
      pcsx2: join(dir, "PCSX2", "inis", "playtime.dat"),
      duckstation: join(dir, "LocalAppData", "DuckStation", "playtime.dat"),
      rpcs3: join(dir, "RPCS3", "GuiConfigs", "persistent_settings.dat"),
      retroarchLogs: join(dir, "RetroArch", "playlists", "logs"),
    })
  })

  it("PCSX2 não portátil: os dados ficam em Documentos", () => {
    const dir = makeTempDir({ "PCSX2/pcsx2-qt.exe": "", "Documentos/PCSX2/inis/playtime.dat": "" })
    const files = findPlaytimeFiles(
      { pcsx2: join(dir, "PCSX2", "pcsx2-qt.exe") },
      { documents: join(dir, "Documentos"), localAppData: undefined }
    )
    expect(files.pcsx2).toBe(join(dir, "Documentos", "PCSX2", "inis", "playtime.dat"))
    expect(files.duckstation).toBeNull()
  })

  it("sem emulador configurado (ou sem os arquivos), não há o que ler", () => {
    expect(findPlaytimeFiles({}, { documents: "C:\\Documentos", localAppData: "C:\\Local" })).toEqual({
      pcsx2: null,
      duckstation: null,
      rpcs3: null,
      retroarchLogs: null,
    })
  })
})

describe("juntar o tempo dos emuladores com a biblioteca", () => {
  const SERIAL = "SLUS-20100"

  /** Um banco com um jogo de PS2 e o código do disco já guardado. */
  function setup(): { db: Database.Database; gameId: number } {
    const db = memoryDatabase()
    const gameId = addEmulatedGame(db, {
      title: "Corrida Noturna",
      romPath: "D:\\PS2\\Corrida Noturna.iso",
      platform: "PlayStation 2",
      library: "PCSX2",
      emulatorId: "pcsx2",
      core: null,
    }) as number
    db.prepare("UPDATE games SET serial = ? WHERE id = ?").run(SERIAL, gameId)
    return { db, gameId }
  }

  const records = (playtime: EmulatorPlaytime): EmulatorRecords => ({
    bySerial: { pcsx2: new Map([[SERIAL, playtime]]) },
    retroarch: () => null,
  })

  it("primeira leitura: o tempo do emulador entra na biblioteca e na atividade da última vez jogado", () => {
    const { db } = setup()
    const lastPlayed = new Date(2026, 8, 19, 15, 40).toISOString()
    const now = new Date(2026, 8, 19, 20, 0)

    expect(syncEmulatorPlaytime(db, records({ seconds: 2237, lastPlayedAt: lastPlayed }), now)).toBe(1)

    expect(listGames(db)[0]).toMatchObject({ playtimeMinutes: 37, lastPlayedAt: lastPlayed })
    // O que o emulador já tinha registrado entra na atividade no dia da última vez jogado.
    expect(db.prepare("SELECT seconds, ended_at, source FROM play_sessions").all()).toEqual([
      { seconds: 2237, ended_at: lastPlayed, source: "emulador" },
    ])
    // Ler de novo, sem nada novo, não mexe em nada.
    expect(syncEmulatorPlaytime(db, records({ seconds: 2237, lastPlayedAt: lastPlayed }), now)).toBe(0)
    expect(db.prepare("SELECT COUNT(*) FROM play_sessions").pluck().get()).toBe(1)
  })

  it("recomeçar a leitura (migração 4) não conta de novo o que já virou sessão", () => {
    const { db } = setup()
    const lastPlayed = new Date(2026, 8, 19, 15, 40).toISOString()
    const now = new Date(2026, 8, 19, 20, 0)
    syncEmulatorPlaytime(db, records({ seconds: 2237, lastPlayedAt: lastPlayed }), now)

    // A migração 4 zera a última leitura para o tempo antigo entrar na atividade por dia.
    db.prepare("UPDATE games SET emulator_synced_at = NULL").run()
    syncEmulatorPlaytime(db, records({ seconds: 2237, lastPlayedAt: lastPlayed }), now)

    expect(db.prepare("SELECT COUNT(*) FROM play_sessions").pluck().get()).toBe(1)
    expect(listGames(db)[0].playtimeMinutes).toBe(37)
  })

  it("primeira leitura de um jogo parado há meses: só o total, sem sessão", () => {
    const { db } = setup()
    const lastPlayed = new Date(2026, 5, 1, 15, 0).toISOString()

    syncEmulatorPlaytime(db, records({ seconds: 7200, lastPlayedAt: lastPlayed }), new Date(2026, 8, 19, 20, 0))

    expect(listGames(db)[0].playtimeMinutes).toBe(120)
    // Fora dos 30 dias do gráfico: esse tempo fica só nos totais.
    expect(db.prepare("SELECT COUNT(*) FROM play_sessions").pluck().get()).toBe(0)
  })

  it("o que foi jogado fora do app depois da última leitura vira uma sessão", () => {
    const { db } = setup()
    const antes = new Date(2026, 8, 18, 20, 0).toISOString()
    syncEmulatorPlaytime(db, records({ seconds: 600, lastPlayedAt: antes }), new Date(2026, 8, 19, 8, 0))

    const lastPlayed = new Date(2026, 8, 19, 21, 30).toISOString()
    const now = new Date(2026, 8, 19, 21, 35)
    expect(syncEmulatorPlaytime(db, records({ seconds: 600 + 1800, lastPlayedAt: lastPlayed }), now)).toBe(1)

    const sessions = db.prepare("SELECT seconds, ended_at, source FROM play_sessions").all()
    expect(sessions).toEqual([
      { seconds: 600, ended_at: antes, source: "emulador" },
      { seconds: 1800, ended_at: lastPlayed, source: "emulador" },
    ])
    expect(listGames(db)[0].playtimeMinutes).toBe(40)
  })

  it("o tempo contado pelo app não entra duas vezes", () => {
    const { db, gameId } = setup()
    const antes = new Date(2026, 8, 18, 20, 0).toISOString()
    syncEmulatorPlaytime(db, records({ seconds: 600, lastPlayedAt: antes }), new Date(2026, 8, 19, 20, 0))

    // O usuário jogou pelo botão Jogar: o app registrou a sessão, e o emulador somou o mesmo tempo.
    const endedAt = new Date(2026, 8, 19, 22, 0).toISOString()
    recordPlaySession(db, gameId, 1800, endedAt)
    syncEmulatorPlaytime(db, records({ seconds: 600 + 1790, lastPlayedAt: endedAt }), new Date(2026, 8, 19, 22, 5))

    // A segunda leitura não criou sessão: a atividade por dia não conta o mesmo tempo duas vezes.
    expect(db.prepare("SELECT source FROM play_sessions").pluck().all()).toEqual(["emulador", "app"])
    // O total é o do emulador (10 min de antes + 30 desta vez), e não a soma dos dois (70 min).
    expect(listGames(db)[0].playtimeMinutes).toBe(40)
  })

  it("lê o código do disco uma vez e guarda no banco", () => {
    const db = memoryDatabase()
    const dir = makeTempDir()
    const iso = join(dir, "Jogo (USA).iso")
    writeFileSync(iso, buildIso([{ path: ["SYSTEM.CNF"], content: Buffer.from("BOOT2 = cdrom0:\\SLUS_201.00;1\r\n", "latin1") }]))
    const gameId = addEmulatedGame(db, {
      title: "Jogo",
      romPath: iso,
      platform: "PlayStation 2",
      library: "PCSX2",
      emulatorId: "pcsx2",
      core: null,
    }) as number

    syncEmulatorPlaytime(db, records({ seconds: 120, lastPlayedAt: null }))

    expect(db.prepare("SELECT serial FROM games WHERE id = ?").pluck().get(gameId)).toBe(SERIAL)
    expect(listGames(db)[0].playtimeMinutes).toBe(2)
  })

  it("jogo sem registro no emulador (ou com ROM que sumiu) fica como está", () => {
    const { db } = setup()
    expect(syncEmulatorPlaytime(db, { bySerial: { pcsx2: new Map() }, retroarch: () => null })).toBe(0)
    expect(listGames(db)[0]).toMatchObject({ playtimeMinutes: 0, lastPlayedAt: null })
  })
})
