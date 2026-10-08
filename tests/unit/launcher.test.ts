import type { ChildProcess, SpawnOptions } from "node:child_process"
import { EventEmitter } from "node:events"
import { join } from "node:path"
import type Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setEmulatorPath } from "../../src/main/emulators"
import { finishAllSessions, getRunningGames, launchGame, type Starter } from "../../src/main/launcher"
import {
  addEmulatedGame,
  getLaunchInfo,
  getStatusRules,
  listGames,
  listStatuses,
  MIN_SESSION_SECONDS,
  recordPlaySession,
  setGameStatus,
} from "../../src/main/library"
import { makeTempDir, memoryDatabase, removeTempDirs } from "./helpers"

const START = new Date("2026-09-19T20:00:00Z")
const MINUTE = 60 * 1000

/** Um "emulador" de mentira: guarda como foi chamado e deixa o teste dizer quando ele abre e fecha. */
function fakeStarter() {
  const calls: { command: string; args: string[]; options: SpawnOptions }[] = []
  const children: (EventEmitter & { unref: () => void })[] = []
  const start: Starter = (command, args, options) => {
    calls.push({ command, args, options })
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    children.push(child)
    return child as unknown as ChildProcess
  }
  return { start, calls, children }
}

const statusName = (db: Database.Database, id: number) => listStatuses(db).find((status) => status.id === id)?.name

let db: Database.Database

/** Um jogo de PS2 com o PCSX2 configurado (arquivos vazios numa pasta temporária). */
function setupGame() {
  const root = makeTempDir(["PCSX2/pcsx2-qt.exe", "Roms/Salto Estelar.iso"])
  const exe = join(root, "PCSX2", "pcsx2-qt.exe")
  const rom = join(root, "Roms", "Salto Estelar.iso")
  setEmulatorPath(db, "pcsx2", exe)
  addEmulatedGame(db, { title: "Salto Estelar", romPath: rom, platform: "PlayStation 2", library: "PCSX2", emulatorId: "pcsx2", core: null })
  return { exe, rom, gameId: listGames(db)[0].id }
}

beforeEach(() => {
  db = memoryDatabase()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(START)
})

afterEach(() => {
  finishAllSessions(db)
  vi.useRealTimers()
  removeTempDirs()
})

describe("sessões de jogo", () => {
  it("jogo novo entra com o status de jogo novo; a mesma ROM não entra duas vezes", () => {
    const { rom } = setupGame()
    expect(listGames(db)[0].statusId).toBe(getStatusRules(db).newGameStatusId)
    const again = addEmulatedGame(db, { title: "Outro", romPath: rom, platform: "PS2", library: "PCSX2", emulatorId: "pcsx2", core: null })
    expect(again).toBeNull()
    expect(listGames(db)).toHaveLength(1)
  })

  it("primeira vez: soma o tempo, guarda a data e passa para o status de primeiro jogo", () => {
    const { gameId } = setupGame()
    recordPlaySession(db, gameId, 30 * 60, "2026-09-19T20:30:00.000Z")
    const game = listGames(db)[0]
    expect(game).toMatchObject({ playtimeMinutes: 30, lastPlayedAt: "2026-09-19T20:30:00.000Z" })
    expect(statusName(db, game.statusId)).toBe("Jogando")

    // Depois disso o status não muda sozinho, mesmo que o usuário volte o jogo para "Planejo jogar".
    setGameStatus(db, gameId, getStatusRules(db).newGameStatusId)
    recordPlaySession(db, gameId, 15 * 60, "2026-09-20T10:00:00.000Z")
    expect(listGames(db)[0]).toMatchObject({ playtimeMinutes: 45, lastPlayedAt: "2026-09-20T10:00:00.000Z" })
    expect(statusName(db, listGames(db)[0].statusId)).toBe("Planejo jogar")
  })

  it("primeira vez com o status já trocado pelo usuário: o status fica", () => {
    const { gameId } = setupGame()
    const zerado = listStatuses(db).find((status) => status.name === "Zerado")!.id
    setGameStatus(db, gameId, zerado)
    recordPlaySession(db, gameId, 20 * 60, START.toISOString())
    expect(listGames(db)[0].statusId).toBe(zerado)
  })

  it(`sessão curta (menos de ${MIN_SESSION_SECONDS} s) não conta`, () => {
    const { gameId } = setupGame()
    recordPlaySession(db, gameId, MIN_SESSION_SECONDS - 1, START.toISOString())
    expect(listGames(db)[0]).toMatchObject({ playtimeMinutes: 0, lastPlayedAt: null })
    expect(listGames(db)[0].statusId).toBe(getStatusRules(db).newGameStatusId)
  })
})

describe("abrir um jogo", () => {
  it("abre o emulador com a ROM (sem forçar tela cheia) e conta o tempo até ele fechar", async () => {
    const { exe, rom, gameId } = setupGame()
    const { start, calls, children } = fakeStarter()
    const onChange = vi.fn()

    const opening = launchGame(db, gameId, onChange, start)
    expect(calls).toEqual([
      {
        command: exe,
        args: ["-batch", "--", rom],
        options: { cwd: join(exe, ".."), detached: true, stdio: "ignore" },
      },
    ])
    expect(children[0].unref).toHaveBeenCalled()
    children[0].emit("spawn")
    await opening
    expect(getRunningGames()).toEqual([gameId])
    expect(onChange).toHaveBeenCalledTimes(1)
    await expect(launchGame(db, gameId, onChange, start)).rejects.toThrow("Esse jogo já está aberto.")

    vi.setSystemTime(START.getTime() + 42 * MINUTE)
    children[0].emit("exit", 0)

    expect(getRunningGames()).toEqual([])
    expect(onChange).toHaveBeenCalledTimes(2)
    const game = listGames(db)[0]
    expect(game).toMatchObject({ playtimeMinutes: 42, lastPlayedAt: new Date(START.getTime() + 42 * MINUTE).toISOString() })
    expect(statusName(db, game.statusId)).toBe("Jogando")
  })

  it("fechar o app com o jogo aberto registra o tempo até ali (e o fim do emulador não conta de novo)", async () => {
    const { gameId } = setupGame()
    const { start, children } = fakeStarter()
    const opening = launchGame(db, gameId, () => undefined, start)
    children[0].emit("spawn")
    await opening

    vi.setSystemTime(START.getTime() + 20 * MINUTE)
    finishAllSessions(db)
    expect(getRunningGames()).toEqual([])
    expect(listGames(db)[0].playtimeMinutes).toBe(20)

    vi.setSystemTime(START.getTime() + 60 * MINUTE)
    children[0].emit("exit", 0)
    expect(listGames(db)[0].playtimeMinutes).toBe(20)
  })

  it("avisa quando o emulador não abre", async () => {
    const { gameId } = setupGame()
    const { start, children } = fakeStarter()
    const opening = launchGame(db, gameId, () => undefined, start)
    children[0].emit("error", new Error("spawn EACCES"))
    await expect(opening).rejects.toThrow("Não deu para abrir o PCSX2: spawn EACCES")
    expect(getRunningGames()).toEqual([])
  })

  it("mensagens claras quando falta algo", async () => {
    const { start } = fakeStarter()
    const { exe, rom, gameId } = setupGame()

    // Sem o emulador configurado.
    db.prepare("DELETE FROM emulators").run()
    await expect(launchGame(db, gameId, () => undefined, start)).rejects.toThrow(
      "O PCSX2 não foi encontrado. Configure ele na aba Emuladores."
    )

    // ROM apagada.
    setEmulatorPath(db, "pcsx2", exe)
    db.prepare("UPDATE games SET rom_path = ? WHERE id = ?").run(join(rom, "..", "sumiu.iso"), gameId)
    await expect(launchGame(db, gameId, () => undefined, start)).rejects.toThrow("A ROM não foi encontrada")

    // Jogo sem ROM (ex.: de outra biblioteca, no futuro).
    db.prepare("UPDATE games SET rom_path = NULL, emulator_id = NULL WHERE id = ?").run(gameId)
    await expect(launchGame(db, gameId, () => undefined, start)).rejects.toThrow("Esse jogo não tem ROM")

    expect(() => getLaunchInfo(db, 999)).toThrow("Jogo não encontrado.")
  })
})
