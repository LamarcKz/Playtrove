/**
 * Avaliação de um jogo pelo usuário: a nota (estrelas), a dificuldade (pimentas) e a análise escrita
 * por ele. A nota e a dificuldade vão de 1 a 10, e cada ponto vale meio ícone: 1 = meia estrela,
 * 9 = quatro estrelas e meia, 10 = cinco estrelas (pedido do usuário em 2026-09-24).
 */

/** O valor mais alto da nota e da dificuldade (cinco ícones inteiros). */
const SCORE_MAX = 10

/** Tamanho máximo da análise, em caracteres. */
export const MAX_REVIEW_LENGTH = 10_000

/**
 * O que muda na avaliação: só as partes enviadas (a janela "Avaliar jogo" manda a nota e a
 * dificuldade; a "Minha análise" manda só o texto). null apaga a parte.
 */
export interface GameEvaluation {
  rating?: number | null
  difficulty?: number | null
  review?: string | null
}

/** É uma nota (ou dificuldade) válida: um número inteiro de 1 a 10? */
export function isScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= SCORE_MAX
}

/** A nota em estrelas, como aparece na tela, no formato do idioma: 9 → "4,5" (ou "4.5"); 10 → "5". */
export function formatScore(score: number, locale: string): string {
  return (score / 2).toLocaleString(locale, { maximumFractionDigits: 1 })
}
