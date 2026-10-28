import { describe, expect, it } from "vitest"
import { hubActivity, hubProfileStats } from "../../src/renderer/lib/fullscreenHub"
import { makeGame } from "./helpers"

// O resumo e os cartões do Welcome Hub do Aniki saem dos dados da biblioteca.
describe("Welcome Hub", () => {
  const now = new Date(2026, 9, 20, 12)
  const games = [
    makeGame({ id: 1, title: "A", playtimeMinutes: 600, genres: ["RPG"], platform: "PS2", favorite: true, lastPlayedAt: new Date(2026, 9, 18).toISOString(), addedAt: new Date(2026, 0, 1).toISOString(), romPath: "a.iso", emulatorId: "pcsx2" }),
    makeGame({ id: 2, title: "B", playtimeMinutes: 90, genres: ["Ação", "RPG"], platform: "GBA", lastPlayedAt: new Date(2026, 8, 30).toISOString(), addedAt: new Date(2026, 5, 1).toISOString(), achievements: { unlocked: 3, total: 3, platinum: true, source: "retroachievements" } }),
    makeGame({ id: 3, title: "C", playtimeMinutes: 0, genres: ["Ação"], lastPlayedAt: null, addedAt: new Date(2026, 9, 1).toISOString() }),
  ]
  it("resume o perfil e o mês atual", () => {
    const daily = [{ date: "2026-09-30", minutes: 90 }, { date: "2026-10-18", minutes: 60 }, { date: "2026-10-19", minutes: 15 }]
    expect(hubProfileStats(games, daily, now)).toEqual({
      totalGames: 3, playable: 1, favorites: 1, completed: 1, totalMinutes: 690, monthMinutes: 75, playedThisMonth: 1, topGenre: "RPG", topPlatform: "PS2",
    })
    expect(hubProfileStats([], [], now)).toMatchObject({ totalGames: 0, topGenre: null, topPlatform: null })
  })
  it("escolhe os cartões de atividade", () => {
    expect(hubActivity(games)).toEqual({ lastPlayed: games[0], mostPlayed: games[0], recentlyAdded: games[2], neverPlayed: games[2] })
    expect(hubActivity([])).toEqual({ lastPlayed: null, mostPlayed: null, recentlyAdded: null, neverPlayed: null })
  })
})
