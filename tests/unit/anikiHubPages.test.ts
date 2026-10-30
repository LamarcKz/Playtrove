import { describe, expect, it } from "vitest"
import type { GameAchievements, UnlockedAchievement } from "@shared/achievements"
import { anikiHubPages, anikiHubRecommendations, anikiAchievementMemories, anikiHubOverview, loadAnikiAchievementHistory } from "../../src/renderer/lib/anikiHubPages"
import { makeGame } from "./helpers"

const now = new Date(2026, 9, 28, 12)
const recent = new Date(2026, 9, 27, 12).toISOString()

function achievement(id: number, gameId: number, percent: number | null, earnedAt = "2026-10-20T12:00:00Z"): UnlockedAchievement {
  return {
    key: `ra:${id}`, source: "retroachievements", id, title: `Conquista ${id}`, description: "",
    badgeUrl: null, points: 10, percent, rarity: null, grade: "prata", hidden: false, group: null,
    earnedAt, hardcore: false, gameId, gameTitle: `Jogo ${gameId}`,
  }
}

describe("recomendações locais do Hub do Aniki", () => {
  it("usa os pesos do Helper e diversifica quatro cartões entre as três referências recentes", () => {
    const games = [
      makeGame({ id: 1, title: "Referência A", genres: ["Shooter"], developers: ["Estúdio A", " "], playtimeMinutes: 300, lastPlayedAt: recent }),
      makeGame({ id: 2, title: "Referência B", genres: ["Fighting"], developers: ["Estúdio B"], playtimeMinutes: 200, lastPlayedAt: recent }),
      makeGame({ id: 3, title: "Referência C", genres: ["Racing"], developers: ["Estúdio C"], playtimeMinutes: 100, lastPlayedAt: recent }),
      makeGame({ id: 4, title: "Sugestão A", genres: ["shooter"], developers: ["estúdio a", " "], romPath: "sample.rom", emulatorId: "retroarch" }),
      makeGame({ id: 5, title: "Sugestão B", genres: ["Fighting"], developers: ["Estúdio B"], playtimeMinutes: 60 }),
      makeGame({ id: 6, title: "Sugestão C", genres: ["Racing"], developers: ["Estúdio C"] }),
      makeGame({ id: 7, title: "Sugestão D", genres: ["Shooter"] }),
    ]
    const result = anikiHubRecommendations(games, { now })
    expect(result.referenceId).toBe(1)
    expect(result.items.map((item) => [item.game.id, item.reference.id, item.score, item.reason])).toEqual([
      [4, 1, 110, "developer"], [5, 2, 90, "developer"], [6, 3, 100, "developer"], [7, 1, 40, "genre"],
    ])
  })

  it("exclui concluídos, jogos saturados e famílias incompatíveis sem alterar a biblioteca", () => {
    const games = [
      makeGame({ id: 1, title: "Referência", genres: ["JRPG"], developers: ["Estúdio"], playtimeMinutes: 200, lastPlayedAt: recent }),
      makeGame({ id: 2, title: "Concluído", statusId: 9, genres: ["JRPG"], developers: ["Estúdio"] }),
      makeGame({ id: 3, title: "Saturado", genres: ["JRPG"], developers: ["Estúdio"], playtimeMinutes: 30, lastPlayedAt: "2026-07-01T12:00:00Z" }),
      makeGame({ id: 4, title: "Incompatível", genres: ["Shooter"], developers: ["Estúdio"] }),
      makeGame({ id: 5, title: "Disponível", genres: ["JRPG"], developers: ["Estúdio"] }),
    ]
    const before = structuredClone(games)
    expect(anikiHubRecommendations(games, { now, finishedStatusIds: [9] }).items.map((item) => item.game.id)).toEqual([5])
    expect(games).toEqual(before)
  })

  it("usa o último jogado como reserva sem referências dos últimos 14 dias e conserva a referência da sessão", () => {
    const games = [
      makeGame({ id: 1, title: "Anterior", playtimeMinutes: 100, lastPlayedAt: "2026-08-01T12:00:00Z" }),
      makeGame({ id: 2, title: "Mais recente", playtimeMinutes: 20, lastPlayedAt: "2026-09-01T12:00:00Z" }),
      makeGame({ id: 3, title: "Nunca jogado" }),
    ]
    expect(anikiHubRecommendations(games, { now }).referenceId).toBe(2)
    expect(anikiHubRecommendations(games, { now, stickyReferenceId: 1 }).referenceId).toBe(1)
    expect(anikiHubRecommendations([games[2]], { now })).toEqual({ referenceId: null, items: [] })
  })

  it("usa a contagem real de sessões no desempate e inclui referências com sessão mas sem minuto inteiro", () => {
    const games = [
      makeGame({ id: 1, title: "Referência A", playtimeMinutes: 0, lastPlayedAt: recent }),
      makeGame({ id: 2, title: "Referência B", playtimeMinutes: 0, lastPlayedAt: recent }),
      makeGame({ id: 3, title: "Reserva" }),
      makeGame({ id: 4, title: "Sugestão" }),
    ]
    const result = anikiHubRecommendations(games, { now, activity: [
      { gameId: 1, playtimeSeconds: 0, playCount: 1, monthMinutes: 0 }, { gameId: 2, playtimeSeconds: 0, playCount: 3, monthMinutes: 0 },
    ] })
    expect(result.items[0].reference.id).toBe(2)
  })

  it("usa segundos reais nos limites de 30 minutos e duas horas, sem o arredondamento visual", () => {
    const games = [
      makeGame({ id: 1, title: "Referência", genres: ["Shooter"], playtimeMinutes: 300, lastPlayedAt: recent }),
      makeGame({ id: 2, title: "Quase duas horas", genres: ["Shooter"], playtimeMinutes: 120 }),
      makeGame({ id: 3, title: "Quase meia hora", genres: ["Shooter"], playtimeMinutes: 30, lastPlayedAt: "2026-07-01T12:00:00Z" }),
    ]
    const result = anikiHubRecommendations(games, { now, activity: [
      { gameId: 1, playtimeSeconds: 18000, playCount: 1, monthMinutes: 300 },
      { gameId: 2, playtimeSeconds: 7190, playCount: 1, monthMinutes: 0 },
      { gameId: 3, playtimeSeconds: 1780, playCount: 1, monthMinutes: 0 },
    ] })
    expect(result.items.map((item) => [item.game.id, item.score])).toEqual([[2, 30], [3, 30]])
  })
})

describe("memórias de conquistas do Hub do Aniki", () => {
  const games = [1, 2, 3, 4].map((id) => makeGame({ id, title: `Jogo ${id}` }))

  it("escolhe um mês com quatro desbloqueios e prioriza a mais rara de cada jogo antes de completar", () => {
    const result = anikiAchievementMemories(games, [
      achievement(1, 1, 1), achievement(2, 1, 2), achievement(3, 2, 5), achievement(4, 3, null),
      achievement(5, 1, 0.5, "2026-09-20T12:00:00Z"),
    ], () => 0)
    expect(result.month).toBe("2026-10")
    expect(result.items.map((item) => item.id)).toEqual([1, 3, 4, 2])
  })

  it("não inventa um mês com duplicatas, datas inválidas ou conquistas de jogos ausentes", () => {
    const items = [achievement(1, 1, 1), achievement(2, 2, 2), achievement(3, 3, 3)]
    const data = [...items, achievement(4, 4, 4, "inválida"), achievement(5, 99, 1), ...items]
    expect(anikiAchievementMemories(games, data, () => 0)).toEqual({ month: null, items: [] })
    expect(anikiAchievementMemories(games, [], () => 0)).toEqual({ month: null, items: [] })
  })

  it("permite escolher outro mês do histórico completo sem repetir conquistas", () => {
    const october = [1, 2, 3, 4].map((id) => achievement(id, id, 20))
    const september = [5, 6, 7, 8].map((id) => achievement(id, id - 4, 1, "2026-09-20T12:00:00Z"))
    const result = anikiAchievementMemories(games, [...october, ...october, ...september], () => 0.9)
    expect(result.month).toBe("2026-09")
    expect(result.items.map((item) => item.id)).toEqual([5, 6, 7, 8])
  })
})

it("carrega o histórico completo com no máximo duas leituras locais e conserva as leituras válidas se uma falhar", async () => {
  const games = [1, 2, 3, 4].map((id) => makeGame({ id, title: `Jogo ${id}`, achievements: { unlocked: 1, total: 1, platinum: true, source: "retroachievements" } }))
  let active = 0
  let maxActive = 0
  const history = await loadAnikiAchievementHistory(games, async (gameId) => {
    active++
    maxActive = Math.max(maxActive, active)
    await Promise.resolve()
    active--
    if (gameId === 3) throw new Error("leitura indisponível")
    const data: GameAchievements = {
      gameId, source: "retroachievements", sourceTitle: `Jogo ${gameId}`, unlocked: 1, total: 1, points: 10, totalPoints: 10, platinum: true,
      byGrade: { platina: { unlocked: 1, total: 1 }, ouro: { unlocked: 0, total: 0 }, prata: { unlocked: 1, total: 1 }, bronze: { unlocked: 0, total: 0 } },
      achievements: [achievement(gameId, gameId, 1)],
    }
    return data
  })
  expect(maxActive).toBe(2)
  expect(history.map((item) => item.gameId).sort()).toEqual([1, 2, 4])
})

it("a visão geral prefere o mais jogado do mês diferente do último e evita repetir os quatro jogos", () => {
  const games = [
    makeGame({ id: 1, title: "Último", playtimeMinutes: 1000, lastPlayedAt: recent }),
    makeGame({ id: 2, title: "Histórico", playtimeMinutes: 800 }),
    makeGame({ id: 3, title: "Mês", playtimeMinutes: 60 }),
    makeGame({ id: 4, title: "Novo", addedAt: "2026-10-25T12:00:00Z" }),
    makeGame({ id: 5, title: "Nunca", addedAt: "2026-10-24T12:00:00Z" }),
  ]
  const data = anikiHubOverview(games, [{ gameId: 1, playtimeSeconds: 60000, playCount: 1, monthMinutes: 100 }, { gameId: 3, playtimeSeconds: 3600, playCount: 1, monthMinutes: 60 }], () => 0)
  expect(data.lastPlayed?.id).toBe(1)
  expect(data.mostPlayed?.id).toBe(3)
  expect(data.mostPlayedMonthly).toBe(true)
  expect(data.mostPlayedMinutes).toBe(60)
  expect(new Set([data.lastPlayed?.id, data.mostPlayed?.id, data.recentlyAdded?.id, data.neverPlayed?.id]).size).toBe(4)
  expect(anikiHubOverview(games, [], () => 0).mostPlayed?.id).toBe(2)
  const next = [...games, makeGame({ id: 6, title: "Novidade", addedAt: "2026-10-29T12:00:00Z" })]
  const preserved = anikiHubOverview(next, [], () => 0, data)
  // A alteração do mais jogado pode invalidar os cartões; depois de estabilizados, uma inclusão conserva as escolhas.
  const stable = anikiHubOverview(games, [], () => 0)
  expect(anikiHubOverview(next, [], () => 0, stable).recentlyAdded?.id).toBe(stable.recentlyAdded?.id)
  expect(preserved.lastPlayed?.id).toBe(1)
})

it("preenche os cartões da visão geral ao adicionar jogos depois de uma biblioteca vazia", () => {
  const empty = anikiHubOverview([], [], () => 0)
  const games = [
    makeGame({ id: 1, title: "Novo", addedAt: "2026-10-28T12:00:00Z" }),
    makeGame({ id: 2, title: "Nunca", addedAt: "2026-10-27T12:00:00Z" }),
  ]
  const result = anikiHubOverview(games, [], () => 0, empty)
  expect(result.recentlyAdded?.id).toBe(1)
  expect(result.neverPlayed?.id).toBe(2)
})

it.each(["playtime", "lastPlayed", "playCount"] as const)("revalida o cartão nunca jogado quando %s muda e conserva o adicionado válido", (changed) => {
  const games = [
    makeGame({ id: 1, title: "Último", playtimeMinutes: 60, lastPlayedAt: recent }),
    makeGame({ id: 2, title: "Mais jogado", playtimeMinutes: 120 }),
    makeGame({ id: 3, title: "Novo", addedAt: "2026-10-28T12:00:00Z" }),
    makeGame({ id: 4, title: "Antes nunca jogado", addedAt: "2026-10-27T12:00:00Z" }),
    makeGame({ id: 5, title: "Reserva", addedAt: "2026-10-26T12:00:00Z" }),
  ]
  const previous = anikiHubOverview(games, [], () => 0)
  expect(previous.neverPlayed?.id).toBe(4)
  const updated = games.map((game) => game.id === 4 && changed === "lastPlayed" ? { ...game, lastPlayedAt: "2026-10-01T12:00:00Z" } : game)
  const activity = [{ gameId: 4, playtimeSeconds: changed === "playtime" ? 1 : 0, playCount: changed === "playCount" ? 1 : 0, monthMinutes: 0 }]
  const result = anikiHubOverview(updated, activity, () => 0, previous)
  expect(result.recentlyAdded?.id).toBe(3)
  expect(result.neverPlayed?.id).toBe(5)
})

it("preenche só o cartão vazio sem deslocar a escolha válida do outro cartão", () => {
  const kept = makeGame({ id: 1, title: "Mantido", addedAt: "2026-10-28T12:00:00Z" })
  const added = makeGame({ id: 2, title: "Adicionado", addedAt: "2026-10-27T12:00:00Z" })
  const result = anikiHubOverview([kept, added], [], () => 0, { recentlyAdded: null, neverPlayed: kept })
  expect(result.recentlyAdded?.id).toBe(2)
  expect(result.neverPlayed?.id).toBe(1)
  const other = anikiHubOverview([kept, added], [], () => 0, { recentlyAdded: kept, neverPlayed: null })
  expect(other.recentlyAdded?.id).toBe(1)
  expect(other.neverPlayed?.id).toBe(2)
})

it("substitui apenas as escolhas que conflitam com último e mais jogado sem repetir cartões", () => {
  const games = [
    makeGame({ id: 1, title: "Último", lastPlayedAt: recent }),
    makeGame({ id: 2, title: "Mais jogado", playtimeMinutes: 120 }),
    makeGame({ id: 3, title: "Novo", addedAt: "2026-10-28T12:00:00Z" }),
    makeGame({ id: 4, title: "Nunca", addedAt: "2026-10-27T12:00:00Z" }),
  ]
  const result = anikiHubOverview(games, [], () => 0, { recentlyAdded: games[0], neverPlayed: games[1] })
  expect([result.lastPlayed?.id, result.mostPlayed?.id, result.recentlyAdded?.id, result.neverPlayed?.id]).toEqual([1, 2, 3, 4])
  const duplicate = anikiHubOverview(games, [], () => 0, { recentlyAdded: games[2], neverPlayed: games[2] })
  expect(duplicate.recentlyAdded?.id).toBe(3)
  expect(duplicate.neverPlayed?.id).toBe(4)
})

it("preserva as duas páginas iniciais e só oferece as páginas adicionais com cartões funcionais", () => {
  expect(anikiHubPages(0, 0)).toEqual(["profile", "activity"])
  expect(anikiHubPages(4, 0)).toEqual(["profile", "activity", "recommendations"])
  expect(anikiHubPages(0, 4)).toEqual(["profile", "activity", "memories"])
  expect(anikiHubPages(4, 4)).toEqual(["profile", "activity", "recommendations", "memories"])
})
