import type { TrophyGrade } from "@shared/achievements"

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
