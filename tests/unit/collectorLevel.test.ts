import { describe, expect, it } from "vitest"
import { COLLECTOR_CURVE, TROPHY_CURVE, achievementLevel, collectorScore, trophyScore } from "../../src/renderer/lib/collectorLevel"

// A pontuação e os níveis da tela cheia seguem a regra que o Aniki mostra (PlayniteAchievements).
describe("nível de colecionador", () => {
  it("soma pontos pela raridade e pelo tipo do troféu", () => {
    expect(collectorScore({ comum: 2, rara: 1, "muito-rara": 1, ultrarrara: 1 })).toBe(30 + 30 + 90 + 180)
    expect(trophyScore({ platina: 1, ouro: 2, prata: 1, bronze: 3 })).toBe(300 + 180 + 30 + 45)
  })
  it("sobe de nível em faixas que crescem e dá a patente", () => {
    expect(achievementLevel(0, COLLECTOR_CURVE)).toEqual({ level: 0, progress: 0, pointsToNext: 101, rank: { tier: "bronze", step: 5 } })
    expect(achievementLevel(100, COLLECTOR_CURVE).level).toBe(0)
    expect(achievementLevel(101, COLLECTOR_CURVE)).toMatchObject({ level: 1, progress: 0, pointsToNext: 140 })
    expect(achievementLevel(240, COLLECTOR_CURVE).level).toBe(1)
    expect(achievementLevel(241, COLLECTOR_CURVE).level).toBe(2)
    // Nível 50: começa a prata.
    let score = 1
    for (let level = 0; level < 50; level++) score += 100 + 40 * level
    expect(achievementLevel(score, COLLECTOR_CURVE).rank).toEqual({ tier: "silver", step: 5 })
    expect(achievementLevel(score - 1, COLLECTOR_CURVE).rank).toEqual({ tier: "bronze", step: 1 })
  })
  it("recomeça a contagem depois do nível 250 somando os níveis já feitos", () => {
    let cycle = 0
    for (let level = 0; level < 250; level++) cycle += 100 + (level === 0 ? 0 : 40 * Math.min(level, 98) + 20 * Math.max(0, level - 98))
    expect(achievementLevel(cycle, COLLECTOR_CURVE).level).toBe(249)
    expect(achievementLevel(cycle + 1, COLLECTOR_CURVE)).toMatchObject({ level: 250, rank: { tier: "bronze", step: 5 } })
  })
  it("os pontos de troféu começam no nível 1, de 100 em 100 a mais", () => {
    expect(achievementLevel(0, TROPHY_CURVE)).toEqual({ level: 1, progress: 0, pointsToNext: 101, rank: null })
    expect(achievementLevel(101, TROPHY_CURVE).level).toBe(2)
    expect(achievementLevel(301, TROPHY_CURVE).level).toBe(3)
    expect(achievementLevel(150, TROPHY_CURVE).progress).toBe(24)
  })
})
