import type { Messages } from "@shared/i18n"

/**
 * Transforma minutos em um texto curto de tempo jogado, no idioma do app.
 * Ex. (português): 0 → "Nunca jogado", 45 → "45 min", 120 → "2 h", 750 → "12 h 30 min".
 * Ex. (inglês): 45 → "45m", 750 → "12h 30m".
 */
export function formatPlaytime(totalMinutes: number, t: Messages): string {
  if (totalMinutes <= 0) return t.format.neverPlayed

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) return t.format.minutes(minutes)
  if (minutes === 0) return t.format.hours(hours)
  return `${t.format.hours(hours)} ${t.format.minutes(minutes)}`
}

/**
 * Transforma a data da última vez jogado num texto curto.
 * Ex.: hoje → "Hoje", ontem → "Ontem", 5 dias atrás → "Há 5 dias", mais de 30 dias → "12/08/2026".
 */
export function formatLastPlayed(isoDate: string | null, t: Messages): string {
  if (!isoDate) return t.format.neverPlayed

  const date = new Date(isoDate)
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / (24 * 60 * 60 * 1000))

  if (days <= 0) return t.format.today
  if (days === 1) return t.format.yesterday
  if (days <= 30) return t.format.daysAgo(days)
  return formatDate(date, t.locale)
}

/**
 * Nome curto de um core do RetroArch: o que está entre parênteses no fim do nome.
 * Ex.: "Nintendo - Game Boy Advance (mGBA)" → "mGBA".
 */
export function shortCoreName(name: string): string {
  return /\(([^)]+)\)\s*$/.exec(name)?.[1] ?? name
}

/**
 * Data de lançamento (AAAA-MM-DD) no formato do idioma: "2003-10-14" → "14/10/2003" (ou
 * "10/14/2003", em inglês). Só o ano fica como está.
 */
export function formatReleaseDate(date: string, locale: string): string {
  const [year, month, day] = date.split("-").map(Number)
  return day && month ? formatDate(new Date(year, month - 1, day), locale) : date
}

/** Quantos nomes uma lista curta mostra (nos avisos); o resto vira "e mais N". */
const TITLES_SHOWN = 5

/** Os primeiros nomes e quantos faltam: "A, B, C, D, E e mais 2" (ou "... and 2 more"). */
export function listTitles(titles: string[], t: Messages): string {
  const shown = titles.slice(0, TITLES_SHOWN).join(", ")
  const rest = titles.length - TITLES_SHOWN
  return rest > 0 ? t.common.andMore(shown, rest) : shown
}

/** Meia-noite do dia da data (em milissegundos), para contar dias de calendário. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Dia, mês e ano com dois dígitos, na ordem do idioma: "01/08/2026" ou "08/01/2026". */
function formatDate(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" })
}

/** Data e hora de um momento (ISO), no formato do idioma: "22/09/2026, 21:30" ou "9/22/26, 9:30 PM". */
export function formatDateTime(isoDate: string, locale: string): string {
  return new Date(isoDate).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })
}

/** Só a hora de um momento (ISO), no formato do idioma: "21:30" ou "9:30 PM". */
export function formatTime(isoDate: string, locale: string): string {
  return new Date(isoDate).toLocaleTimeString(locale, { timeStyle: "short" })
}
