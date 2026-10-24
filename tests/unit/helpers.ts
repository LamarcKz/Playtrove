import type { Game } from "@shared/types"

const DAY = 24 * 60 * 60 * 1000

/** Um jogo de teste: só o que importa para cada teste precisa ser informado. */
export function makeGame(overrides: Partial<Game> & { id: number; title: string }): Game {
  return {
    statusId: 1,
    favorite: false,
    playtimeMinutes: 0,
    lastPlayedAt: null,
    addedAt: new Date().toISOString(),
    platform: null,
    library: null,
    romPath: null,
    emulatorId: null,
    description: null,
    genres: [],
    developers: [],
    publishers: [],
    releaseDate: null,
    coverUrl: null,
    backgroundUrl: null,
    backgroundVideoUrl: null,
    metadataUpdatedAt: null,
    rating: null,
    difficulty: null,
    review: null,
    achievements: null,
    trophiesPending: false,
    ...overrides,
  }
}

/** Data de alguns dias atrás, no formato ISO. */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString()
}
