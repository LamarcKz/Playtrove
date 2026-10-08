import type Database from "better-sqlite3"
import type { DailyPlaytime } from "../shared/types"

const DAY = 24 * 60 * 60 * 1000

/**
 * Quanto se jogou em cada um dos últimos `days` dias (hoje incluído), do mais antigo para o mais
 * novo. Cada sessão conta no dia (no horário do computador) em que terminou.
 */
export function getDailyPlaytime(db: Database.Database, days: number, now = new Date()): DailyPlaytime[] {
  const today = startOfDay(now)
  const first = new Date(today.getTime() - (days - 1) * DAY)
  // Um dia a mais de margem na consulta, por causa do horário de verão; o filtro exato é por data.
  const rows = db
    .prepare("SELECT ended_at, seconds FROM play_sessions WHERE ended_at >= ?")
    .all(new Date(first.getTime() - DAY).toISOString()) as { ended_at: string; seconds: number }[]

  const secondsByDate = new Map<string, number>()
  for (const row of rows) {
    const date = localDate(new Date(row.ended_at))
    secondsByDate.set(date, (secondsByDate.get(date) ?? 0) + row.seconds)
  }

  const result: DailyPlaytime[] = []
  for (let index = 0; index < days; index++) {
    const date = localDate(new Date(first.getFullYear(), first.getMonth(), first.getDate() + index))
    result.push({ date, minutes: Math.round((secondsByDate.get(date) ?? 0) / 60) })
  }
  return result
}

/** Meia-noite do dia, no horário do computador. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Data no horário do computador, no formato AAAA-MM-DD. */
function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
