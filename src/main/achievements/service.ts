import type Database from "better-sqlite3"
import type { AchievementsConfig, UnlockedAchievement } from "../../shared/achievements"
import type { Fetch } from "../metadata/http"
import { badgeUrl } from "./badges"
import { createRaClient, type RaEndpoints } from "./client"
import { getRaAccount, getRaStatus, getRaUsername, setRaStatus, unlockedByIds } from "./store"
import { syncAchievements } from "./sync"

/** De quanto em quanto tempo o app procura conquistas novas com ele aberto (escolha do usuário em 2026-09-24). */
const INTERVAL_MS = 5 * 60 * 1000
/** Espera depois de abrir o app e depois de fechar um jogo (o RetroAchievements registra na hora). */
const START_DELAY_MS = 15_000
const AFTER_GAME_DELAY_MS = 20_000
/** Os troféus do RPCS3 são arquivos do computador: dá para ler a cada minuto sem pesar. */
const TROPHY_INTERVAL_MS = 60_000
const TROPHY_DELAY_MS = 3000

export interface AchievementsServiceOptions {
  getDatabase: () => Database.Database
  fetch: Fetch
  endpoints: RaEndpoints
  imagesDir: () => string
  /** Lê os troféus do RPCS3: se algo mudou e os troféus pegos desde a última leitura. */
  readTrophies: () => { changed: boolean; unlocked: UnlockedAchievement[] }
  /** A biblioteca mudou (o progresso dos jogos). */
  onLibraryChanged: () => void
  /** A situação mudou (começou ou terminou de atualizar). */
  onStatus: (config: AchievementsConfig) => void
  /** Conquistas (ou troféus) novas, para o aviso na tela. */
  onUnlocked: (achievements: UnlockedAchievement[]) => void
}

export interface AchievementsService {
  config(): AchievementsConfig
  /** Atualiza agora (com `full`, todos os jogos do RetroAchievements). Se já estiver atualizando, faz de novo no fim. */
  sync(full?: boolean): Promise<void>
  /** Lê os troféus do RPCS3 agora (ex.: depois de achar jogos novos numa pasta de ROMs). */
  readTrophies(): void
  /** Começa a atualizar sozinho: logo depois de abrir, a cada 5 minutos (e a cada minuto, os troféus). */
  start(): void
  /** Um jogo fechou: atualiza daqui a pouco. */
  afterGameClosed(): void
}

export function createAchievementsService(options: AchievementsServiceOptions): AchievementsService {
  let running: Promise<void> | null = null
  let again: { full: boolean } | null = null

  function config(): AchievementsConfig {
    const db = options.getDatabase()
    return { username: getRaUsername(db), syncing: running !== null, ...getRaStatus(db) }
  }

  function readTrophies(): void {
    try {
      const { changed, unlocked } = options.readTrophies()
      if (changed) options.onLibraryChanged()
      if (unlocked.length > 0) options.onUnlocked(unlocked)
    } catch (error) {
      console.error("[troféus] não deu para ler os troféus do RPCS3:", error)
    }
  }

  async function run(full: boolean): Promise<void> {
    const db = options.getDatabase()
    const account = getRaAccount(db)
    if (!account) return
    options.onStatus(config())
    const now = new Date()
    const { lastSyncAt } = getRaStatus(db)
    try {
      const imagesDir = options.imagesDir()
      const client = createRaClient(options.fetch, options.endpoints, account)
      const result = await syncAchievements(
        db,
        { client, fetch: options.fetch, endpoints: options.endpoints, imagesDir },
        { full, since: lastSyncAt, now }
      )
      setRaStatus(db, { lastSyncAt: now.toISOString(), lastError: null })
      if (result.updatedGames > 0) options.onLibraryChanged()
      const unlocked = unlockedByIds(db, result.newlyEarned, (name, earned) => badgeUrl(imagesDir, name, earned))
      if (unlocked.length > 0) options.onUnlocked(unlocked)
    } catch (error) {
      setRaStatus(db, { lastError: error instanceof Error ? error.message : String(error) })
      console.error("[conquistas] não deu para atualizar:", error)
    }
  }

  function sync(full = false): Promise<void> {
    if (running) {
      again = { full: full || (again?.full ?? false) }
      return running
    }
    running = run(full).finally(() => {
      running = null
      options.onStatus(config())
      if (again) {
        const next = again
        again = null
        void sync(next.full)
      }
    })
    return running
  }

  return {
    config,
    // O botão "Atualizar" também relê os troféus do RPCS3.
    sync(full = false) {
      readTrophies()
      return sync(full)
    },
    readTrophies,
    start() {
      setTimeout(() => void sync(), START_DELAY_MS).unref()
      setInterval(() => void sync(), INTERVAL_MS).unref()
      setTimeout(readTrophies, TROPHY_DELAY_MS).unref()
      setInterval(readTrophies, TROPHY_INTERVAL_MS).unref()
    },
    afterGameClosed() {
      setTimeout(readTrophies, TROPHY_DELAY_MS).unref()
      setTimeout(() => void sync(), AFTER_GAME_DELAY_MS).unref()
    },
  }
}
