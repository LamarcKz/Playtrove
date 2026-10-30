import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AnikiLifecycleSequence, AnikiScreenSaverIdle, AnikiScreenSaverSelection, screenSaverCandidates, screenSaverDelayMs, screenSaverHasBackground } from "../../src/renderer/lib/anikiPresentation"
import { makeGame } from "./helpers"

describe("vídeos de abertura e encerramento do Aniki", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("mostra o clipe presente e conclui pelos sete/cinco segundos da fonte, sem duplicar a sequência", async () => {
    const phases: string[] = []
    const urls: string[] = []
    const sequence = new AnikiLifecycleSequence(() => phases.push("done"))
    await sequence.start("startup", async () => true, (url) => urls.push(url))
    await sequence.start("startup", async () => true, (url) => urls.push(url))
    await vi.advanceTimersByTimeAsync(6999)
    expect(phases).toEqual([])
    expect(urls).toEqual(["http://playtrove-theme.localhost/aniki/Startup%20Video/Startup.mp4"])
    await vi.advanceTimersByTimeAsync(1)
    expect(phases).toEqual(["done"])
    await sequence.start("shutdown", async () => true, (url) => urls.push(url))
    await vi.advanceTimersByTimeAsync(5000)
    expect(phases).toEqual(["done", "done"])
    expect(urls[1]).toBe("http://playtrove-theme.localhost/aniki/Startup%20Video/Shutdown.mp4")
    sequence.cancel()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("pula arquivo ausente ou inválido sem abrir overlay e cancela uma resposta antiga do probe", async () => {
    const visible: string[] = []
    let finished = 0
    const sequence = new AnikiLifecycleSequence(() => { finished++ })
    await sequence.start("startup", async () => false, (url) => visible.push(url))
    expect(finished).toBe(1)
    expect(visible).toEqual([])
    let resolve!: (value: boolean) => void
    const pending = sequence.start("startup", () => new Promise<boolean>((done) => { resolve = done }), (url) => visible.push(url))
    sequence.cancel()
    resolve(true)
    await pending
    expect(finished).toBe(1)
    expect(visible).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("encerra a espera de um probe travado e uma falha de reprodução sem prender o aplicativo", async () => {
    let finished = 0
    const sequence = new AnikiLifecycleSequence(() => { finished++ })
    void sequence.start("shutdown", () => new Promise<boolean>(() => {}), () => {})
    await vi.advanceTimersByTimeAsync(30000)
    expect(finished).toBe(1)
    await sequence.start("startup", async () => true, () => {})
    sequence.fail()
    sequence.fail()
    expect(finished).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("inatividade do screensaver do Aniki", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("abre no prazo original e consome a primeira ação que o fecha", async () => {
    const changes: boolean[] = []
    const idle = new AnikiScreenSaverIdle((active) => changes.push(active))
    idle.configure({ eligible: true, previewAllowed: true, delayMs: screenSaverDelayMs(-30) })
    await vi.advanceTimersByTimeAsync(29999)
    expect(changes).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(changes).toEqual([true])
    expect(idle.activity()).toBe(true)
    expect(idle.activity()).toBe(false)
    expect(changes).toEqual([true, false])
    await vi.advanceTimersByTimeAsync(30000)
    expect(changes).toEqual([true, false, true])
    idle.dispose()
    expect(changes.at(-1)).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("bloqueia abertura automática com painel/jogo/inatividade nativa e permite prévia explícita", async () => {
    const changes: boolean[] = []
    const idle = new AnikiScreenSaverIdle((active) => changes.push(active))
    idle.configure({ eligible: false, previewAllowed: true, delayMs: 45000 })
    await vi.advanceTimersByTimeAsync(60000)
    expect(changes).toEqual([])
    expect(idle.preview()).toBe(true)
    idle.configure({ eligible: false, previewAllowed: true, delayMs: 45000 })
    expect(changes).toEqual([true])
    idle.configure({ eligible: false, previewAllowed: false, delayMs: 45000 })
    expect(changes).toEqual([true, false])
    expect(idle.preview()).toBe(false)
    idle.dispose()
    idle.configure({ eligible: true, previewAllowed: true, delayMs: 45000 })
    await vi.advanceTimersByTimeAsync(45000)
    expect(changes.at(-1)).toBe(true)
    idle.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("seleção de fundos do screensaver do Helper", () => {
  const old = "2025-01-01T00:00:00Z"
  const now = new Date("2026-10-28T12:00:00Z")
  const games = [
    makeGame({ id: 1, title: "Instalado", backgroundUrl: "/1/background.png", favorite: true, romPath: "sample.rom", emulatorId: "retroarch", addedAt: "2026-10-20T12:00:00Z" }),
    makeGame({ id: 2, title: "Histórico", backgroundUrl: "/2/background.png", playtimeMinutes: 60, addedAt: old }),
    makeGame({ id: 3, title: "Só capa", coverUrl: "/3/cover.png", addedAt: old }),
  ]

  it("seleciona as fontes reais e não inventa fundo usando capa", () => {
    const select = () => new AnikiScreenSaverSelection()
    expect(select().pick(games, "installed", games, now, () => 0)?.id).toBe(1)
    expect(select().pick(games, "favorites", games, now, () => 0)?.id).toBe(1)
    expect(select().pick(games, "neverPlayed", games, now, () => 0)?.id).toBe(1)
    expect(select().pick(games, "currentFilter", [games[1]], now, () => 0)?.id).toBe(2)
    expect(select().pick([games[2]], "all", games, now, () => 0)).toBeNull()
    expect(select().pick(games, "all", games, now, () => 0, new Set([1]))?.id).toBe(2)
  })

  it("só habilita a prévia se o pool da fonte escolhida tiver fundo, mesmo com arte em outra fonte", () => {
    const available = makeGame({ id: 4, title: "Sem instalação", backgroundUrl: "/4/background.png" })
    const installedWithoutBackground = makeGame({ id: 5, title: "Instalado sem fundo", romPath: "sample.rom", emulatorId: "retroarch", coverUrl: "/5/cover.png" })
    expect(screenSaverCandidates([available], "installed", [available])).toEqual([])
    expect(screenSaverHasBackground([available, installedWithoutBackground], "installed", games)).toBe(false)
    expect(screenSaverHasBackground([available, installedWithoutBackground], "all", games)).toBe(true)
    expect(screenSaverHasBackground([available], "currentFilter", [])).toBe(false)
  })

  it("evita as dez últimas escolhas e aplica os pesos/penalização por exibição da fonte", () => {
    const select = new AnikiScreenSaverSelection()
    expect(select.pick(games.slice(0, 2), "weighted", games, now, () => 0.9)?.id).toBe(1)
    expect(select.pick(games.slice(0, 2), "weighted", games, now, () => 0.9)?.id).toBe(2)
    const many = Array.from({ length: 12 }, (_, index) => makeGame({ id: index + 1, title: `Jogo ${index}`, backgroundUrl: `/${index}/background.png` }))
    const varied = new AnikiScreenSaverSelection()
    expect(Array.from({ length: 13 }, () => varied.pick(many, "all", many, now, () => 0)?.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2])
  })
})
