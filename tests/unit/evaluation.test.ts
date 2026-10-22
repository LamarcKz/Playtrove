import { describe, expect, it } from "vitest"
import { formatScore } from "@shared/evaluation"
import { messagesFor } from "@shared/i18n"
import { describeScore, iconFill, scoreFromClick, scoreFromKey } from "@/lib/score"
import { EMPTY_FILTERS, filterGames, matchesScore } from "@/lib/filters"
import { makeGame } from "./helpers"

describe("nota e dificuldade: de 1 a 10, em meios ícones", () => {
  it("mostra em estrelas, com vírgula (e com ponto, em inglês)", () => {
    const pt = messagesFor("pt-BR")
    const en = messagesFor("en")
    expect(formatScore(9, pt.locale)).toBe("4,5")
    expect(formatScore(10, pt.locale)).toBe("5")
    expect(formatScore(1, pt.locale)).toBe("0,5")
    expect(formatScore(9, en.locale)).toBe("4.5")
    expect(describeScore("rating", 7, pt)).toBe("3,5 de 5 estrelas")
    expect(describeScore("difficulty", 4, pt)).toBe("2 de 5 pimentas")
    expect(describeScore("rating", 7, en)).toBe("3.5 out of 5 stars")
    expect(describeScore("difficulty", 1, en)).toBe("0.5 out of 5 peppers")
  })

  it("pinta cada ícone cheio, pela metade ou vazio", () => {
    expect([0, 1, 2, 3, 4].map((index) => iconFill(9, index))).toEqual(["full", "full", "full", "full", "half"])
    expect([0, 1, 2, 3, 4].map((index) => iconFill(3, index))).toEqual(["full", "half", "empty", "empty", "empty"])
  })

  it("clique: a metade esquerda dá meio ícone; a direita, o ícone inteiro", () => {
    expect(scoreFromClick(0, true)).toBe(1)
    expect(scoreFromClick(4, true)).toBe(9)
    expect(scoreFromClick(4, false)).toBe(10)
  })

  it("teclado: as setas andam de meio em meio, Home e End vão às pontas e Delete apaga", () => {
    expect(scoreFromKey("ArrowRight", null)).toBe(1)
    expect(scoreFromKey("ArrowRight", 10)).toBe(10)
    expect(scoreFromKey("ArrowLeft", 5)).toBe(4)
    expect(scoreFromKey("ArrowLeft", 1)).toBeNull()
    expect(scoreFromKey("Home", 7)).toBe(1)
    expect(scoreFromKey("End", 2)).toBe(10)
    expect(scoreFromKey("Delete", 6)).toBeNull()
    expect(scoreFromKey("a", 6)).toBeUndefined()
  })
})

describe("filtros de nota e dificuldade", () => {
  it("faixas de ícone inteiro em ícone inteiro, com a meia estrela na faixa de baixo", () => {
    expect(matchesScore(10, "5")).toBe(true)
    expect(matchesScore(9, "5")).toBe(false)
    expect(matchesScore(9, "4")).toBe(true)
    expect(matchesScore(8, "4")).toBe(true)
    expect(matchesScore(1, "half")).toBe(true)
    expect(matchesScore(null, "none")).toBe(true)
    expect(matchesScore(null, "1")).toBe(false)
  })

  it("nomes das faixas", () => {
    const { scoreRange } = messagesFor("pt-BR").filters
    expect(scoreRange("rating", "5")).toBe("5 estrelas")
    expect(scoreRange("rating", "4")).toBe("4 a 4,5 estrelas")
    expect(scoreRange("rating", "1")).toBe("1 a 1,5 estrela")
    expect(scoreRange("rating", "half")).toBe("Meia estrela")
    expect(scoreRange("rating", "none")).toBe("Sem nota")
    expect(scoreRange("difficulty", "3")).toBe("3 a 3,5 pimentas")
    expect(scoreRange("difficulty", "none")).toBe("Sem dificuldade")
  })

  it("nomes das faixas em inglês", () => {
    const { scoreRange } = messagesFor("en").filters
    expect(scoreRange("rating", "5")).toBe("5 stars")
    expect(scoreRange("rating", "4")).toBe("4 to 4.5 stars")
    expect(scoreRange("rating", "1")).toBe("1 to 1.5 stars")
    expect(scoreRange("rating", "half")).toBe("Half a star")
    expect(scoreRange("rating", "none")).toBe("No rating")
    expect(scoreRange("difficulty", "3")).toBe("3 to 3.5 peppers")
    expect(scoreRange("difficulty", "none")).toBe("No difficulty")
  })

  it("dentro do filtro vale \"ou\"; entre a nota e a dificuldade vale \"e\"", () => {
    const games = [
      makeGame({ id: 1, title: "Obra-prima", rating: 10, difficulty: 8 }),
      makeGame({ id: 2, title: "Muito bom", rating: 9, difficulty: 3 }),
      makeGame({ id: 3, title: "Sem nota", rating: null, difficulty: null }),
    ]
    const titles = (filters: Partial<typeof EMPTY_FILTERS>) =>
      filterGames(games, "", { ...EMPTY_FILTERS, ...filters }).map((game) => game.title)

    expect(titles({ ratings: ["5", "4"] })).toEqual(["Obra-prima", "Muito bom"])
    expect(titles({ ratings: ["none"] })).toEqual(["Sem nota"])
    expect(titles({ ratings: ["5", "4"], difficulties: ["4"] })).toEqual(["Obra-prima"])
  })
})
