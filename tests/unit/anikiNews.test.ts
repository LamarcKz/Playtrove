import { describe, expect, it, vi } from "vitest"
import { DEFAULT_ANIKI_NEWS, type AnikiNewsApi, type AnikiNewsSnapshot, type AnikiNewsSource } from "@shared/anikiNews"
import { AnikiNewsReader } from "../../src/renderer/lib/anikiNews"

function snapshot(source: AnikiNewsSource, title: string): AnikiNewsSnapshot {
  return { source, title: source, configuredUrl: "https://example.com/feed", resolvedUrl: "https://example.com/feed", lastRefreshAt: null, fromCache: true, stale: true, error: null,
    items: [{ id: title, title, publishedAt: "2026-10-28T12:00:00Z", url: "https://example.com/article", contentText: "Article text", summary: "Summary", imageDataUrl: null }] }
}
function fakeApi(overrides: Partial<AnikiNewsApi> = {}): AnikiNewsApi {
  return { getConfig: vi.fn(async () => DEFAULT_ANIKI_NEWS), setConfig: vi.fn(async (config) => config), read: vi.fn(async (source) => snapshot(source, "Cached")), refresh: vi.fn(async (source) => snapshot(source, "Fresh")), cancel: vi.fn(async () => undefined), openArticle: vi.fn(async () => undefined), ...overrides }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe("leitor RSS do Aniki", () => {
  it("mostra cache antes da consulta e conserva o artigo ao atualizar", async () => {
    const request = deferred<AnikiNewsSnapshot>()
    const api = fakeApi({ refresh: vi.fn(() => request.promise) })
    const reader = new AnikiNewsReader(api)
    const pending = reader.load("A")
    await vi.waitFor(() => expect(reader.state.snapshot?.items[0].title).toBe("Cached"))
    expect(reader.state.pending).toBe(true)
    reader.select("Cached")
    request.resolve({ ...snapshot("A", "Cached"), stale: false })
    await pending
    expect(reader.state.selectedId).toBe("Cached")
    expect(reader.state.pending).toBe(false)
    reader.dispose()
  })

  it("cancela a fonte anterior e ignora conclusão atrasada depois da troca", async () => {
    const old = deferred<AnikiNewsSnapshot>()
    const api = fakeApi({ refresh: vi.fn((source) => source === "A" ? old.promise : Promise.resolve(snapshot("B", "Current"))) })
    const reader = new AnikiNewsReader(api)
    const first = reader.load("A")
    await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledOnce())
    await reader.load("B")
    expect(api.cancel).toHaveBeenCalledOnce()
    old.resolve(snapshot("A", "Late"))
    await first
    expect(reader.state.source).toBe("B")
    expect(reader.state.snapshot?.items[0].title).toBe("Current")
    reader.dispose()
  })

  it("ignora também uma leitura de disco atrasada da fonte anterior", async () => {
    const old = deferred<AnikiNewsSnapshot>()
    const api = fakeApi({ read: vi.fn((source) => source === "A" ? old.promise : Promise.resolve(snapshot("B", "Current"))) })
    const reader = new AnikiNewsReader(api)
    const first = reader.load("A")
    await vi.waitFor(() => expect(api.read).toHaveBeenCalledOnce())
    await reader.load("B")
    old.resolve(snapshot("A", "Late cache"))
    await first
    expect(reader.state.snapshot?.source).toBe("B")
    reader.dispose()
  })

  it("cancelar conserva cache; falha mantém artigo e código seguro; dispose cancela e não publica", async () => {
    const request = deferred<AnikiNewsSnapshot>()
    const api = fakeApi({ refresh: vi.fn(() => request.promise) })
    const reader = new AnikiNewsReader(api)
    const pending = reader.load("A", true)
    await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledOnce())
    reader.cancel()
    request.reject("fetch")
    await pending
    expect(reader.state.snapshot?.items[0].title).toBe("Cached")
    expect(reader.state.error).toBeNull()
    const next = reader.load("A", true)
    await next
    expect(reader.state.error).toBe("fetch")
    expect(reader.state.snapshot?.items).toHaveLength(1)
    const changes = vi.fn()
    reader.subscribe(changes)
    const disposed = reader.load("B", true)
    reader.dispose()
    const count = changes.mock.calls.length
    await disposed
    expect(changes).toHaveBeenCalledTimes(count)
  })

  it("desabilitado não consulta feeds e abre o original apenas pelo ID selecionado", async () => {
    const api = fakeApi({ getConfig: vi.fn(async () => ({ ...DEFAULT_ANIKI_NEWS, enabled: false })) })
    const reader = new AnikiNewsReader(api)
    await reader.load("A")
    expect(reader.state.enabled).toBe(false)
    expect(api.refresh).not.toHaveBeenCalled()
    reader.dispose()
    const enabled = fakeApi()
    const active = new AnikiNewsReader(enabled)
    await active.load("A")
    active.select("missing")
    expect(active.state.selectedId).toBe("Fresh")
    await active.openOriginal()
    expect(enabled.openArticle).toHaveBeenCalledWith("A", "Fresh")
    active.dispose()
  })

  it("salva preferências pela API, cancela consulta anterior e não altera config se a gravação falhar", async () => {
    let config = structuredClone(DEFAULT_ANIKI_NEWS)
    const api = fakeApi({ getConfig: vi.fn(async () => config), setConfig: vi.fn(async (next) => { config = next; return next }) })
    const reader = new AnikiNewsReader(api)
    await reader.load("A")
    const next = { ...config, enabled: false, sourceA: { title: "Custom", url: "https://example.com/custom.xml" } }
    await reader.saveConfig(next)
    expect(api.setConfig).toHaveBeenCalledWith(next)
    expect(reader.state.config).toEqual(next)
    expect(reader.state.enabled).toBe(false)
    vi.mocked(api.setConfig).mockRejectedValueOnce("storage")
    await expect(reader.saveConfig(DEFAULT_ANIKI_NEWS)).rejects.toBe("storage")
    expect(reader.state.config).toEqual(next)
    reader.dispose()
  })
})
