export type AnikiNewsSource = "A" | "B"
export type AnikiNewsError = "fetch" | "invalidFeed" | "empty" | "storage" | "config" | "cancelled" | "busy"

export interface AnikiNewsFeed { title: string; url: string }
export interface AnikiNewsConfig { enabled: boolean; sourceA: AnikiNewsFeed; sourceB: AnikiNewsFeed }
export const DEFAULT_ANIKI_NEWS: AnikiNewsConfig = {
  enabled: true,
  sourceA: { title: "News", url: "https://gameinformer.com/news.xml" },
  sourceB: { title: "Reviews", url: "https://gameinformer.com/reviews.xml" },
}

/** O leitor usa texto, nunca HTML do feed. Imagens retornam somente como raster validado. */
export interface AnikiNewsArticle {
  id: string
  title: string
  publishedAt: string
  url: string | null
  summary: string
  contentText: string
  imageDataUrl: string | null
}
export interface AnikiNewsSnapshot {
  source: AnikiNewsSource
  title: string
  configuredUrl: string
  resolvedUrl: string
  items: AnikiNewsArticle[]
  lastRefreshAt: string | null
  fromCache: boolean
  stale: boolean
  error: AnikiNewsError | null
}
export interface AnikiNewsApi {
  getConfig(): Promise<AnikiNewsConfig>
  setConfig(config: AnikiNewsConfig): Promise<AnikiNewsConfig>
  read(source: AnikiNewsSource): Promise<AnikiNewsSnapshot>
  refresh(source: AnikiNewsSource, requestId: string, force?: boolean): Promise<AnikiNewsSnapshot>
  cancel(requestId: string): Promise<void>
  /** O backend resolve o link pelo ID no cache; a interface não encaminha URLs arbitrárias. */
  openArticle(source: AnikiNewsSource, articleId: string): Promise<void>
}

export interface AnikiNewsLabels {
  title: string
  refresh: string
  cancel: string
  back: string
  loading: string
  empty: string
  disabled: string
  cached: string
  openOriginal: string
  settings: string
  enabled: string
  sourceA: string
  sourceB: string
  feedTitle: string
  feedUrl: string
  save: string
  restoreDefaults: string
  errors: Record<AnikiNewsError, string>
}
