import type Database from "better-sqlite3"
import {
  gradeForPoints,
  rarityOf,
  type AchievementGameRow,
  type AchievementProgress,
  type GameAchievement,
  type GameAchievements,
  type UnlockedAchievement,
} from "../../shared/achievements"
import { readSecret, saveSecret } from "../secrets"
import { getSetting, setSetting } from "../settings"
import type { RaAccount, RaCatalogGame, RaConsole, RaGameProgress } from "./client"
import { countGrades } from "./grades"

/** Onde cada coisa fica na tabela settings (a chave vai criptografada). */
const KEYS = {
  username: "raUsername",
  apiKey: "raApiKey",
  lastSyncAt: "raLastSyncAt",
  lastError: "raLastError",
  consoles: "raConsoles",
  catalogAt: (consoleId: number) => `raCatalogAt:${consoleId}`,
}

const DAY = 24 * 60 * 60 * 1000

/** Mostra a insígnia de uma conquista (o endereço vem de badges.ts, que sabe onde ficam as imagens). */
export type BadgeUrl = (badgeName: string | null, earned: boolean) => string | null

// ---------------------------------------------------------------- conta e situação

export function getRaAccount(db: Database.Database): RaAccount | null {
  const username = getSetting(db, KEYS.username)
  const apiKey = readSecret(db, KEYS.apiKey)
  return username && apiKey ? { username, apiKey } : null
}

/** Salva a conta (ou apaga, com null). Trocar de conta apaga o que era da conta anterior. */
export function saveRaAccount(db: Database.Database, account: RaAccount | null): void {
  const previous = getSetting(db, KEYS.username)
  if (previous !== (account?.username ?? null)) clearUserProgress(db)
  setSetting(db, KEYS.username, account?.username ?? null)
  saveSecret(db, KEYS.apiKey, account?.apiKey ?? null)
  setRaStatus(db, { lastSyncAt: null, lastError: null })
}

export function getRaUsername(db: Database.Database): string | null {
  return getSetting(db, KEYS.username)
}

export function getRaStatus(db: Database.Database): { lastSyncAt: string | null; lastError: string | null } {
  return { lastSyncAt: getSetting(db, KEYS.lastSyncAt), lastError: getSetting(db, KEYS.lastError) }
}

export function setRaStatus(db: Database.Database, status: { lastSyncAt?: string | null; lastError?: string | null }): void {
  if (status.lastSyncAt !== undefined) setSetting(db, KEYS.lastSyncAt, status.lastSyncAt)
  if (status.lastError !== undefined) setSetting(db, KEYS.lastError, status.lastError)
}

/** Esquece o que o usuário tinha desbloqueado (o catálogo e as ligações dos jogos continuam). */
function clearUserProgress(db: Database.Database): void {
  db.prepare("UPDATE achievements SET earned_at = NULL, earned_hardcore_at = NULL").run()
  db.prepare("DELETE FROM ra_games").run()
}

// ---------------------------------------------------------------- consoles e catálogo

/** Os consoles guardados, se forem de menos de 30 dias. */
export function loadConsoles(db: Database.Database, now: Date): RaConsole[] | null {
  try {
    const saved = JSON.parse(getSetting(db, KEYS.consoles) ?? "null") as { at: string; list: RaConsole[] } | null
    return saved && now.getTime() - Date.parse(saved.at) < 30 * DAY ? saved.list : null
  } catch {
    return null
  }
}

export function saveConsoles(db: Database.Database, consoles: RaConsole[], now: Date): void {
  setSetting(db, KEYS.consoles, JSON.stringify({ at: now.toISOString(), list: consoles }))
}

/** O catálogo de um console, se tiver sido buscado há menos de 7 dias (o RetroAchievements pede para guardar). */
export function loadCatalog(db: Database.Database, consoleId: number, now: Date): RaCatalogGame[] | null {
  const at = getSetting(db, KEYS.catalogAt(consoleId))
  if (!at || now.getTime() - Date.parse(at) >= 7 * DAY) return null
  return db
    .prepare("SELECT ra_game_id AS id, title, num_achievements AS numAchievements FROM ra_catalog WHERE console_id = ?")
    .all(consoleId) as RaCatalogGame[]
}

export function saveCatalog(db: Database.Database, consoleId: number, games: RaCatalogGame[], now: Date): void {
  const insert = db.prepare("INSERT OR REPLACE INTO ra_catalog (console_id, ra_game_id, title, num_achievements) VALUES (?, ?, ?, ?)")
  db.transaction(() => {
    db.prepare("DELETE FROM ra_catalog WHERE console_id = ?").run(consoleId)
    for (const game of games) insert.run(consoleId, game.id, game.title, game.numAchievements)
    setSetting(db, KEYS.catalogAt(consoleId), now.toISOString())
  })()
}

// ---------------------------------------------------------------- jogos da biblioteca

/**
 * Jogos que ainda precisam ser procurados no RetroAchievements: sem jogo achado e sem tentativa nos
 * últimos 7 dias (com `force`, todos os que não foram achados).
 */
export function gamesToMatch(db: Database.Database, now: Date, force: boolean): { id: number; title: string; platform: string }[] {
  const limit = new Date(now.getTime() - 7 * DAY).toISOString()
  return db
    .prepare(
      `SELECT id, title, platform FROM games
       WHERE platform IS NOT NULL AND ra_game_id IS NULL AND (? OR ra_matched_at IS NULL OR ra_matched_at < ?)`
    )
    .all(force ? 1 : 0, limit) as { id: number; title: string; platform: string }[]
}

export function setRaMatch(db: Database.Database, gameId: number, raGameId: number | null, now: Date): void {
  db.prepare("UPDATE games SET ra_game_id = ?, ra_matched_at = ? WHERE id = ?").run(raGameId, now.toISOString(), gameId)
}

/** Os jogos do RetroAchievements que estão na biblioteca, com a data da última atualização (ou null). */
export function matchedRaGames(db: Database.Database): { raGameId: number; syncedAt: string | null }[] {
  return db
    .prepare(
      `SELECT DISTINCT g.ra_game_id AS raGameId, rg.synced_at AS syncedAt
       FROM games g LEFT JOIN ra_games rg ON rg.id = g.ra_game_id
       WHERE g.ra_game_id IS NOT NULL`
    )
    .all() as { raGameId: number; syncedAt: string | null }[]
}

/**
 * Guarda o que veio do RetroAchievements para um jogo e devolve as conquistas desbloqueadas desde a
 * última vez (para o aviso). Na primeira vez de um jogo, nada conta como novo (seriam todas as antigas).
 */
export function saveGameProgress(db: Database.Database, progress: RaGameProgress, now: Date): number[] {
  const firstTime = db.prepare("SELECT 1 FROM ra_games WHERE id = ?").get(progress.id) === undefined
  const before = new Map(
    (
      db.prepare("SELECT id, earned_at FROM achievements WHERE ra_game_id = ?").all(progress.id) as {
        id: number
        earned_at: string | null
      }[]
    ).map((row) => [row.id, row.earned_at])
  )
  const upsert = db.prepare(
    `INSERT INTO achievements (id, ra_game_id, title, description, points, badge_name, display_order, num_awarded, earned_at, earned_hardcore_at)
     VALUES (@id, @raGameId, @title, @description, @points, @badgeName, @displayOrder, @numAwarded, @earnedAt, @earnedHardcoreAt)
     ON CONFLICT(id) DO UPDATE SET ra_game_id = excluded.ra_game_id, title = excluded.title, description = excluded.description,
       points = excluded.points, badge_name = excluded.badge_name, display_order = excluded.display_order,
       num_awarded = excluded.num_awarded, earned_at = excluded.earned_at, earned_hardcore_at = excluded.earned_hardcore_at`
  )
  const newlyEarned: number[] = []
  db.transaction(() => {
    db.prepare(
      `INSERT INTO ra_games (id, title, num_distinct_players, synced_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, num_distinct_players = excluded.num_distinct_players,
         synced_at = excluded.synced_at`
    ).run(progress.id, progress.title, progress.numDistinctPlayers, now.toISOString())
    // Conquistas que saíram do jogo no RetroAchievements saem daqui também.
    const ids = progress.achievements.map((item) => item.id)
    db.prepare(`DELETE FROM achievements WHERE ra_game_id = ? AND id NOT IN (${ids.map(() => "?").join(",") || "NULL"})`).run(
      progress.id,
      ...ids
    )
    for (const item of progress.achievements) {
      const earnedAt = item.earnedAt ?? item.earnedHardcoreAt
      upsert.run({ ...item, raGameId: progress.id, earnedAt, earnedHardcoreAt: item.earnedHardcoreAt })
      if (!firstTime && earnedAt && !before.get(item.id)) newlyEarned.push(item.id)
    }
  })()
  return newlyEarned
}

// ---------------------------------------------------------------- o que a interface mostra

/**
 * O progresso de cada jogo da biblioteca (id do jogo → desbloqueadas, total e platina). Só dos jogos
 * já atualizados com a conta atual: sem conta (ou logo depois de trocar), nada aparece.
 */
export function raProgressByGame(db: Database.Database): Map<number, AchievementProgress> {
  const rows = db
    .prepare(
      `SELECT g.id AS gameId, COUNT(a.id) AS total, COUNT(a.earned_at) AS unlocked
       FROM games g JOIN ra_games rg ON rg.id = g.ra_game_id JOIN achievements a ON a.ra_game_id = g.ra_game_id
       GROUP BY g.id`
    )
    .all() as { gameId: number; total: number; unlocked: number }[]
  return new Map(
    rows.map((row) => [
      row.gameId,
      {
        unlocked: row.unlocked,
        total: row.total,
        platinum: row.total > 0 && row.unlocked === row.total,
        source: "retroachievements" as const,
      },
    ])
  )
}

interface AchievementRow {
  id: number
  title: string
  description: string
  points: number
  badge_name: string | null
  num_awarded: number
  earned_at: string | null
  earned_hardcore_at: string | null
  num_distinct_players: number
}

function toAchievement(row: AchievementRow, badge: BadgeUrl): GameAchievement {
  const percent = row.num_distinct_players > 0 ? Math.min(100, (row.num_awarded / row.num_distinct_players) * 100) : 0
  return {
    key: `ra-${row.id}`,
    source: "retroachievements",
    id: row.id,
    title: row.title,
    description: row.description,
    points: row.points,
    badgeUrl: badge(row.badge_name, row.earned_at !== null),
    percent,
    rarity: rarityOf(percent),
    grade: gradeForPoints(row.points),
    hidden: false,
    group: null,
    earnedAt: row.earned_at,
    hardcore: row.earned_hardcore_at !== null,
  }
}

/** As conquistas de um jogo da biblioteca, ou null se ele não estiver no RetroAchievements. */
export function getRaGameAchievements(db: Database.Database, gameId: number, badge: BadgeUrl): GameAchievements | null {
  const game = db
    .prepare("SELECT g.ra_game_id AS raGameId, rg.title FROM games g JOIN ra_games rg ON rg.id = g.ra_game_id WHERE g.id = ?")
    .get(gameId) as { raGameId: number; title: string } | undefined
  if (!game) return null
  const rows = db
    .prepare(
      `SELECT a.*, rg.num_distinct_players FROM achievements a JOIN ra_games rg ON rg.id = a.ra_game_id
       WHERE a.ra_game_id = ? ORDER BY a.display_order, a.id`
    )
    .all(game.raGameId) as AchievementRow[]
  if (rows.length === 0) return null
  const achievements = rows.map((row) => toAchievement(row, badge))
  const earned = achievements.filter((item) => item.earnedAt)
  const pointsOf = (items: GameAchievement[]) => items.reduce((sum, item) => sum + (item.points ?? 0), 0)
  return {
    gameId,
    source: "retroachievements",
    sourceTitle: game.title,
    unlocked: earned.length,
    total: achievements.length,
    points: pointsOf(earned),
    totalPoints: pointsOf(achievements),
    platinum: earned.length === achievements.length,
    byGrade: countGrades(
      achievements.map((item) => ({ grade: item.grade, earned: item.earnedAt !== null })),
      true
    ),
    achievements,
  }
}

/** Os jogos com conquistas e as desbloqueadas, para a aba Conquistas (junto com os troféus do PS3). */
export function raOverviewParts(db: Database.Database, badge: BadgeUrl): { games: AchievementGameRow[]; unlocked: UnlockedAchievement[] } {
  // Um jogo do RetroAchievements pode estar duas vezes na biblioteca: vale o primeiro.
  const libraryGames = `(SELECT ra_game_id, MIN(id) AS game_id, title FROM games WHERE ra_game_id IS NOT NULL GROUP BY ra_game_id)`
  const rows = db
    .prepare(
      `SELECT a.*, rg.num_distinct_players, lg.game_id, lg.title AS game_title
       FROM achievements a JOIN ra_games rg ON rg.id = a.ra_game_id JOIN ${libraryGames} lg ON lg.ra_game_id = a.ra_game_id`
    )
    .all() as (AchievementRow & { game_id: number; game_title: string })[]

  const games = new Map<number, { row: AchievementGameRow; items: GameAchievement[] }>()
  const unlocked: UnlockedAchievement[] = []
  for (const row of rows) {
    const achievement = toAchievement(row, badge)
    let game = games.get(row.game_id)
    if (!game) {
      game = {
        row: {
          gameId: row.game_id,
          title: row.game_title,
          source: "retroachievements",
          unlocked: 0,
          total: 0,
          platinum: false,
          points: 0,
          lastUnlockedAt: null,
          byGrade: countGrades([], true),
        },
        items: [],
      }
      games.set(row.game_id, game)
    }
    game.row.total++
    game.items.push(achievement)
    if (achievement.earnedAt) {
      game.row.unlocked++
      game.row.points = (game.row.points ?? 0) + (achievement.points ?? 0)
      if (!game.row.lastUnlockedAt || achievement.earnedAt > game.row.lastUnlockedAt) game.row.lastUnlockedAt = achievement.earnedAt
      unlocked.push({ ...achievement, gameId: row.game_id, gameTitle: row.game_title })
    }
  }
  return {
    games: [...games.values()].map(({ row, items }) => ({
      ...row,
      platinum: row.total > 0 && row.unlocked === row.total,
      byGrade: countGrades(
        items.map((item) => ({ grade: item.grade, earned: item.earnedAt !== null })),
        true
      ),
    })),
    unlocked,
  }
}

/** As conquistas de uma lista de ids, com o jogo (para o aviso de conquista nova). */
export function unlockedByIds(db: Database.Database, ids: number[], badge: BadgeUrl): UnlockedAchievement[] {
  if (ids.length === 0) return []
  const rows = db
    .prepare(
      `SELECT a.*, rg.num_distinct_players, g.id AS game_id, g.title AS game_title
       FROM achievements a JOIN ra_games rg ON rg.id = a.ra_game_id
       JOIN (SELECT ra_game_id, MIN(id) AS id, title FROM games WHERE ra_game_id IS NOT NULL GROUP BY ra_game_id) g
         ON g.ra_game_id = a.ra_game_id
       WHERE a.id IN (${ids.map(() => "?").join(",")})
       ORDER BY a.earned_at`
    )
    .all(...ids) as (AchievementRow & { game_id: number; game_title: string })[]
  return rows.map((row) => ({ ...toAchievement(row, badge), gameId: row.game_id, gameTitle: row.game_title }))
}
