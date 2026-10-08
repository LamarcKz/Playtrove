import { formatScore } from "@shared/evaluation"
import type { Messages } from "@shared/i18n"

/** O que está sendo avaliado: a nota (estrelas) ou a dificuldade (pimentas). */
export type ScoreKind = "rating" | "difficulty"

/** Quanto do ícone `index` (0 a 4) fica pintado com a nota `score` (1 a 10). */
export function iconFill(score: number, index: number): "full" | "half" | "empty" {
  const points = score - index * 2
  if (points >= 2) return "full"
  return points === 1 ? "half" : "empty"
}

/** A nota por extenso, para leitores de tela e dicas: "4,5 de 5 estrelas" (ou "4.5 out of 5 stars"). */
export function describeScore(kind: ScoreKind, score: number, t: Messages): string {
  return t.rating.describe(kind, formatScore(score, t.locale))
}

/** A nota escolhida clicando num ícone: a metade esquerda dá meio ícone; a direita, o ícone inteiro. */
export function scoreFromClick(index: number, leftHalf: boolean): number {
  return index * 2 + (leftHalf ? 1 : 2)
}

/** A nota depois de uma tecla (setas mudam meio ícone; Home e End vão às pontas; Delete apaga). */
export function scoreFromKey(key: string, current: number | null): number | null | undefined {
  const value = current ?? 0
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return Math.min(10, value + 1)
    case "ArrowLeft":
    case "ArrowDown":
      return value <= 1 ? null : value - 1
    case "Home":
      return 1
    case "End":
      return 10
    case "Delete":
    case "Backspace":
      return null
    default:
      return undefined
  }
}
