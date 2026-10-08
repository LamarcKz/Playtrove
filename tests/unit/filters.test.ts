import { describe, expect, it } from "vitest"
import { genreLabel, messagesFor } from "@shared/i18n"
import { countValues, EMPTY_FILTERS, filterGames, hasActiveFilters, PLAYTIME_RANGES, type LibraryFilters } from "@/lib/filters"
import { daysAgo, makeGame } from "./helpers"

// Status de mentira para os testes: 1 = Jogando, 2 = Zerado, 3 = Planejo jogar.
const games = [
  makeGame({ id: 1, title: "Crônicas de Valdoria", statusId: 1, favorite: true, playtimeMinutes: 4380, lastPlayedAt: daysAgo(2), platform: "PlayStation 2", library: "PCSX2" }),
  makeGame({ id: 2, title: "Neon Madrugada", statusId: 1, playtimeMinutes: 750, lastPlayedAt: daysAgo(0), platform: "PlayStation", library: "DuckStation" }),
  makeGame({ id: 3, title: "Horizonte Partido", statusId: 3, platform: "PlayStation 2", library: "PCSX2" }),
  makeGame({ id: 4, title: "Mar de Estrelas", statusId: 2, favorite: true, playtimeMinutes: 12040, lastPlayedAt: daysAgo(45), platform: "Game Boy Advance", library: "RetroArch" }),
  makeGame({ id: 5, title: "Jardim dos Autômatos", statusId: 1, playtimeMinutes: 45, lastPlayedAt: daysAgo(1) }),
]

const ids = (query: string, changes: Partial<LibraryFilters>) =>
  filterGames(games, query, { ...EMPTY_FILTERS, ...changes }).map((game) => game.id)

describe("busca", () => {
  it("sem busca nem filtro, passam todos", () => {
    expect(ids("", {})).toEqual([1, 2, 3, 4, 5])
  })
  it("ignora acentos e maiúsculas", () => {
    expect(ids("cronicas", {})).toEqual([1])
    expect(ids("  MAR ", {})).toEqual([4])
    expect(ids("automatos", {})).toEqual([5])
  })
  it("sem resultado", () => {
    expect(ids("zzz", {})).toEqual([])
  })
})

describe("filtros", () => {
  it("Favoritos e Recentes (últimos 30 dias)", () => {
    expect(ids("", { favorites: true })).toEqual([1, 4])
    expect(ids("", { recent: true })).toEqual([1, 2, 5])
  })
  it("dentro de um filtro vale \"ou\"; entre filtros, \"e\"", () => {
    expect(ids("", { statuses: [1, 2] })).toEqual([1, 2, 4, 5])
    expect(ids("", { statuses: [1], favorites: true })).toEqual([1])
    expect(ids("", { statuses: [3], favorites: true })).toEqual([])
  })
  it("tempo jogado", () => {
    expect(ids("", { playtime: ["over-100h"] })).toEqual([4])
    expect(ids("", { playtime: ["never", "under-1h"] })).toEqual([3, 5])
  })
  it("plataforma e biblioteca (jogos sem o dado ficam de fora quando o filtro está ligado)", () => {
    expect(ids("", { platforms: ["PlayStation 2"] })).toEqual([1, 3])
    expect(ids("", { libraries: ["DuckStation", "RetroArch"] })).toEqual([2, 4])
  })
  it("hasActiveFilters", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, statuses: [1] })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, platforms: ["PlayStation"] })).toBe(true)
  })
})

describe("faixas de tempo jogado", () => {
  it("cada tempo cai em exatamente uma faixa, com os limites certos", () => {
    const edges: [number, string][] = [
      [0, "never"], [1, "under-1h"], [59, "under-1h"], [60, "1-10h"], [599, "1-10h"],
      [600, "10-100h"], [5999, "10-100h"], [6000, "over-100h"],
    ]
    for (const [minutes, id] of edges) {
      const matching = PLAYTIME_RANGES.filter((range) => range.matches(minutes))
      expect(matching.map((range) => range.id)).toEqual([id])
    }
  })
})

describe("countValues", () => {
  it("conta os valores diferentes, em ordem alfabética, sem os vazios", () => {
    expect(countValues(games, (game) => game.platform)).toEqual([
      { value: "Game Boy Advance", label: "Game Boy Advance", count: 1 },
      { value: "PlayStation", label: "PlayStation", count: 1 },
      { value: "PlayStation 2", label: "PlayStation 2", count: 2 },
    ])
  })
})

describe("filtros dos metadados", () => {
  const withMetadata = [
    makeGame({ id: 1, title: "Salto Estelar", genres: ["Platform", "Adventure"], developers: ["Estúdio Aurora"], publishers: ["Sony"], releaseDate: "2003-10-14" }),
    makeGame({ id: 2, title: "Pista Real 4", genres: ["Racing", "Simulator"], developers: ["Polyphony Digital"], publishers: ["Sony"], releaseDate: "2004-12-28" }),
    makeGame({ id: 3, title: "Sem metadados" }),
  ]
  const pick = (changes: Partial<LibraryFilters>) =>
    filterGames(withMetadata, "", { ...EMPTY_FILTERS, ...changes }).map((game) => game.id)

  it("gênero, desenvolvedora, publicadora e ano (vale se algum valor do jogo foi escolhido)", () => {
    expect(pick({ genres: ["Adventure"] })).toEqual([1])
    expect(pick({ genres: ["Adventure", "Racing"] })).toEqual([1, 2])
    expect(pick({ developers: ["Polyphony Digital"] })).toEqual([2])
    expect(pick({ publishers: ["Sony"] })).toEqual([1, 2])
    expect(pick({ years: ["2004"] })).toEqual([2])
    expect(pick({ genres: ["Adventure"], years: ["2004"] })).toEqual([])
    expect(hasActiveFilters({ ...EMPTY_FILTERS, years: ["2004"] })).toBe(true)
  })

  it("countValues conta cada valor de listas (um jogo conta uma vez em cada gênero)", () => {
    expect(countValues(withMetadata, (game) => game.publishers)).toEqual([{ value: "Sony", label: "Sony", count: 2 }])
    expect(countValues(withMetadata, (game) => game.releaseDate?.slice(0, 4) ?? null)).toEqual([
      { value: "2003", label: "2003", count: 1 },
      { value: "2004", label: "2004", count: 1 },
    ])
  })

  it("os gêneros ficam como vêm do IGDB e aparecem no idioma do app, em ordem pelo nome traduzido", () => {
    const pt = messagesFor("pt-BR")
    const inPortuguese = countValues(withMetadata, (game) => game.genres, (genre) => genreLabel(genre, pt))
    expect(inPortuguese.map((item) => [item.value, item.label])).toEqual([
      ["Adventure", "Aventura"],
      ["Racing", "Corrida"],
      ["Platform", "Plataforma"],
      ["Simulator", "Simulação"],
    ])
    const en = messagesFor("en")
    expect(countValues(withMetadata, (game) => game.genres, (genre) => genreLabel(genre, en)).map((item) => item.label)).toEqual([
      "Adventure",
      "Platform",
      "Racing",
      "Simulation",
    ])
    // Um gênero que o dicionário não tem aparece como veio.
    expect(genreLabel("Gênero Novo", pt)).toBe("Gênero Novo")
  })
})
