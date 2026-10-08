import type { Game } from "@shared/types"

/** Até quantos dias atrás um jogo conta como "Recente". */
export const RECENT_DAYS = 30

/**
 * Faixas do filtro "Tempo jogado". Cada uma diz se um tempo (em minutos) está dentro dela. O nome de
 * cada faixa fica no dicionário (filters.playtimeRanges).
 */
export const PLAYTIME_RANGES = [
  { id: "never", matches: (minutes: number) => minutes === 0 },
  { id: "under-1h", matches: (minutes: number) => minutes > 0 && minutes < 60 },
  { id: "1-10h", matches: (minutes: number) => minutes >= 60 && minutes < 600 },
  { id: "10-100h", matches: (minutes: number) => minutes >= 600 && minutes < 6000 },
  { id: "over-100h", matches: (minutes: number) => minutes >= 6000 },
] as const

export type PlaytimeRange = (typeof PLAYTIME_RANGES)[number]["id"]

/**
 * Faixas dos filtros "Nota" e "Dificuldade", de ícone inteiro em ícone inteiro: a meia estrela fica
 * na faixa de baixo (4,5 estrelas está em "4 a 4,5"). Os valores vão de 1 a 10, em meios ícones. O
 * nome de cada faixa sai do dicionário (filters.scoreRange).
 */
export const SCORE_RANGES = [
  { id: "5", min: 10, max: 10 },
  { id: "4", min: 8, max: 9 },
  { id: "3", min: 6, max: 7 },
  { id: "2", min: 4, max: 5 },
  { id: "1", min: 2, max: 3 },
  { id: "half", min: 1, max: 1 },
  { id: "none", min: null, max: null },
] as const

export type ScoreRange = (typeof SCORE_RANGES)[number]["id"]

/** A nota (ou dificuldade) está dentro da faixa? "none" é quem ainda não foi avaliado. */
export function matchesScore(score: number | null, range: ScoreRange): boolean {
  const option = SCORE_RANGES.find((item) => item.id === range)
  if (!option) return false
  if (option.min === null) return score === null
  return score !== null && score >= option.min && score <= option.max
}

/**
 * Filtros da Biblioteca (painel da direita). Entre filtros diferentes vale "e" (favorito E jogando);
 * dentro de um filtro vale "ou" (Jogando OU Zerado). Lista vazia quer dizer "sem filtro".
 */
export interface LibraryFilters {
  favorites: boolean
  recent: boolean
  /** Ids dos status escolhidos. */
  statuses: number[]
  playtime: PlaytimeRange[]
  /** Faixas da minha nota e da dificuldade. */
  ratings: ScoreRange[]
  difficulties: ScoreRange[]
  platforms: string[]
  libraries: string[]
  genres: string[]
  developers: string[]
  publishers: string[]
  /** Anos de lançamento (ex.: "2004"). */
  years: string[]
}

export const EMPTY_FILTERS: LibraryFilters = {
  favorites: false,
  recent: false,
  statuses: [],
  playtime: [],
  ratings: [],
  difficulties: [],
  platforms: [],
  libraries: [],
  genres: [],
  developers: [],
  publishers: [],
  years: [],
}

/** Há algum filtro ligado? */
export function hasActiveFilters(filters: LibraryFilters): boolean {
  return (
    filters.favorites ||
    filters.recent ||
    filters.statuses.length > 0 ||
    filters.playtime.length > 0 ||
    filters.ratings.length > 0 ||
    filters.difficulties.length > 0 ||
    filters.platforms.length > 0 ||
    filters.libraries.length > 0 ||
    filters.genres.length > 0 ||
    filters.developers.length > 0 ||
    filters.publishers.length > 0 ||
    filters.years.length > 0
  )
}

/** Aplica a busca e os filtros à lista de jogos. */
export function filterGames(games: Game[], query: string, filters: LibraryFilters): Game[] {
  const search = normalize(query.trim())
  return games.filter(
    (game) =>
      (!search || normalize(game.title).includes(search)) &&
      (!filters.favorites || game.favorite) &&
      (!filters.recent || isRecent(game)) &&
      (filters.statuses.length === 0 || filters.statuses.includes(game.statusId)) &&
      (filters.playtime.length === 0 || filters.playtime.some((id) => matchesPlaytime(game, id))) &&
      (filters.ratings.length === 0 || filters.ratings.some((id) => matchesScore(game.rating, id))) &&
      (filters.difficulties.length === 0 || filters.difficulties.some((id) => matchesScore(game.difficulty, id))) &&
      matchesAny(filters.platforms, game.platform) &&
      matchesAny(filters.libraries, game.library) &&
      matchesAnyOf(filters.genres, game.genres) &&
      matchesAnyOf(filters.developers, game.developers) &&
      matchesAnyOf(filters.publishers, game.publishers) &&
      matchesAny(filters.years, releaseYear(game))
  )
}

/** Ano de lançamento do jogo (ex.: "2004"), ou null se ele não tiver a data. */
export function releaseYear(game: Game): string | null {
  return game.releaseDate?.slice(0, 4) ?? null
}

/** O jogo foi jogado nos últimos RECENT_DAYS dias? */
export function isRecent(game: Game): boolean {
  if (!game.lastPlayedAt) return false
  return Date.now() - new Date(game.lastPlayedAt).getTime() <= RECENT_DAYS * 24 * 60 * 60 * 1000
}

/** O tempo jogado está dentro da faixa? */
export function matchesPlaytime(game: Game, range: PlaytimeRange): boolean {
  return PLAYTIME_RANGES.some((option) => option.id === range && option.matches(game.playtimeMinutes))
}

/**
 * Os valores diferentes de um campo dos jogos (ex.: as plataformas), em ordem alfabética, com
 * quantos jogos têm cada um. Jogos sem o valor ficam de fora. `label` é o nome na tela (os gêneros
 * são traduzidos); a ordem é a do nome.
 */
export function countValues(
  games: Game[],
  pick: (game: Game) => string | string[] | null,
  label: (value: string) => string = (value) => value
): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const game of games) {
    const picked = pick(game)
    // Campos com vários valores (ex.: gêneros): o jogo conta uma vez em cada um.
    for (const value of new Set(Array.isArray(picked) ? picked : [picked])) {
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  return [...counts]
    .map(([value, count]) => ({ value, label: label(value), count }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }))
}

/** Sem nada escolhido, todos passam; senão, o valor do jogo precisa ser um dos escolhidos. */
function matchesAny(chosen: string[], value: string | null): boolean {
  return chosen.length === 0 || (value !== null && chosen.includes(value))
}

/** Para campos com vários valores (ex.: gêneros): algum valor do jogo precisa ser um dos escolhidos. */
function matchesAnyOf(chosen: string[], values: string[]): boolean {
  return chosen.length === 0 || values.some((value) => chosen.includes(value))
}

/** Texto para comparar na busca: sem acentos e em minúsculas ("Crônicas" → "cronicas"). */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}
