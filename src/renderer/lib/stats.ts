import type { Messages } from "@shared/i18n"
import type { DailyPlaytime, Game, Status } from "@shared/types"
import { isRecent } from "@/lib/filters"

/** Os números do topo da tela de Estatísticas. */
export interface StatsSummary {
  totalGames: number
  /** Jogos com algum tempo jogado. */
  playedGames: number
  neverPlayed: number
  favorites: number
  totalMinutes: number
  /** Média de tempo entre os jogos que já foram jogados. */
  averageMinutes: number
  /** Jogados nos últimos 30 dias (os "Recentes" do filtro). */
  playedRecently: number
}

export function summarize(games: Game[]): StatsSummary {
  const played = games.filter((game) => game.playtimeMinutes > 0)
  const totalMinutes = played.reduce((sum, game) => sum + game.playtimeMinutes, 0)
  return {
    totalGames: games.length,
    playedGames: played.length,
    neverPlayed: games.length - played.length,
    favorites: games.filter((game) => game.favorite).length,
    totalMinutes,
    averageMinutes: played.length > 0 ? Math.round(totalMinutes / played.length) : 0,
    playedRecently: games.filter(isRecent).length,
  }
}

/** Os mais jogados, do maior tempo para o menor (só os que têm tempo). */
export function topPlayed(games: Game[], limit = 10): Game[] {
  return games
    .filter((game) => game.playtimeMinutes > 0)
    .sort((a, b) => b.playtimeMinutes - a.playtimeMinutes || compareTitles(a, b))
    .slice(0, limit)
}

/** Os jogados por último, do mais recente para o mais antigo. */
export function recentlyPlayed(games: Game[], limit = 5): Game[] {
  return games
    .filter((game) => game.lastPlayedAt !== null)
    .sort((a, b) => Date.parse(b.lastPlayedAt as string) - Date.parse(a.lastPlayedAt as string))
    .slice(0, limit)
}

/** Os que nunca foram jogados, dos que entraram por último para os mais antigos. */
export function neverPlayedGames(games: Game[]): Game[] {
  return games
    .filter((game) => game.playtimeMinutes === 0)
    .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt) || compareTitles(a, b))
}

/** Um grupo de jogos (ex.: uma plataforma): quantos jogos e quanto tempo jogado. */
export interface GameGroup {
  label: string
  games: number
  minutes: number
}

/**
 * Agrupa os jogos por um campo (plataforma, biblioteca...), do grupo com mais jogos para o com
 * menos. Jogos sem o valor ficam no grupo `missingLabel`, sempre por último.
 */
export function groupGames(games: Game[], pick: (game: Game) => string | null, missingLabel: string): GameGroup[] {
  const groups = new Map<string, GameGroup>()
  let missing: GameGroup | null = null
  for (const game of games) {
    const value = pick(game)
    const group = value ? groups.get(value) : missing
    if (group) {
      group.games++
      group.minutes += game.playtimeMinutes
      continue
    }
    const created = { label: value ?? missingLabel, games: 1, minutes: game.playtimeMinutes }
    if (value) groups.set(value, created)
    else missing = created
  }
  const sorted = [...groups.values()].sort(
    (a, b) => b.games - a.games || a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" })
  )
  return missing ? [...sorted, missing] : sorted
}

/** Quantos jogos há em cada status, na ordem dos status (a mesma do Kanban). */
export function countByStatus(games: Game[], statuses: Status[]): { status: Status; games: number }[] {
  return statuses.map((status) => ({ status, games: games.filter((game) => game.statusId === status.id).length }))
}

/** Parte de um total, em porcentagem inteira ("25%"). */
export function formatShare(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "0%"
}

/** Total de minutos e quantos dias tiveram jogo, no período do gráfico de atividade. */
export function activityTotals(days: DailyPlaytime[]): { minutes: number; activeDays: number } {
  return {
    minutes: days.reduce((sum, day) => sum + day.minutes, 0),
    activeDays: days.filter((day) => day.minutes > 0).length,
  }
}

/** Valores "redondos" para o topo do eixo do gráfico de atividade, em minutos. */
const AXIS_STEPS = [30, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 960, 1200, 1440]

/** O topo do eixo: o menor valor redondo que cabe o maior dia (mínimo de 30 min). */
export function axisMax(maxMinutes: number): number {
  return AXIS_STEPS.find((step) => step >= maxMinutes) ?? Math.ceil(maxMinutes / 60) * 60
}

/** Texto curto para o eixo, no idioma: "30 min", "2 h", "1,5 h" (ou "30m", "2h", "1.5h"). */
export function formatAxisMinutes(minutes: number, t: Messages): string {
  if (minutes < 60) return t.format.minutes(minutes)
  const hours = minutes / 60
  return t.format.hours(hours.toLocaleString(t.locale, { maximumFractionDigits: 1 }))
}

/** Data curta para o gráfico, na ordem do idioma: "19/09" (ou "09/19"). */
export function formatShortDate(date: string, locale: string): string {
  return localDate(date).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" })
}

function compareTitles(a: Game, b: Game): number {
  return a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" })
}

/** Uma coluna dos gráficos (components/ColumnChart.tsx). */
export interface ChartColumn {
  key: string
  /** O nome por extenso, na dica e na tabela (ex.: "sáb., 19/09"). */
  label: string
  /** O nome curto embaixo da coluna, ou null para não mostrar. */
  axisLabel: string | null
  value: number
}

/** De quantos em quantos dias aparece uma data embaixo dos gráficos por dia. */
const DATE_LABEL_EVERY = 7

/** As colunas de um gráfico por dia: a data curta a cada semana e "Hoje" no fim. */
export function dayColumns(days: { date: string; value: number }[], t: Messages): ChartColumn[] {
  const last = days.length - 1
  return days.map((day, index) => ({
    key: day.date,
    label: formatDay(day.date, t.locale),
    axisLabel:
      index === last ? t.charts.today : (last - index) % DATE_LABEL_EVERY === 0 ? formatShortDate(day.date, t.locale) : null,
    value: day.value,
  }))
}

/** As colunas de um gráfico por mês: "set" embaixo e "setembro de 2026" na dica (ou "Sep" e "September 2026"). */
export function monthColumns(months: { month: string; value: number }[], locale: string): ChartColumn[] {
  return months.map(({ month, value }) => {
    const [year, number] = month.split("-").map(Number)
    const date = new Date(year, number - 1, 1)
    return {
      key: month,
      label: date.toLocaleDateString(locale, { month: "long", year: "numeric" }),
      axisLabel: date.toLocaleDateString(locale, { month: "short" }).replace(".", ""),
      value,
    }
  })
}

/** O dia por extenso, curto: "sáb., 19/09" (ou "Sat, 09/19"). */
export function formatDay(date: string, locale: string): string {
  return localDate(date).toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "2-digit" })
}

/** Uma data AAAA-MM-DD no horário do computador. */
function localDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(year, month - 1, day)
}
