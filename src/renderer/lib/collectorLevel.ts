import type { Rarity, TrophyGrade } from "@shared/achievements"

/**
 * Pontuação e níveis da tela cheia, recriados a partir da regra do PlayniteAchievements que o Aniki mostra:
 * o "colecionador" soma pontos pela raridade de cada desbloqueada; os "pontos de troféu", pelo tipo, como na
 * PlayStation. Cada nível é uma faixa de pontos que cresce a cada nível.
 */
export const COLLECTOR_VALUES: Record<Rarity, number> = { comum: 15, rara: 30, "muito-rara": 90, ultrarrara: 180 }
export const TROPHY_VALUES: Record<TrophyGrade, number> = { platina: 300, ouro: 90, prata: 30, bronze: 15 }

export interface LevelCurve {
  /** Pontos do primeiro nível. */
  initial: number
  /** Quanto cada nível pede a mais que o anterior. */
  growth: number
  /** A partir deste nível, o crescimento é multiplicado por `easeMultiplier`. */
  easeStart: number
  easeMultiplier: number
  /** Último nível mostrado; depois dele, a contagem recomeça somando os níveis já feitos (maestria). */
  maxLevel: number | null
}
/** Colecionador: 100 pontos no nível 0, +40 por nível, +20 a partir do 98 e ciclos de 250 níveis. */
export const COLLECTOR_CURVE: LevelCurve = { initial: 100, growth: 40, easeStart: 98, easeMultiplier: .5, maxLevel: 250 }
/** Pontos de troféu: 100 pontos no nível 1 e +100 por nível, sem limite. */
export const TROPHY_CURVE: LevelCurve = { initial: 100, growth: 100, easeStart: Infinity, easeMultiplier: 1, maxLevel: null }

export type RankTier = "bronze" | "silver" | "gold" | "platinum" | "master"
export interface AchievementLevel {
  level: number
  /** % do nível atual (0 a 100). */
  progress: number
  pointsToNext: number
  /** Só no colecionador: a patente (de 10 em 10 níveis, do 5 ao 1 dentro de cada uma). */
  rank: { tier: RankTier; step: number } | null
}

export function collectorScore(byRarity: Record<Rarity, number>): number {
  return (Object.keys(COLLECTOR_VALUES) as Rarity[]).reduce((sum, rarity) => sum + byRarity[rarity] * COLLECTOR_VALUES[rarity], 0)
}

export function trophyScore(byGrade: Record<TrophyGrade, number>): number {
  return (Object.keys(TROPHY_VALUES) as TrophyGrade[]).reduce((sum, grade) => sum + byGrade[grade] * TROPHY_VALUES[grade], 0)
}

interface Range { level: number; start: number; end: number; size: number }

function nextRange(range: Range, curve: LevelCurve): Range {
  const growth = range.level < curve.easeStart ? curve.growth : Math.max(1, Math.round(curve.growth * curve.easeMultiplier))
  const size = range.size + growth
  return { level: range.level + 1, start: range.end + 1, end: range.end + size, size }
}

function rangeFor(score: number, curve: LevelCurve): Range {
  let range: Range = { level: 0, start: 1, end: curve.initial, size: curve.initial }
  while (score > range.end && (curve.maxLevel === null || range.level < curve.maxLevel)) range = nextRange(range, curve)
  return range
}

const tiers: RankTier[] = ["bronze", "silver", "gold", "platinum", "master"]

export function achievementLevel(score: number, curve: LevelCurve): AchievementLevel {
  const safe = Math.max(0, Math.floor(score))
  let mastery = 0
  let pass = safe
  if (curve.maxLevel !== null) {
    let range: Range = { level: 0, start: 1, end: curve.initial, size: curve.initial }
    while (range.level < curve.maxLevel) range = nextRange(range, curve)
    const cycle = Math.max(1, range.start - 1)
    mastery = safe <= 0 ? 0 : Math.floor((safe - 1) / cycle)
    pass = safe - mastery * cycle
  }
  const range = rangeFor(pass, curve)
  const progress = Math.max(0, Math.min(100, Math.floor(((pass - range.start) / range.size) * 100)))
  if (curve.maxLevel === null) return { level: range.level + 1, progress, pointsToNext: range.end - pass + 1, rank: null }
  const passLevel = Math.min(curve.maxLevel, range.level)
  const tier = tiers[Math.min(tiers.length - 1, Math.floor(passLevel / 50))]
  return { level: passLevel + mastery * curve.maxLevel, progress, pointsToNext: range.end - pass + 1, rank: { tier, step: 5 - Math.floor((passLevel % 50) / 10) } }
}
