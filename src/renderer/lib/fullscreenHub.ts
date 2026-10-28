import type { DailyPlaytime, Game } from "@shared/types"

/** O resumo do perfil no Welcome Hub do Aniki, calculado com os dados da biblioteca. */
export interface HubProfileStats {
  totalGames: number
  /** Jogos com ROM e emulador (o "instalado" do Aniki). */
  playable: number
  favorites: number
  /** Jogos com todas as conquistas (100%). */
  completed: number
  totalMinutes: number
  monthMinutes: number
  playedThisMonth: number
  /** O gênero e a plataforma com mais tempo jogado, ou null sem tempo jogado. */
  topGenre: string | null
  topPlatform: string | null
}

function topBy(games: Game[], keys: (game: Game) => (string | null)[]): string | null {
  const minutes = new Map<string, number>()
  for (const game of games) for (const key of keys(game)) if (key && game.playtimeMinutes > 0) minutes.set(key, (minutes.get(key) ?? 0) + game.playtimeMinutes)
  let best: string | null = null
  for (const [key, value] of minutes) if (best === null || value > minutes.get(best)!) best = key
  return best
}

export function hubProfileStats(games: Game[], daily: DailyPlaytime[], now = new Date()): HubProfileStats {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  return {
    totalGames: games.length,
    playable: games.filter((game) => game.romPath && game.emulatorId).length,
    favorites: games.filter((game) => game.favorite).length,
    completed: games.filter((game) => game.achievements?.platinum).length,
    totalMinutes: games.reduce((sum, game) => sum + game.playtimeMinutes, 0),
    monthMinutes: daily.filter((day) => day.date.startsWith(month)).reduce((sum, day) => sum + day.minutes, 0),
    playedThisMonth: games.filter((game) => game.lastPlayedAt && Date.parse(game.lastPlayedAt) >= monthStart).length,
    topGenre: topBy(games, (game) => game.genres),
    topPlatform: topBy(games, (game) => [game.platform]),
  }
}

/** Os cartões de atividade do Hub: último jogado, mais jogado, adicionado por último e um nunca jogado. */
export function hubActivity(games: Game[]) {
  const latest = (pick: (game: Game) => number) => games.reduce<Game | null>((best, game) => (pick(game) > (best ? pick(best) : -Infinity) ? game : best), null)
  const played = games.filter((game) => game.lastPlayedAt)
  return {
    lastPlayed: played.length ? played.reduce((best, game) => (Date.parse(game.lastPlayedAt!) > Date.parse(best.lastPlayedAt!) ? game : best)) : null,
    mostPlayed: games.some((game) => game.playtimeMinutes > 0) ? latest((game) => game.playtimeMinutes) : null,
    recentlyAdded: latest((game) => Date.parse(game.addedAt)),
    neverPlayed: games.find((game) => !game.lastPlayedAt && game.playtimeMinutes === 0) ?? null,
  }
}
