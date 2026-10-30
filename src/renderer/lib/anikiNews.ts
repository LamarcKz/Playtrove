import type { AnikiNewsApi, AnikiNewsConfig, AnikiNewsError, AnikiNewsSnapshot, AnikiNewsSource } from "@shared/anikiNews"

export interface AnikiNewsReaderState {
  source: AnikiNewsSource
  enabled: boolean
  pending: boolean
  snapshot: AnikiNewsSnapshot | null
  selectedId: string | null
  error: AnikiNewsError | null
  config: AnikiNewsConfig | null
}
const ERRORS = new Set<AnikiNewsError>(["fetch", "invalidFeed", "empty", "storage", "config", "cancelled", "busy"])
export const anikiNewsError = (value: unknown): AnikiNewsError => typeof value === "string" && ERRORS.has(value as AnikiNewsError) ? value as AnikiNewsError : "fetch"
let nextReader = 0

/** Geração única por leitura: trocar de fonte/cancelar nunca publica a consulta antiga. */
export class AnikiNewsReader {
  state: AnikiNewsReaderState = { source: "A", enabled: true, pending: false, snapshot: null, selectedId: null, error: null, config: null }
  private readonly id = ++nextReader
  private generation = 0
  private requestId: string | null = null
  private disposed = false
  private readonly listeners = new Set<(state: AnikiNewsReaderState) => void>()
  constructor(private readonly api: AnikiNewsApi) {}

  subscribe(listener: (state: AnikiNewsReaderState) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(patch: Partial<AnikiNewsReaderState>) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }
  private apply(snapshot: AnikiNewsSnapshot) {
    const selectedId = snapshot.items.some((item) => item.id === this.state.selectedId) ? this.state.selectedId : snapshot.items[0]?.id ?? null
    this.publish({ snapshot, selectedId, error: snapshot.error })
  }
  async load(source: AnikiNewsSource, force = false) {
    if (this.disposed) return
    this.cancel()
    const generation = ++this.generation
    const current = () => !this.disposed && generation === this.generation
    this.publish({ source, pending: true, error: null, ...(this.state.source !== source ? { snapshot: null, selectedId: null } : {}) })
    try {
      const config = await this.api.getConfig()
      if (!current()) return
      this.publish({ enabled: config.enabled, config })
      if (!config.enabled) return
      const cached = await this.api.read(source)
      if (!current()) return
      this.apply(cached)
      const requestId = `news-${this.id}-${generation}`
      this.requestId = requestId
      const snapshot = await this.api.refresh(source, requestId, force)
      if (current()) this.apply(snapshot)
    } catch (reason) {
      if (current() && anikiNewsError(reason) !== "cancelled") this.publish({ error: anikiNewsError(reason) })
    } finally {
      if (current()) { this.requestId = null; this.publish({ pending: false }) }
    }
  }
  select(id: string) {
    if (this.state.snapshot?.items.some((item) => item.id === id)) this.publish({ selectedId: id })
  }
  async openOriginal() {
    const article = this.state.snapshot?.items.find((item) => item.id === this.state.selectedId)
    if (!article?.url) return
    try { await this.api.openArticle(this.state.source, article.id) }
    catch (reason) { this.publish({ error: anikiNewsError(reason) }) }
  }
  async saveConfig(config: AnikiNewsConfig) {
    this.cancel()
    const generation = this.generation
    const saved = await this.api.setConfig(config)
    if (this.disposed || generation !== this.generation) return
    this.publish({ config: saved, enabled: saved.enabled })
    void this.load(this.state.source)
  }
  cancel() {
    this.generation++
    if (this.requestId) void this.api.cancel(this.requestId).catch(() => undefined)
    this.requestId = null
    this.publish({ pending: false })
  }
  dispose() {
    this.cancel()
    this.disposed = true
    this.listeners.clear()
  }
}
