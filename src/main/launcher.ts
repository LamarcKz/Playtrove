import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname } from "node:path"
import type Database from "better-sqlite3"
import { buildLaunchCommand, getEmulatorPaths, getPreset } from "./emulators"
import { t } from "./i18n"
import { getLaunchInfo, recordPlaySession } from "./library"

/** Função que abre um programa (o spawn do Node; os testes trocam por um de mentira). */
export type Starter = (command: string, args: string[], options: SpawnOptions) => ChildProcess

/** Jogos abertos agora: id do jogo → quando começou (em milissegundos). */
const sessions = new Map<number, number>()

/** Ids dos jogos abertos agora. */
export function getRunningGames(): number[] {
  return [...sessions.keys()]
}

/**
 * Abre um jogo no emulador dele e conta o tempo até o emulador fechar; aí registra a sessão
 * (tempo jogado, última vez jogado e a regra do primeiro jogo). `onChange` é chamado quando o jogo
 * abre e quando fecha, para avisar a interface.
 * Resolve quando o emulador abriu; rejeita com uma mensagem clara quando não dá.
 */
export function launchGame(
  db: Database.Database,
  gameId: number,
  onChange: () => void,
  start: Starter = spawn
): Promise<void> {
  const { errors } = t()
  if (sessions.has(gameId)) return Promise.reject(new Error(errors.alreadyRunning))
  const game = getLaunchInfo(db, gameId)
  if (!game.romPath || !game.emulatorId) {
    return Promise.reject(new Error(errors.notFromRomFolder))
  }
  const emulatorName = getPreset(game.emulatorId).name
  const emulatorPath = getEmulatorPaths(db)[game.emulatorId]
  if (!emulatorPath || !existsSync(emulatorPath)) {
    return Promise.reject(new Error(errors.emulatorNotFound(emulatorName)))
  }
  if (!existsSync(game.romPath)) return Promise.reject(new Error(errors.romNotFound(game.romPath)))

  const { command, args } = buildLaunchCommand(game.emulatorId, emulatorPath, game.romPath, game.core)
  return new Promise((resolve, reject) => {
    // detached + unref: o emulador não depende do app; se o app fechar, o jogo continua.
    const child = start(command, args, { cwd: dirname(command), detached: true, stdio: "ignore" })

    child.once("error", (error) => {
      if (!sessions.has(gameId)) reject(new Error(errors.launchFailed(emulatorName, error.message)))
    })
    child.once("spawn", () => {
      sessions.set(gameId, Date.now())
      onChange()
      resolve()
    })
    child.once("exit", () => {
      const startedAt = sessions.get(gameId)
      if (startedAt === undefined) return
      sessions.delete(gameId)
      recordPlaySession(db, gameId, (Date.now() - startedAt) / 1000, new Date().toISOString())
      onChange()
    })
    child.unref()
  })
}

/** Ao fechar o app com jogos abertos: registra o tempo jogado até agora (os emuladores continuam abertos). */
export function finishAllSessions(db: Database.Database): void {
  const now = Date.now()
  for (const [gameId, startedAt] of sessions) {
    recordPlaySession(db, gameId, (now - startedAt) / 1000, new Date(now).toISOString())
  }
  sessions.clear()
}
