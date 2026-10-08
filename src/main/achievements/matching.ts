import { comparableName, searchTermFor } from "../metadata/matching"
import type { RaCatalogGame, RaConsole } from "./client"

/**
 * Qual console e qual jogo do RetroAchievements corresponde a um jogo da biblioteca. O console vem
 * do nome (o RetroAchievements usa "SNES/Super Famicom", "Genesis/Mega Drive"...), e o jogo, do
 * nome no catálogo do console, com a regra de os números da série terem que bater.
 */

/** Outros nomes de cada console, para achar o do RetroAchievements (tudo em minúsculas). */
const PLATFORM_ALIASES: Record<string, string[]> = {
  "super nintendo": ["snes", "super famicom"],
  snes: ["super famicom"],
  nes: ["famicom"],
  "mega drive": ["genesis"],
  genesis: ["mega drive"],
  psp: ["playstation portable"],
  ps1: ["playstation"],
  ps2: ["playstation 2"],
  gba: ["game boy advance"],
  nds: ["nintendo ds"],
}

/** O id do console no RetroAchievements para o console do jogo, ou null se lá não houver (ex.: PS3). */
export function consoleIdFor(platform: string | null, consoles: RaConsole[]): number | null {
  if (!platform) return null
  const wanted = comparableName(platform)
  const names = new Set([wanted, ...(PLATFORM_ALIASES[wanted] ?? [])])
  for (const console of consoles) {
    const parts = [console.name, ...console.name.split("/")].map(comparableName)
    if (parts.some((part) => names.has(part))) return console.id
  }
  return null
}

/** Numerais romanos que aparecem nos nomes de jogos (para comparar com os números). */
const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" }

/** As palavras de um nome, sem "the" (o RetroAchievements escreve "Legend of Zelda, The"). */
function wordsOf(title: string): string[] {
  return comparableName(title)
    .split(" ")
    .filter((word) => word && word !== "the")
}

/** Os números do nome ("Tekken 3", "Lenda Sombria VII" → "3", "7"), para não trocar um jogo pela sequência. */
function numbersOf(words: string[]): string {
  return words
    .map((word) => (/^\d+$/.test(word) ? String(Number(word)) : ROMAN[word]))
    .filter(Boolean)
    .sort()
    .join(",")
}

/**
 * Quanto um nome do catálogo parece com o do jogo: 3 = igual; 2 = um tem todas as palavras do outro
 * (ex.: com subtítulo) e os mesmos números; 0 = outro jogo.
 */
export function raMatchScore(title: string, candidate: string): number {
  const a = wordsOf(searchTermFor(title))
  const b = wordsOf(candidate)
  if (a.length === 0 || b.length === 0) return 0
  if (a.join(" ") === b.join(" ")) return 3
  if (numbersOf(a) !== numbersOf(b)) return 0
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  const set = new Set(longer)
  return shorter.every((word) => set.has(word)) ? 2 : 0
}

/**
 * O jogo do catálogo que corresponde ao da biblioteca, ou null. Ficam de fora os hacks, os jogos
 * caseiros e afins ("~Hack~ ...") e os "subsets" (conquistas extras de um jogo). Nomes com
 * alternativas ("A | B") valem por qualquer uma delas.
 */
export function matchRaGame(title: string, catalog: RaCatalogGame[]): RaCatalogGame | null {
  let best: RaCatalogGame | null = null
  let bestScore = 1
  for (const game of catalog) {
    if (game.numAchievements <= 0 || game.title.startsWith("~") || /\[subset/i.test(game.title)) continue
    const score = Math.max(...game.title.split("|").map((name) => raMatchScore(title, name)))
    if (score > bestScore) {
      best = game
      bestScore = score
    }
  }
  return best
}
