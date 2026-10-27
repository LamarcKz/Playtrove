import { describe, expect, it } from "vitest"
import type { GameAchievement } from "../../src/shared/achievements"
import { sortAchievements } from "../../src/renderer/lib/achievements"

const item = (key: string, extra: Partial<GameAchievement>): GameAchievement => ({
  key, source: "retroachievements", id: 1, title: key, description: "", points: 5, badgeUrl: null, percent: null, rarity: null,
  grade: "bronze", hidden: false, group: null, earnedAt: null, hardcore: false, ...extra,
})

// As ordenações do painel de troféus do Aniki não mudam a lista original.
describe("ordenação dos troféus", () => {
  const list = [
    item("Bravo", { grade: "ouro", percent: 40, earnedAt: "2026-01-02T10:00:00Z" }),
    item("Alfa", { grade: "bronze", percent: 3 }),
    item("Charlie", { grade: "platina", earnedAt: "2026-03-01T10:00:00Z" }),
  ]
  it("ordena por nome, data, raridade e tipo", () => {
    expect(sortAchievements(list, "default", "pt-BR").map((a) => a.key)).toEqual(["Bravo", "Alfa", "Charlie"])
    expect(sortAchievements(list, "name", "pt-BR").map((a) => a.key)).toEqual(["Alfa", "Bravo", "Charlie"])
    expect(sortAchievements(list, "date", "pt-BR").map((a) => a.key)).toEqual(["Charlie", "Bravo", "Alfa"])
    expect(sortAchievements(list, "rarity", "pt-BR").map((a) => a.key)).toEqual(["Alfa", "Bravo", "Charlie"])
    expect(sortAchievements(list, "grade", "pt-BR").map((a) => a.key)).toEqual(["Charlie", "Bravo", "Alfa"])
    expect(list.map((a) => a.key)).toEqual(["Bravo", "Alfa", "Charlie"])
  })
})
