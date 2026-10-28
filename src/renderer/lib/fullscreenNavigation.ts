import type { ControllerButton } from "@shared/controllers"

/** Botões com duas ações, como no Aniki: o toque age ao soltar; segurar dispara a segunda ação. */
const holdable = ["options", "create", "triangle"] as const
type HoldableButton = (typeof holdable)[number]
/** "window" vem só do teclado (F11): volta ao modo janela. */
export type FullscreenAction = ControllerButton | `${HoldableButton}-hold` | "window"
export type FullscreenCollection = "all" | "recent" | "favorites"
interface InputSnapshot { sequence: number; generation: number; controllerKey: number | null; buttons: string[] }
const directions = new Set(["up", "down", "left", "right"])
/** Tempo de segurar do Aniki (RunTapOrHoldCommand, holdDelayMs). */
export const FULLSCREEN_HOLD_MS = 500
const isHoldable = (button: string): button is HoldableButton => (holdable as readonly string[]).includes(button)
/** Arestas de ação, toque/segurar e repetição direcional, com uma barreira neutra em cada troca de contexto. */
export class FullscreenInput {
  private sequence = -1
  private generation = -1
  private armed = false
  private held: string[] = []
  private nextRepeat = 0
  private pressedAt = new Map<HoldableButton, number>()
  private fired = new Set<HoldableButton>()
  get neutral() { return this.armed && this.held.length === 0 }
  reset(neutral = false) { this.armed = neutral; this.held = []; this.pressedAt.clear(); this.fired.clear() }
  update(snapshot: InputSnapshot, now: number): FullscreenAction[] {
    if (snapshot.sequence <= this.sequence || snapshot.generation < this.generation) return []
    this.sequence = snapshot.sequence
    if (snapshot.generation !== this.generation) { this.generation = snapshot.generation; this.reset() }
    if (snapshot.controllerKey === null) { this.reset(); return [] }
    if (!this.armed) {
      if (!snapshot.buttons.length) { this.armed = true; this.held = [] }
      return []
    }
    const edges = snapshot.buttons.filter((button) => !this.held.includes(button))
    const released = this.held.filter((button) => !snapshot.buttons.includes(button))
    this.held = snapshot.buttons
    const actions: FullscreenAction[] = []
    for (const button of released) {
      if (!isHoldable(button) || !this.pressedAt.has(button)) continue
      if (!this.fired.has(button)) actions.push(button)
      this.pressedAt.delete(button)
      this.fired.delete(button)
    }
    for (const button of edges) {
      if (isHoldable(button)) this.pressedAt.set(button, now)
      else actions.push(button as FullscreenAction)
    }
    if (edges.some((button) => directions.has(button))) this.nextRepeat = now + 400
    return actions
  }
  repeat(now: number): FullscreenAction[] {
    if (!this.armed) return []
    const actions: FullscreenAction[] = []
    for (const [button, at] of this.pressedAt) {
      if (this.fired.has(button) || now - at < FULLSCREEN_HOLD_MS) continue
      this.fired.add(button)
      actions.push(`${button}-hold`)
    }
    if (now >= this.nextRepeat) {
      const repeated = this.held.filter((button) => directions.has(button)) as FullscreenAction[]
      if (repeated.length) { this.nextRepeat = now + 100; actions.push(...repeated) }
    }
    return actions
  }
}
export function fullscreenGames<T extends { title: string; favorite: boolean; lastPlayedAt: string | null }>(games: T[], collection: FullscreenCollection, query: string): T[] {
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
  if (query.trim()) return games.filter((game) => normalize(game.title).includes(normalize(query.trim())))
  if (collection === "favorites") return games.filter((game) => game.favorite)
  if (collection === "recent") return games.filter((game) => game.lastPlayedAt && Date.now() - Date.parse(game.lastPlayedAt) < 30 * 86400000).sort((a, b) => Date.parse(b.lastPlayedAt!) - Date.parse(a.lastPlayedAt!))
  return games
}
/** As ordens da biblioteca do tema Playtrove; "collection" mantém a da coleção (Recentes pela última vez jogado). */
export const FULLSCREEN_SORTS = ["collection", "name", "lastPlayed", "playtime", "added", "rating"] as const
export type FullscreenSort = (typeof FULLSCREEN_SORTS)[number]
/** Ordena sem mudar a lista recebida; empates e jogos sem o dado ficam pelo nome. */
export function sortFullscreenGames<T extends { title: string; lastPlayedAt: string | null; playtimeMinutes: number; addedAt: string; rating: number | null }>(games: T[], sort: FullscreenSort, locale: string): T[] {
  if (sort === "collection") return games
  const byName = (a: T, b: T) => a.title.localeCompare(b.title, locale, { sensitivity: "base" })
  const time = (value: string | null) => (value ? Date.parse(value) : -Infinity)
  const newer = (a: number, b: number) => (a === b ? 0 : a > b ? -1 : 1)
  const compare: Record<Exclude<FullscreenSort, "collection">, (a: T, b: T) => number> = {
    name: byName,
    lastPlayed: (a, b) => newer(time(a.lastPlayedAt), time(b.lastPlayedAt)) || byName(a, b),
    playtime: (a, b) => b.playtimeMinutes - a.playtimeMinutes || byName(a, b),
    added: (a, b) => newer(time(a.addedAt), time(b.addedAt)) || byName(a, b),
    rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byName(a, b),
  }
  return [...games].sort(compare[sort])
}
/** Com a troca ligada, ○ confirma e × volta (só no controle; Enter e Esc continuam iguais). */
export function swapConfirmAction(action: FullscreenAction): FullscreenAction {
  return action === "cross" ? "circle" : action === "circle" ? "cross" : action
}
export function restoreFullscreenSelection(games: { id: number }[], id: number | null): number | null {
  return games.some((game) => game.id === id) ? id : games[0]?.id ?? null
}

/** Consome a direção só enquanto o texto focado ainda consegue rolar naquela direção. */
export function scrollFullscreenText(panel: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">, direction: FullscreenAction): boolean {
  if (direction !== "up" && direction !== "down") return false
  const maximum = Math.max(0, panel.scrollHeight - panel.clientHeight)
  const step = Math.max(48, panel.clientHeight * .65)
  const next = Math.max(0, Math.min(maximum, panel.scrollTop + (direction === "down" ? step : -step)))
  if (Math.abs(next - panel.scrollTop) < 1) return false
  panel.scrollTop = next
  return true
}
