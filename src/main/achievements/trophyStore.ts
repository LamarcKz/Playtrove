import type Database from "better-sqlite3"
import type {
  AchievementGameRow,
  AchievementProgress,
  GameAchievement,
  GameAchievements,
  TrophyGrade,
  UnlockedAchievement,
} from "../../shared/achievements"
import { countGrades } from "./grades"
import { raMatchScore } from "./matching"
import type { TrophySetDefinition, TrophyUnlocks } from "./trophyFiles"

/**
 * O banco dos troféus do PS3 (tabelas trophy_sets e trophies, e a coluna trophy_set dos jogos): o que
 * o RPCS3 tem guardado, qual conjunto é de qual jogo e o que as telas mostram.
 */

/** Mostra a imagem de um troféu (o endereço vem de trophyIcons.ts, que sabe onde ficam as imagens). */
export type TrophyIconUrl = (setId: string, trophyId: number) => string | null

/** Os jogos que abrem no RPCS3. */
const PS3_GAMES = "(emulator_id = 'rpcs3' OR platform = 'PlayStation 3')"

// ---------------------------------------------------------------- guardar o que o RPCS3 tem

/** A "assinatura" dos arquivos na última leitura de um conjunto, ou null se ele nunca foi lido. */
export function trophySetStamp(db: Database.Database, setId: string): string | null {
  return (db.prepare("SELECT file_stamp FROM trophy_sets WHERE id = ?").pluck().get(setId) as string | undefined) ?? null
}

/**
 * Guarda um conjunto de troféus e devolve os que foram pegos desde a última leitura (na primeira,
 * nenhum: seriam os antigos).
 */
export function saveTrophySet(
  db: Database.Database,
  setId: string,
  definition: TrophySetDefinition,
  unlocks: TrophyUnlocks,
  stamp: string,
  now: Date
): number[] {
  const firstTime = trophySetStamp(db, setId) === null
  const before = new Map(
    (db.prepare("SELECT id, unlocked_at FROM trophies WHERE set_id = ?").all(setId) as { id: number; unlocked_at: string | null }[]).map(
      (row) => [row.id, row.unlocked_at]
    )
  )
  const upsert = db.prepare(
    `INSERT INTO trophies (set_id, id, name, detail, grade, hidden, group_name, unlocked_at)
     VALUES (@setId, @id, @name, @detail, @grade, @hidden, @group, @unlockedAt)
     ON CONFLICT(set_id, id) DO UPDATE SET name = excluded.name, detail = excluded.detail, grade = excluded.grade,
       hidden = excluded.hidden, group_name = excluded.group_name, unlocked_at = excluded.unlocked_at`
  )
  const newlyUnlocked: number[] = []
  db.transaction(() => {
    db.prepare(
      `INSERT INTO trophy_sets (id, title, file_stamp, synced_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, file_stamp = excluded.file_stamp, synced_at = excluded.synced_at`
    ).run(setId, definition.title, stamp, now.toISOString())
    const ids = definition.trophies.map((trophy) => trophy.id)
    db.prepare(`DELETE FROM trophies WHERE set_id = ? AND id NOT IN (${ids.map(() => "?").join(",") || "NULL"})`).run(setId, ...ids)
    for (const trophy of definition.trophies) {
      const previous = before.get(trophy.id) ?? null
      // Sem uma data que faça sentido no arquivo, fica a da leitura anterior (ou a de agora).
      const unlockedAt = unlocks.has(trophy.id) ? (unlocks.get(trophy.id) ?? previous ?? now.toISOString()) : null
      upsert.run({
        setId,
        id: trophy.id,
        name: trophy.name,
        detail: trophy.detail,
        grade: trophy.grade,
        hidden: trophy.hidden ? 1 : 0,
        group: trophy.group,
        unlockedAt,
      })
      if (!firstTime && unlockedAt && !previous) newlyUnlocked.push(trophy.id)
    }
  })()
  return newlyUnlocked
}

/**
 * Liga os jogos de PS3 aos conjuntos de troféus: pelo disco (as pastas de PS3_GAME/TROPDIR, lidas
 * uma vez por jogo) ou, se não der, pelo nome do jogo no conjunto instalado. Devolve quantos jogos
 * foram ligados agora.
 */
export function linkTrophySets(db: Database.Database, readGameSets: (romPath: string) => string[], now: Date): number {
  const games = db
    .prepare(`SELECT id, title, rom_path, trophy_checked_at FROM games WHERE ${PS3_GAMES} AND trophy_set IS NULL`)
    .all() as { id: number; title: string; rom_path: string | null; trophy_checked_at: string | null }[]
  if (games.length === 0) return 0
  const installed = db.prepare("SELECT id, title FROM trophy_sets").all() as { id: string; title: string }[]
  const installedIds = new Set(installed.map((set) => set.id))
  const update = db.prepare("UPDATE games SET trophy_set = ?, trophy_checked_at = ? WHERE id = ?")
  let linked = 0
  for (const game of games) {
    let setId: string | null = null
    if (!game.trophy_checked_at) {
      // O código fica no disco mesmo antes de o RPCS3 instalar os troféus (na primeira vez que o jogo abre).
      const sets = game.rom_path ? readGameSets(game.rom_path) : []
      setId = sets.find((id) => installedIds.has(id)) ?? sets[0] ?? null
    }
    setId ??= matchByName(game.title, installed)
    if (setId === null && game.trophy_checked_at) continue
    update.run(setId, game.trophy_checked_at ?? now.toISOString(), game.id)
    if (setId) linked++
  }
  return linked
}

/** O conjunto instalado com o mesmo nome do jogo (os números da série têm que bater), ou null. */
function matchByName(title: string, sets: { id: string; title: string }[]): string | null {
  let best: string | null = null
  let bestScore = 1
  for (const set of sets) {
    const score = raMatchScore(title, set.title)
    if (score > bestScore) {
      best = set.id
      bestScore = score
    }
  }
  return best
}

// ---------------------------------------------------------------- o que as telas mostram

interface TrophyRow {
  set_id: string
  id: number
  name: string
  detail: string
  grade: TrophyGrade
  hidden: number
  group_name: string | null
  unlocked_at: string | null
}

function toAchievement(row: TrophyRow, icon: TrophyIconUrl): GameAchievement {
  return {
    key: `${row.set_id}-${row.id}`,
    source: "rpcs3",
    id: row.id,
    title: row.name,
    description: row.detail,
    points: null,
    badgeUrl: icon(row.set_id, row.id),
    percent: null,
    rarity: null,
    grade: row.grade,
    hidden: row.hidden === 1,
    group: row.group_name,
    earnedAt: row.unlocked_at,
    hardcore: false,
  }
}

/**
 * A platina do PS3: o troféu de platina pego. Jogo sem platina (os menores, da PSN) conta como
 * platinado com todos os troféus.
 */
function isPlatinum(trophies: { grade: TrophyGrade; earned: boolean }[]): boolean {
  const platinum = trophies.filter((trophy) => trophy.grade === "platina")
  return platinum.length > 0
    ? platinum.some((trophy) => trophy.earned)
    : trophies.length > 0 && trophies.every((trophy) => trophy.earned)
}

/** O progresso de cada jogo nos troféus (id do jogo → pegos, total e platina). */
export function trophyProgressByGame(db: Database.Database): Map<number, AchievementProgress> {
  const rows = db
    .prepare("SELECT g.id AS gameId, t.grade, t.unlocked_at FROM games g JOIN trophies t ON t.set_id = g.trophy_set")
    .all() as { gameId: number; grade: TrophyGrade; unlocked_at: string | null }[]
  const byGame = new Map<number, { grade: TrophyGrade; earned: boolean }[]>()
  for (const row of rows) byGame.set(row.gameId, [...(byGame.get(row.gameId) ?? []), { grade: row.grade, earned: row.unlocked_at !== null }])
  return new Map(
    [...byGame].map(([gameId, trophies]) => [
      gameId,
      {
        unlocked: trophies.filter((trophy) => trophy.earned).length,
        total: trophies.length,
        platinum: isPlatinum(trophies),
        source: "rpcs3" as const,
      },
    ])
  )
}

/** Os troféus de um jogo da biblioteca, ou null se ele não tiver (ou se o RPCS3 ainda não instalou). */
export function getGameTrophies(db: Database.Database, gameId: number, icon: TrophyIconUrl): GameAchievements | null {
  const game = db
    .prepare("SELECT s.id, s.title FROM games g JOIN trophy_sets s ON s.id = g.trophy_set WHERE g.id = ?")
    .get(gameId) as { id: string; title: string } | undefined
  if (!game) return null
  const rows = db.prepare("SELECT * FROM trophies WHERE set_id = ? ORDER BY id").all(game.id) as TrophyRow[]
  if (rows.length === 0) return null
  const achievements = rows.map((row) => toAchievement(row, icon))
  const trophies = achievements.map((trophy) => ({ grade: trophy.grade, earned: trophy.earnedAt !== null }))
  const earned = achievements.filter((trophy) => trophy.earnedAt)
  return {
    gameId,
    source: "rpcs3",
    sourceTitle: game.title,
    unlocked: earned.length,
    total: achievements.length,
    points: null,
    totalPoints: null,
    platinum: isPlatinum(trophies),
    byGrade: countGrades(trophies, false),
    achievements,
  }
}

/** Os jogos com troféus e os troféus pegos, para a aba Conquistas (junto com o RetroAchievements). */
export function trophyOverviewParts(
  db: Database.Database,
  icon: TrophyIconUrl
): { games: AchievementGameRow[]; unlocked: UnlockedAchievement[] } {
  // Um conjunto pode estar em dois jogos da biblioteca: vale o primeiro.
  const libraryGames = "(SELECT trophy_set, MIN(id) AS game_id, title FROM games WHERE trophy_set IS NOT NULL GROUP BY trophy_set)"
  const rows = db
    .prepare(
      `SELECT t.*, lg.game_id, lg.title AS game_title FROM trophies t JOIN ${libraryGames} lg ON lg.trophy_set = t.set_id
       ORDER BY t.set_id, t.id`
    )
    .all() as (TrophyRow & { game_id: number; game_title: string })[]

  const games = new Map<number, { row: AchievementGameRow; trophies: { grade: TrophyGrade; earned: boolean }[] }>()
  const unlocked: UnlockedAchievement[] = []
  for (const row of rows) {
    const trophy = toAchievement(row, icon)
    let game = games.get(row.game_id)
    if (!game) {
      game = {
        row: {
          gameId: row.game_id,
          title: row.game_title,
          source: "rpcs3",
          unlocked: 0,
          total: 0,
          platinum: false,
          points: null,
          lastUnlockedAt: null,
          byGrade: countGrades([], false),
        },
        trophies: [],
      }
      games.set(row.game_id, game)
    }
    game.row.total++
    game.trophies.push({ grade: row.grade, earned: trophy.earnedAt !== null })
    if (trophy.earnedAt) {
      game.row.unlocked++
      if (!game.row.lastUnlockedAt || trophy.earnedAt > game.row.lastUnlockedAt) game.row.lastUnlockedAt = trophy.earnedAt
      unlocked.push({ ...trophy, gameId: row.game_id, gameTitle: row.game_title })
    }
  }
  return {
    games: [...games.values()].map(({ row, trophies }) => ({
      ...row,
      platinum: isPlatinum(trophies),
      byGrade: countGrades(trophies, false),
    })),
    unlocked,
  }
}

/** Troféus recém-pegos, com o jogo da biblioteca (para o aviso). Os de jogos fora dela ficam de fora. */
export function unlockedTrophies(
  db: Database.Database,
  items: { setId: string; id: number }[],
  icon: TrophyIconUrl
): UnlockedAchievement[] {
  const query = db.prepare(
    `SELECT t.*, g.id AS game_id, g.title AS game_title FROM trophies t
     JOIN (SELECT trophy_set, MIN(id) AS id, title FROM games WHERE trophy_set IS NOT NULL GROUP BY trophy_set) g
       ON g.trophy_set = t.set_id
     WHERE t.set_id = ? AND t.id = ?`
  )
  return items
    .map((item) => query.get(item.setId, item.id) as (TrophyRow & { game_id: number; game_title: string }) | undefined)
    .filter((row) => row !== undefined)
    .map((row) => ({ ...toAchievement(row, icon), gameId: row.game_id, gameTitle: row.game_title }))
}
