import type Database from "better-sqlite3"
import type {
  AchievementProgress,
  AchievementsOverview,
  GameAchievements,
  UnlockedAchievement,
} from "../../shared/achievements"
import { getRaGameAchievements, raOverviewParts, raProgressByGame, type BadgeUrl } from "./store"
import { getGameTrophies, trophyOverviewParts, trophyProgressByGame, type TrophyIconUrl } from "./trophyStore"

/**
 * O que as telas mostram, juntando as conquistas do RetroAchievements e os troféus do PS3 (escolha
 * do usuário em 2026-09-24: tudo junto na aba Conquistas). Cada jogo tem uma fonte só.
 */

/** Onde ficam as imagens: as insígnias do RetroAchievements e as imagens dos troféus. */
export interface AchievementImages {
  badge: BadgeUrl
  trophyIcon: TrophyIconUrl
}

/** Quantas conquistas recentes a aba mostra. */
const RECENT_LIMIT = 12

/** O progresso de cada jogo da biblioteca, venha do RetroAchievements ou do RPCS3. */
export function progressByGame(db: Database.Database): Map<number, AchievementProgress> {
  const progress = trophyProgressByGame(db)
  for (const [gameId, value] of raProgressByGame(db)) progress.set(gameId, value)
  return progress
}

/** As conquistas (ou os troféus) de um jogo, ou null se ele não tiver. */
export function getGameAchievements(db: Database.Database, gameId: number, images: AchievementImages): GameAchievements | null {
  return getRaGameAchievements(db, gameId, images.badge) ?? getGameTrophies(db, gameId, images.trophyIcon)
}

/** Tudo o que a aba Conquistas mostra. */
export function getOverview(db: Database.Database, images: AchievementImages, now = new Date()): AchievementsOverview {
  const parts = [raOverviewParts(db, images.badge), trophyOverviewParts(db, images.trophyIcon)]
  const games = parts.flatMap((part) => part.games)
  const unlocked = parts.flatMap((part) => part.unlocked)
  // Os com desbloqueio mais recente primeiro; os que nunca tiveram nenhum por último, pelo nome.
  games.sort(
    (a, b) =>
      (b.lastUnlockedAt ?? "").localeCompare(a.lastUnlockedAt ?? "") ||
      a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" })
  )
  unlocked.sort((a, b) => (b.earnedAt ?? "").localeCompare(a.earnedAt ?? ""))

  return {
    unlocked: unlocked.length,
    total: games.reduce((sum, game) => sum + game.total, 0),
    points: games.reduce((sum, game) => sum + (game.points ?? 0), 0),
    platinums: games.filter((game) => game.platinum).length,
    games,
    recent: unlocked.slice(0, RECENT_LIMIT),
    byDay: countByDay(unlocked, now),
    byMonth: countByMonth(unlocked, now),
  }
}

/** Data local AAAA-MM-DD. */
function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Desbloqueadas por dia nos últimos 30 dias (hoje incluído), do mais antigo para o mais novo. */
function countByDay(unlocked: UnlockedAchievement[], now: Date): { date: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const item of unlocked) {
    const date = localDate(new Date(item.earnedAt as string))
    counts.set(date, (counts.get(date) ?? 0) + 1)
  }
  return Array.from({ length: 30 }, (_, index) => {
    const date = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29 + index))
    return { date, count: counts.get(date) ?? 0 }
  })
}

/** Desbloqueadas por mês nos últimos 12 meses (o atual incluído). */
function countByMonth(unlocked: UnlockedAchievement[], now: Date): { month: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const item of unlocked) {
    const month = localDate(new Date(item.earnedAt as string)).slice(0, 7)
    counts.set(month, (counts.get(month) ?? 0) + 1)
  }
  return Array.from({ length: 12 }, (_, index) => {
    const month = localDate(new Date(now.getFullYear(), now.getMonth() - 11 + index, 1)).slice(0, 7)
    return { month, count: counts.get(month) ?? 0 }
  })
}
