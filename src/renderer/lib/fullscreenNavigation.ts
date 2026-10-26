export type FullscreenAction = "up" | "down" | "left" | "right" | "cross" | "circle" | "square" | "triangle" | "l1" | "r1" | "options" | "create"
export type FullscreenCollection = "all" | "recent" | "favorites"
interface InputSnapshot { sequence: number; generation: number; controllerKey: number | null; buttons: string[] }
const directions = new Set(["up", "down", "left", "right"])
/** Arestas de ação e repetição direcional, com uma barreira neutra em cada troca de contexto. */
export class FullscreenInput {
  private sequence = -1
  private generation = -1
  private armed = false
  private held: string[] = []
  private nextRepeat = 0
  get neutral() { return this.armed && this.held.length === 0 }
  reset(neutral = false) { this.armed = neutral; this.held = [] }
  update(snapshot: InputSnapshot, now: number): FullscreenAction[] {
    if (snapshot.sequence <= this.sequence || snapshot.generation < this.generation) return []
    this.sequence = snapshot.sequence
    if (snapshot.generation !== this.generation) { this.generation = snapshot.generation; this.reset() }
    if (snapshot.controllerKey === null) { this.reset(); return [] }
    if (!snapshot.buttons.length) { this.armed = true; this.held = []; return [] }
    if (!this.armed) return []
    const edges = snapshot.buttons.filter((button) => !this.held.includes(button)) as FullscreenAction[]
    this.held = snapshot.buttons
    if (edges.some((button) => directions.has(button))) this.nextRepeat = now + 400
    return edges
  }
  repeat(now: number): FullscreenAction[] {
    if (!this.armed || now < this.nextRepeat) return []
    this.nextRepeat = now + 100
    return this.held.filter((button) => directions.has(button)) as FullscreenAction[]
  }
}
export function fullscreenGames<T extends { title: string; favorite: boolean; lastPlayedAt: string | null }>(games: T[], collection: FullscreenCollection, query: string): T[] {
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
  if (query.trim()) return games.filter((game) => normalize(game.title).includes(normalize(query.trim())))
  if (collection === "favorites") return games.filter((game) => game.favorite)
  if (collection === "recent") return games.filter((game) => game.lastPlayedAt && Date.now() - Date.parse(game.lastPlayedAt) < 30 * 86400000).sort((a, b) => Date.parse(b.lastPlayedAt!) - Date.parse(a.lastPlayedAt!))
  return games
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
