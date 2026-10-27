import { TROPHY_GRADES, type GameAchievement, type TrophyGrade } from "@shared/achievements"

/** A cor de cada tipo de troféu (classes do Tailwind com as cores de globals.css), como no PS3. */
export const GRADE_TEXT: Record<TrophyGrade, string> = {
  platina: "text-platinum",
  ouro: "text-trophy-gold",
  prata: "text-trophy-silver",
  bronze: "text-trophy-bronze",
}

/** A porcentagem de jogadores, curta, no formato do idioma: "3%", "0,4%" (abaixo de 1%, com uma casa). */
export function formatPercent(percent: number, locale: string): string {
  const digits = percent > 0 && percent < 1 ? 1 : 0
  return `${percent.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`
}

/** Quanto do jogo já foi desbloqueado, em % inteira (23 de 94 → 24). */
export function progressPercent(unlocked: number, total: number): number {
  return total > 0 ? Math.floor((unlocked / total) * 100) : 0
}

export type AchievementSort = "default" | "name" | "date" | "rarity" | "grade"

/**
 * As ordenações do painel de troféus do Aniki: a do jogo, por nome, as desbloqueadas mais novas primeiro,
 * as mais raras primeiro (sem raridade no fim) e por tipo, da platina ao bronze.
 */
export function sortAchievements(items: GameAchievement[], sort: AchievementSort, locale: string): GameAchievement[] {
  const list = [...items]
  if (sort === "name") list.sort((a, b) => a.title.localeCompare(b.title, locale))
  if (sort === "date") list.sort((a, b) => (b.earnedAt ?? "").localeCompare(a.earnedAt ?? ""))
  if (sort === "rarity") list.sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101))
  if (sort === "grade") list.sort((a, b) => TROPHY_GRADES.indexOf(a.grade) - TROPHY_GRADES.indexOf(b.grade))
  return list
}
