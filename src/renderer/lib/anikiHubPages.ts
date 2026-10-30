import type { GameAchievements, UnlockedAchievement } from "@shared/achievements"
import { ANIKI_GAME_FAMILIES, type HubGameActivity } from "@shared/anikiHub"
import type { Game } from "@shared/types"

export type AnikiHubPage = "profile" | "activity" | "recommendations" | "memories"
type RecommendationReason = "genre" | "developer" | "publisher" | null
export interface AnikiHubRecommendation { game: Game; reference: Game; score: number; reason: RecommendationReason }

export function anikiHubPages(recommendations: number, memories: number): AnikiHubPage[] {
  return ["profile", "activity", ...(recommendations ? ["recommendations" as const] : []), ...(memories ? ["memories" as const] : [])]
}

const DAY = 86400000
const timestamp = (value: string | null) => value ? Date.parse(value) : -Infinity
const byTitle = (a: Game, b: Game) => a.title.localeCompare(b.title)
const shared = (a: string[], b: string[]) => new Set(a.filter((name) => name.trim()).map((name) => name.toLowerCase()).filter((name) => b.some((other) => other.toLowerCase() === name))).size

/** Famílias e incompatibilidades portadas do Aniki Helper (MIT); tags ausentes contam como conjunto vazio. */
function family(game: Game): string {
  const text = game.genres.join(" | ").toLowerCase()
  return ANIKI_GAME_FAMILIES.find(([, terms]) => terms.some((term) => text.includes(term)))?.[0] ?? "generic"
}

function incompatible(a: string, b: string) {
  const conflicts: Record<string, string[]> = { anime_fight: ["shooter", "party"], souls: ["sport", "racing", "party"], jrpg: ["shooter", "sport"] }
  return conflicts[a]?.includes(b) || conflicts[b]?.includes(a) || false
}

interface RecommendationOptions { now?: Date; finishedStatusIds?: readonly number[]; stickyReferenceId?: number | null; activity?: readonly HubGameActivity[] }

/**
 * Aniki Helper (MIT): GetOrSelectRefGameForToday, BuildHubRecommendationCandidatesForReference
 * e BuildDiverseHubLibraryRecommendations: Top 3 em 14 dias, pesos e quatro cartões diversificados.
 * PlayCount vem das sessões reais. O Hub reavalia a referência na virada do dia local; tags inexistentes não ganham pontos.
 */
export function anikiHubRecommendations(games: readonly Game[], { now = new Date(), finishedStatusIds = [], stickyReferenceId, activity = [] }: RecommendationOptions = {}): { referenceId: number | null; items: AnikiHubRecommendation[] } {
  const counts = new Map(activity.map((item) => [item.gameId, item.playCount]))
  const seconds = new Map(activity.map((item) => [item.gameId, item.playtimeSeconds]))
  const playtime = (game: Game) => seconds.get(game.id) ?? game.playtimeMinutes * 60
  const recent = games.filter((game) => timestamp(game.lastPlayedAt) >= now.getTime() - 14 * DAY && (playtime(game) > 0 || (counts.get(game.id) ?? 0) > 0))
    .sort((a, b) => playtime(b) - playtime(a) || (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || timestamp(b.lastPlayedAt) - timestamp(a.lastPlayedAt)).slice(0, 3)
  const latest = (list: readonly Game[]) => [...list].sort((a, b) => timestamp(b.lastPlayedAt) - timestamp(a.lastPlayedAt))[0]
  const reference = games.find((game) => game.id === stickyReferenceId) ?? latest(recent) ?? latest(games.filter((game) => game.lastPlayedAt))
  if (!reference) return { referenceId: null, items: [] }
  const references = recent.some((game) => game.id === reference.id) ? recent : [...recent, reference]
  const referenceIds = new Set(references.map((game) => game.id))
  const used = new Set(referenceIds)
  const candidates = (seed: Game, excluded: ReadonlySet<number>): AnikiHubRecommendation[] => games.flatMap((game) => {
    if (game.id === seed.id || excluded.has(game.id) || finishedStatusIds.includes(game.statusId)) return []
    if (playtime(game) >= 30 * 60 && game.lastPlayedAt && now.getTime() - timestamp(game.lastPlayedAt) > 60 * DAY) return []
    if (incompatible(family(seed), family(game))) return []
    const genres = shared(seed.genres, game.genres)
    const developers = shared(seed.developers, game.developers)
    const publishers = shared(seed.publishers, game.publishers)
    const minutes = Math.floor(playtime(game) / 60)
    const score = genres * 15 + developers * 60 + publishers * 15 + (minutes === 0 ? 25 : minutes < 120 ? 15 : 0) + (game.romPath && game.emulatorId ? 10 : 0)
    return score > 0 ? [{ game, reference: seed, score, reason: developers ? "developer" as const : genres ? "genre" as const : publishers ? "publisher" as const : null }] : []
  }).sort((a, b) => b.score - a.score || byTitle(a.game, b.game))
  const fallback = candidates(reference, new Set()).slice(0, 4)
  if (!fallback.length) return { referenceId: reference.id, items: [] }
  const items: AnikiHubRecommendation[] = []
  const add = (item: AnikiHubRecommendation) => { if (!used.has(item.game.id)) { items.push(item); used.add(item.game.id) } }
  for (const seed of references.slice(0, 3)) {
    const best = candidates(seed, used)[0]
    if (best) add(best)
  }
  const combined = references.slice(0, 3).flatMap((seed) => candidates(seed, used)).sort((a, b) => b.score - a.score || byTitle(a.game, b.game))
  for (const item of [...combined, ...fallback]) {
    if (items.length === 4) break
    add(item)
  }
  return { referenceId: reference.id, items }
}

/** Library Overview do Helper: último, mais jogado mensal (reserva histórica) e duas escolhas sem repetição. */
export function anikiHubOverview(games: readonly Game[], activity: readonly HubGameActivity[], random = Math.random, previous?: { recentlyAdded: Game | null; neverPlayed: Game | null }) {
  const rows = new Map(activity.map((item) => [item.gameId, item]))
  const playtime = (game: Game) => rows.get(game.id)?.playtimeSeconds ?? game.playtimeMinutes * 60
  const lastPlayed = [...games].filter((game) => game.lastPlayedAt).sort((a, b) => timestamp(b.lastPlayedAt) - timestamp(a.lastPlayedAt))[0] ?? null
  const monthly = games.filter((game) => game.id !== lastPlayed?.id && (rows.get(game.id)?.monthMinutes ?? 0) > 0)
    .sort((a, b) => rows.get(b.id)!.monthMinutes - rows.get(a.id)!.monthMinutes || a.id - b.id)[0]
  const mostPlayed = monthly ?? games.filter((game) => game.id !== lastPlayed?.id && playtime(game) > 0)
    .sort((a, b) => playtime(b) - playtime(a) || timestamp(b.lastPlayedAt) - timestamp(a.lastPlayedAt) || byTitle(a, b))[0] ?? null
  const used = new Set([lastPlayed?.id, mostPlayed?.id])
  const pick = (pool: Game[]) => pool.length ? pool[Math.floor(random() * pool.length)] : null
  const isRecentlyAdded = (game: Game) => Number.isFinite(timestamp(game.addedAt))
  const isNeverPlayed = (game: Game) => playtime(game) === 0 && !game.lastPlayedAt && (rows.get(game.id)?.playCount ?? 0) === 0
  let recentlyAdded = games.find((game) => game.id === previous?.recentlyAdded?.id && !used.has(game.id) && isRecentlyAdded(game)) ?? null
  if (recentlyAdded) used.add(recentlyAdded.id)
  let neverPlayed = games.find((game) => game.id === previous?.neverPlayed?.id && !used.has(game.id) && isNeverPlayed(game)) ?? null
  if (neverPlayed) used.add(neverPlayed.id)
  // Conserva cada escolha ainda elegível e preenche só os espaços vazios, sem repetir os cartões reservados.
  if (!recentlyAdded) {
    recentlyAdded = pick(games.filter((game) => !used.has(game.id) && isRecentlyAdded(game))
      .sort((a, b) => timestamp(b.addedAt) - timestamp(a.addedAt)).slice(0, 3))
    if (recentlyAdded) used.add(recentlyAdded.id)
  }
  if (!neverPlayed) neverPlayed = pick(games.filter((game) => !used.has(game.id) && isNeverPlayed(game)))
  return { lastPlayed, mostPlayed, mostPlayedMonthly: Boolean(monthly), mostPlayedMinutes: monthly ? rows.get(monthly.id)!.monthMinutes : mostPlayed ? Math.floor(playtime(mostPlayed) / 60) : 0, recentlyAdded, neverPlayed }
}

/** Carrega as listas locais completas, com duas leituras simultâneas; não usa o recorte de recentes da visão geral. */
export async function loadAnikiAchievementHistory(games: readonly Game[], load: (gameId: number) => Promise<GameAchievements | null>, cancelled = () => false): Promise<UnlockedAchievement[]> {
  const pending = games.filter((game) => (game.achievements?.unlocked ?? 0) > 0)
  const items: UnlockedAchievement[] = []
  let index = 0
  const worker = async () => {
    while (!cancelled() && index < pending.length) {
      const game = pending[index++]
      try {
        const data = await load(game.id)
        if (!cancelled()) for (const item of data?.achievements ?? []) if (item.earnedAt) items.push({ ...item, gameId: game.id, gameTitle: game.title })
      } catch { /* Uma leitura local indisponível não descarta as outras memórias. */ }
    }
  }
  await Promise.all([worker(), worker()])
  return items
}

/** Helper (MIT), LoadHubAchievementMemoriesFromCache: mês com ≥4 desbloqueios e variedade antes do preenchimento; cache limitado a 5000. */
export function anikiAchievementMemories(games: readonly Game[], history: readonly UnlockedAchievement[], random = Math.random): { month: string | null; items: UnlockedAchievement[] } {
  const ids = new Set(games.map((game) => game.id))
  const unique = new Map<string, UnlockedAchievement>()
  for (const item of history) if (ids.has(item.gameId) && item.title.trim() && item.earnedAt && Number.isFinite(timestamp(item.earnedAt))) unique.set(`${item.gameId}:${item.key}`, item)
  const groups = new Map<string, UnlockedAchievement[]>()
  for (const item of [...unique.values()].sort((a, b) => timestamp(b.earnedAt) - timestamp(a.earnedAt)).slice(0, 5000)) {
    const date = new Date(item.earnedAt!)
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
    const group = groups.get(month) ?? []
    group.push(item)
    groups.set(month, group)
  }
  const eligible = [...groups].filter(([, items]) => items.length >= 4)
  if (!eligible.length) return { month: null, items: [] }
  const [month, pool] = eligible[Math.floor(random() * eligible.length)]
  const sorted = [...pool].sort((a, b) => (a.percent ?? Infinity) - (b.percent ?? Infinity) || timestamp(b.earnedAt) - timestamp(a.earnedAt))
  const byGame = new Map<number, UnlockedAchievement>()
  for (const item of sorted) if (!byGame.has(item.gameId)) byGame.set(item.gameId, item)
  const items = [...byGame.values()].slice(0, 4)
  for (const item of sorted) {
    if (items.length === 4) break
    if (!items.includes(item)) items.push(item)
  }
  return { month, items }
}
