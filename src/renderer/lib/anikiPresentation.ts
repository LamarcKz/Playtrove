import type { AnikiScreenSaverSource } from "@shared/anikiPresentation"
import type { Game } from "@shared/types"
import { anikiAsset } from "./anikiAssets"

export type AnikiLifecycleKind = "startup" | "shutdown"

/** Sequência do Helper (MIT): probe local, sete/cinco segundos de exibição e limite de segurança de 30 segundos. */
export class AnikiLifecycleSequence {
  private generation = 0
  private active = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private onComplete: () => void) {}

  async start(kind: AnikiLifecycleKind, probe: (url: string) => Promise<boolean>, onAvailable: (url: string) => void) {
    if (this.active) return
    this.active = true
    const generation = ++this.generation
    const url = anikiAsset(`Startup Video/${kind === "startup" ? "Startup" : "Shutdown"}.mp4`)
    this.timer = setTimeout(() => this.fail(), 30000)
    let available = false
    try { available = await probe(url) } catch { /* Mídia ausente ou inválida pula a apresentação. */ }
    if (generation !== this.generation || !this.active) return
    if (!available) { this.fail(); return }
    if (this.timer !== null) clearTimeout(this.timer)
    onAvailable(url)
    this.timer = setTimeout(() => this.fail(), kind === "startup" ? 7000 : 5000)
  }

  fail() {
    if (!this.active) return
    this.cancel()
    this.onComplete()
  }

  cancel() {
    this.generation++
    this.active = false
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}

export function screenSaverDelayMs(value: number): number {
  return (value === -30 || value === -45 ? Math.abs(value) : Math.max(1, Math.min(120, value)) * 60) * 1000
}

interface IdleOptions { eligible: boolean; previewAllowed: boolean; delayMs: number }

/** A prévia pode abrir sobre configurações; jogo, perda de foco e suspensão continuam encerrando a exibição. */
export class AnikiScreenSaverIdle {
  private visible = false
  private previewMode = false
  private disposed = false
  private lastActivity = Date.now()
  private timer: ReturnType<typeof setTimeout> | null = null
  private options: IdleOptions = { eligible: false, previewAllowed: false, delayMs: 60000 }

  constructor(private onChange: (active: boolean) => void) {}

  get isVisible(): boolean { return this.visible }

  configure(options: IdleOptions) {
    if (this.disposed) this.lastActivity = Date.now()
    this.disposed = false
    this.options = options
    if (this.visible && !(this.previewMode ? options.previewAllowed : options.eligible)) this.hide()
    this.schedule()
  }

  activity(): boolean {
    if (this.disposed) return false
    const consumed = this.visible
    this.lastActivity = Date.now()
    if (consumed) this.hide()
    else this.schedule()
    return consumed
  }

  preview(): boolean {
    if (this.disposed || !this.options.previewAllowed) return false
    this.show(true)
    return true
  }

  dispose() {
    this.disposed = true
    this.clearTimer()
    if (this.visible) this.hide()
  }

  private show(preview: boolean) {
    this.clearTimer()
    this.previewMode = preview
    if (this.visible) return
    this.visible = true
    this.onChange(true)
  }

  private hide() {
    this.visible = false
    this.previewMode = false
    this.lastActivity = Date.now()
    this.onChange(false)
    this.schedule()
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule() {
    this.clearTimer()
    if (this.disposed || this.visible || !this.options.eligible) return
    this.timer = setTimeout(() => { this.timer = null; if (this.options.eligible && !this.disposed) this.show(false) }, Math.max(0, this.options.delayMs - (Date.now() - this.lastActivity)))
  }
}

const installed = (game: Game) => Boolean(game.romPath && game.emulatorId)

/** O pool por fonte é compartilhado entre seleção, abertura automática e prévia. */
export function screenSaverCandidates(games: readonly Game[], source: AnikiScreenSaverSource, filtered: readonly Game[], rejected: ReadonlySet<number> = new Set()): Game[] {
  let candidates = [...(source === "currentFilter" ? filtered : games)].filter((game) => !rejected.has(game.id))
  if (source === "installed") candidates = candidates.filter(installed)
  if (source === "favorites") candidates = candidates.filter((game) => game.favorite)
  if (source === "neverPlayed") candidates = candidates.filter((game) => game.playtimeMinutes === 0)
  if (source === "recentlyAdded") candidates = candidates.filter((game) => Number.isFinite(Date.parse(game.addedAt))).sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt)).slice(0, 100)
  return candidates
}

export function screenSaverHasBackground(games: readonly Game[], source: AnikiScreenSaverSource, filtered: readonly Game[]): boolean {
  return screenSaverCandidates(games, source, filtered).some((game) => Boolean(game.backgroundUrl))
}

/** GetCandidateGames/SelectWeighted/RegisterDisplayedGame do Aniki Helper (MIT), com os mesmos pesos e memória de dez jogos. */
export class AnikiScreenSaverSelection {
  private recent: number[] = []
  private counts = new Map<number, number>()

  pick(games: readonly Game[], source: AnikiScreenSaverSource, filtered: readonly Game[], now = new Date(), random = Math.random, rejected: ReadonlySet<number> = new Set()): Game | null {
    let candidates = screenSaverCandidates(games, source, filtered, rejected)
    const attempts = Math.min(Math.max(12, candidates.length), 80)
    for (let attempt = 0; attempt < attempts && candidates.length; attempt++) {
      let pool = candidates.filter((game) => !this.recent.includes(game.id) || source === "weighted" && candidates.length <= this.recent.length + 1)
      if (!pool.length) pool = candidates
      let selected: Game
      if (source === "weighted") {
        const weighted = pool.map((game) => {
          let weight = 1 + (installed(game) ? 3 : 0) + (game.favorite ? 2.5 : 0) + (game.playtimeMinutes === 0 ? 2 : 0) + (now.getTime() - Date.parse(game.addedAt) <= 90 * 86400000 ? 1.5 : 0)
          weight /= 1 + (this.counts.get(game.id) ?? 0) * 0.55
          return { game, weight: Math.max(0.05, weight) }
        })
        let roll = random() * weighted.reduce((sum, item) => sum + item.weight, 0)
        selected = weighted.at(-1)!.game
        for (const item of weighted) { roll -= item.weight; if (roll <= 0) { selected = item.game; break } }
      } else selected = pool[Math.floor(random() * pool.length)]
      if (!selected.backgroundUrl) { candidates = candidates.filter((game) => game.id !== selected.id); continue }
      this.recent = [...this.recent.filter((id) => id !== selected.id), selected.id].slice(-10)
      this.counts.set(selected.id, (this.counts.get(selected.id) ?? 0) + 1)
      return selected
    }
    return null
  }
}
