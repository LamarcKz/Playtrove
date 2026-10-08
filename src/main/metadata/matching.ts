/**
 * Texto de busca a partir do nome do jogo na biblioteca: sem o número do disco e sem o " - " que os
 * nomes de ROM usam no lugar dos dois-pontos.
 * Ex.: "Corrida Noturna - Edição Turbo" → "Corrida Noturna Edição Turbo".
 */
export function searchTermFor(title: string): string {
  return title
    .replace(/\s*\(disc \d+\)/gi, "")
    .replace(/\s+-\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Nome para comparar: sem acentos, em minúsculas e só com letras e números ("Pokémon: Fire" → "pokemon fire"). */
export function comparableName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Quanto um resultado da busca parece com o jogo procurado:
 * 3 = mesmo nome; 2 = um nome contém todas as palavras do outro (ex.: com subtítulo);
 * 1 = pelo menos metade das palavras em comum; 0 = outro jogo.
 */
export function matchScore(term: string, candidate: string): number {
  const a = comparableName(term)
  const b = comparableName(candidate)
  if (!a || !b) return 0
  if (a === b) return 3
  const wordsA = new Set(a.split(" "))
  const wordsB = new Set(b.split(" "))
  const common = [...wordsA].filter((word) => wordsB.has(word)).length
  if (common === wordsA.size || common === wordsB.size) return 2
  return common / wordsA.size >= 0.5 ? 1 : 0
}

/**
 * O resultado mais parecido com o jogo procurado. Empate fica com o que veio antes (os serviços
 * já devolvem os mais relevantes primeiro). Se nenhum parecer o mesmo jogo, devolve null.
 */
export function pickBestMatch<T extends { name: string }>(term: string, results: T[]): T | null {
  let best: T | null = null
  let bestScore = 0
  for (const result of results) {
    const score = matchScore(term, result.name)
    if (score > bestScore) {
      best = result
      bestScore = score
    }
  }
  return best
}
