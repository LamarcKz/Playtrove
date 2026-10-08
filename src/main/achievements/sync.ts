import type Database from "better-sqlite3"
import type { Fetch } from "../metadata/http"
import { downloadBadges } from "./badges"
import type { RaClient, RaEndpoints } from "./client"
import { consoleIdFor, matchRaGame } from "./matching"
import { gamesToMatch, loadCatalog, loadConsoles, matchedRaGames, saveCatalog, saveConsoles, saveGameProgress, setRaMatch } from "./store"

export interface SyncServices {
  client: RaClient
  fetch: Fetch
  endpoints: RaEndpoints
  imagesDir: string
}

export interface SyncOptions {
  /** Atualiza todos os jogos (primeira vez, conta nova ou o botão "Atualizar"). */
  full: boolean
  /** Desde quando procurar conquistas novas (a última atualização que deu certo). */
  since: string | null
  now?: Date
}

export interface SyncResult {
  /** Jogos atualizados (a biblioteca precisa recarregar se houver algum). */
  updatedGames: number
  /** Conquistas desbloqueadas desde a última vez (para o aviso). */
  newlyEarned: number[]
}

const HOUR = 60 * 60 * 1000
/** Jogos com dados de mais de um dia que são atualizados a cada rodada (a raridade muda devagar). */
const STALE_PER_RUN = 2

/**
 * Atualiza as conquistas: acha no RetroAchievements os jogos da biblioteca que ainda não foram
 * achados, busca o progresso dos que mudaram (ou de todos, com `full`) e baixa as insígnias.
 */
export async function syncAchievements(
  db: Database.Database,
  services: SyncServices,
  { full, since, now = new Date() }: SyncOptions
): Promise<SyncResult> {
  await matchGames(db, services.client, full, now)

  const matched = matchedRaGames(db)
  const toUpdate = new Set<number>()
  if (full || !since) {
    for (const game of matched) toUpdate.add(game.raGameId)
  } else {
    // Os jogos das conquistas desbloqueadas desde a última vez (com uma folga de 10 minutos).
    const minutes = (now.getTime() - Date.parse(since)) / 60_000 + 10
    const recent = new Set(await services.client.recentGameIds(Math.min(minutes, 7 * 24 * 60)))
    for (const game of matched) {
      if (recent.has(game.raGameId) || !game.syncedAt) toUpdate.add(game.raGameId)
    }
    // E alguns dos mais antigos, para a raridade não ficar velha.
    matched
      .filter((game) => game.syncedAt && now.getTime() - Date.parse(game.syncedAt) > 24 * HOUR)
      .sort((a, b) => (a.syncedAt as string).localeCompare(b.syncedAt as string))
      .slice(0, STALE_PER_RUN)
      .forEach((game) => toUpdate.add(game.raGameId))
  }

  const newlyEarned: number[] = []
  const badges: { badgeName: string | null; earned: boolean }[] = []
  for (const raGameId of toUpdate) {
    const progress = await services.client.gameProgress(raGameId)
    newlyEarned.push(...saveGameProgress(db, { ...progress, id: raGameId }, now))
    for (const item of progress.achievements) badges.push({ badgeName: item.badgeName, earned: Boolean(item.earnedAt ?? item.earnedHardcoreAt) })
  }
  await downloadBadges(services.fetch, services.endpoints, services.imagesDir, badges)
  return { updatedGames: toUpdate.size, newlyEarned }
}

/** Procura no RetroAchievements os jogos da biblioteca que ainda não foram achados. */
async function matchGames(db: Database.Database, client: RaClient, force: boolean, now: Date): Promise<void> {
  const games = gamesToMatch(db, now, force)
  if (games.length === 0) return

  let consoles = loadConsoles(db, now)
  if (!consoles) {
    consoles = await client.consoles()
    saveConsoles(db, consoles, now)
  }
  const byConsole = new Map<number, typeof games>()
  for (const game of games) {
    const consoleId = consoleIdFor(game.platform, consoles)
    // Console sem conquistas no RetroAchievements (ex.: PS3): marca a tentativa e segue.
    if (consoleId === null) setRaMatch(db, game.id, null, now)
    else byConsole.set(consoleId, [...(byConsole.get(consoleId) ?? []), game])
  }
  for (const [consoleId, list] of byConsole) {
    let catalog = loadCatalog(db, consoleId, now)
    if (!catalog) {
      catalog = await client.catalog(consoleId)
      saveCatalog(db, consoleId, catalog, now)
    }
    for (const game of list) setRaMatch(db, game.id, matchRaGame(game.title, catalog)?.id ?? null, now)
  }
}
