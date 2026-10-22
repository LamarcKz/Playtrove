import { describe, expect, it } from "vitest"
import { messagesFor } from "@shared/i18n"
import type { Status } from "@shared/types"
import {
  activityTotals,
  axisMax,
  countByStatus,
  dayColumns,
  formatAxisMinutes,
  formatDay,
  formatShare,
  formatShortDate,
  groupGames,
  monthColumns,
  neverPlayedGames,
  recentlyPlayed,
  summarize,
  topPlayed,
} from "@/lib/stats"
import { daysAgo, makeGame } from "./helpers"

const games = [
  makeGame({ id: 1, title: "Mar de Estrelas", statusId: 1, favorite: true, playtimeMinutes: 12040, lastPlayedAt: daysAgo(45), platform: "PlayStation 2", library: "PCSX2", addedAt: daysAgo(300) }),
  makeGame({ id: 2, title: "Neon Madrugada", statusId: 2, playtimeMinutes: 750, lastPlayedAt: daysAgo(0), platform: "PlayStation", library: "DuckStation", addedAt: daysAgo(200) }),
  makeGame({ id: 3, title: "Horizonte Partido", statusId: 1, platform: "PlayStation 2", library: "PCSX2", addedAt: daysAgo(10) }),
  makeGame({ id: 4, title: "Colônia Ártica", statusId: 1, platform: null, library: "DuckStation", addedAt: daysAgo(50) }),
  makeGame({ id: 5, title: "Jardim dos Autômatos", statusId: 2, playtimeMinutes: 750, lastPlayedAt: daysAgo(3), platform: "Game Boy Advance", library: "RetroArch", addedAt: daysAgo(100) }),
]

describe("números da biblioteca", () => {
  it("resumo: jogos, tempo total, média entre os jogados, nunca jogados, favoritos e recentes", () => {
    expect(summarize(games)).toEqual({
      totalGames: 5,
      playedGames: 3,
      neverPlayed: 2,
      favorites: 1,
      totalMinutes: 13540,
      averageMinutes: 4513,
      playedRecently: 2,
    })
    expect(summarize([])).toMatchObject({ totalGames: 0, totalMinutes: 0, averageMinutes: 0 })
  })

  it("os mais jogados (empate em ordem alfabética), os jogados por último e os nunca jogados", () => {
    expect(topPlayed(games).map((game) => game.id)).toEqual([1, 5, 2])
    expect(topPlayed(games, 1).map((game) => game.id)).toEqual([1])
    expect(recentlyPlayed(games).map((game) => game.id)).toEqual([2, 5, 1])
    expect(neverPlayedGames(games).map((game) => game.id)).toEqual([3, 4])
  })

  it("grupos por plataforma: do maior para o menor, e os sem plataforma no fim", () => {
    expect(groupGames(games, (game) => game.platform, "Sem plataforma")).toEqual([
      { label: "PlayStation 2", games: 2, minutes: 12040 },
      { label: "Game Boy Advance", games: 1, minutes: 750 },
      { label: "PlayStation", games: 1, minutes: 750 },
      { label: "Sem plataforma", games: 1, minutes: 0 },
    ])
  })

  it("jogos por status, na ordem dos status (inclusive os vazios)", () => {
    const statuses: Status[] = [
      { id: 1, name: "Planejo jogar", position: 0 },
      { id: 2, name: "Jogando", position: 1 },
      { id: 3, name: "Zerado", position: 2 },
    ]
    expect(countByStatus(games, statuses).map(({ status, games: count }) => [status.name, count])).toEqual([
      ["Planejo jogar", 3],
      ["Jogando", 2],
      ["Zerado", 0],
    ])
    expect(formatShare(1, 3)).toBe("33%")
    expect(formatShare(0, 0)).toBe("0%")
  })
})

describe("gráfico de atividade", () => {
  it("totais, topo do eixo e textos curtos", () => {
    expect(activityTotals([{ date: "2026-09-18", minutes: 0 }, { date: "2026-09-19", minutes: 95 }])).toEqual({
      minutes: 95,
      activeDays: 1,
    })
    expect(axisMax(0)).toBe(30)
    expect(axisMax(45)).toBe(60)
    expect(axisMax(95)).toBe(120)
    expect(axisMax(2000)).toBe(2040)
    const pt = messagesFor("pt-BR")
    expect(formatAxisMinutes(45, pt)).toBe("45 min")
    expect(formatAxisMinutes(120, pt)).toBe("2 h")
    expect(formatAxisMinutes(90, pt)).toBe("1,5 h")
    expect(formatShortDate("2026-09-05", pt.locale)).toBe("05/09")
  })

  it("em inglês: o mês antes do dia e o ponto nas horas", () => {
    const en = messagesFor("en")
    expect(formatAxisMinutes(45, en)).toBe("45m")
    expect(formatAxisMinutes(90, en)).toBe("1.5h")
    expect(formatShortDate("2026-09-05", en.locale)).toBe("09/05")
    expect(formatDay("2026-09-19", en.locale)).toBe("Sat, 09/19")
    expect(formatDay("2026-09-19", "pt-BR")).toBe("sáb., 19/09")
  })

  it("colunas por dia e por mês nos dois idiomas", () => {
    const days = Array.from({ length: 8 }, (_, index) => ({ date: `2026-09-${String(12 + index).padStart(2, "0")}`, value: index }))
    expect(dayColumns(days, messagesFor("pt-BR")).map((column) => column.axisLabel)).toEqual([
      "12/09",
      null,
      null,
      null,
      null,
      null,
      null,
      "Hoje",
    ])
    expect(dayColumns(days, messagesFor("en")).at(-1)?.axisLabel).toBe("Today")
    const [september] = monthColumns([{ month: "2026-09", value: 3 }], "pt-BR")
    expect([september.label, september.axisLabel]).toEqual(["setembro de 2026", "set"])
    const [inEnglish] = monthColumns([{ month: "2026-09", value: 3 }], "en-US")
    expect([inEnglish.label, inEnglish.axisLabel]).toEqual(["September 2026", "Sep"])
  })
})
