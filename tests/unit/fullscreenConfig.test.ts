import { describe, expect, it } from "vitest"
import type { FullscreenConfig } from "../../src/shared/fullscreen"
import { FullscreenConfigQueue } from "../../src/renderer/lib/fullscreenConfig"

const initial: FullscreenConfig = { theme: "playtrove", startOnLaunch: false, musicPlayback: true, musicVolume: 20, startDestination: "hub", profileName: "", profileAvatar: "gamepad", libraryLayout: "horizontal", detailsLayout: "signature", colorPreset: "default", dynamicColors: false, effects: "balanced", interface: "standard", loginScreen: false, trailers: "details", setupDone: false, coverRows: 1, showClock: true, uiSounds: true, uiSoundsVolume: 40, swapConfirm: false }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }

describe("preferências fullscreen", () => {
  it("publica o checkbox otimista antes de a escrita IPC responder", async () => {
    const request = deferred<FullscreenConfig>()
    const next = { ...initial, startOnLaunch: true }
    const state = new FullscreenConfigQueue({ setConfig: () => request.promise, getConfig: async () => next }, () => {})
    state.receive(initial)
    const saving = state.save({ startOnLaunch: true })
    expect(state.snapshot.config?.startOnLaunch).toBe(true)
    expect(state.snapshot.pending).toBe(true)
    request.resolve(next)
    await saving
    expect(state.snapshot.config).toEqual(next)
    expect(state.snapshot.pending).toBe(false)
  })
  it("serializa patches rápidos e preserva todos os campos durante eventos intercalados", async () => {
    const requests: ReturnType<typeof deferred<FullscreenConfig>>[] = []
    const patches: Partial<FullscreenConfig>[] = []
    let server = initial
    const state = new FullscreenConfigQueue({ setConfig: (patch) => { patches.push(patch); const request = deferred<FullscreenConfig>(); requests.push(request); return request.promise }, getConfig: async () => server }, () => {})
    state.receive(initial)
    const first = state.save({ startOnLaunch: true })
    const second = state.save({ musicPlayback: false, musicVolume: 35 })
    expect(patches).toEqual([{ startOnLaunch: true }])
    expect(state.snapshot.config).toEqual({ ...initial, startOnLaunch: true, musicPlayback: false, musicVolume: 35 })
    server = { ...initial, startOnLaunch: true }
    state.receive(server)
    expect(state.snapshot.config?.musicVolume).toBe(35)
    requests[0].resolve(server)
    await first
    await flush()
    expect(patches).toEqual([{ startOnLaunch: true }, { musicPlayback: false, musicVolume: 35 }])
    server = { ...server, musicPlayback: false, musicVolume: 35 }
    requests[1].resolve(server)
    await second
    expect(state.snapshot.config).toEqual(server)
  })
  it("falha reconcilia o estado real sem perder uma alteração posterior", async () => {
    const failure = deferred<FullscreenConfig>()
    let server = initial
    let calls = 0
    const state = new FullscreenConfigQueue({ setConfig: async (patch) => { if (++calls === 1) return failure.promise; server = { ...server, ...patch }; return server }, getConfig: async () => server }, () => {})
    state.receive(initial)
    const first = state.save({ startOnLaunch: true })
    const second = state.save({ musicVolume: 45 })
    failure.reject(new Error("write failed"))
    await first
    expect(state.snapshot.error).toContain("write failed")
    expect(state.snapshot.config?.startOnLaunch).toBe(false)
    expect(state.snapshot.config?.musicVolume).toBe(45)
    await second
    expect(state.snapshot.config).toEqual({ ...initial, musicVolume: 45 })
    expect(state.snapshot.pending).toBe(false)
  })
  it("resposta velha da escrita não apaga campo de evento mais recente", async () => {
    const request = deferred<FullscreenConfig>()
    let server = initial
    const state = new FullscreenConfigQueue({ setConfig: () => request.promise, getConfig: async () => server }, () => {})
    state.receive(initial)
    const saving = state.save({ startOnLaunch: true })
    server = { ...initial, startOnLaunch: true, musicVolume: 70 }
    state.receive(server)
    request.resolve({ ...initial, startOnLaunch: true })
    await saving
    expect(state.snapshot.config).toEqual(server)
  })
  it("resposta velha da reconciliação não sobrescreve evento recebido enquanto lia", async () => {
    const read = deferred<FullscreenConfig>()
    const state = new FullscreenConfigQueue({ setConfig: async () => ({ ...initial, startOnLaunch: true }), getConfig: () => read.promise }, () => {})
    state.receive(initial)
    const saving = state.save({ startOnLaunch: true })
    await flush()
    const latest = { ...initial, startOnLaunch: true, musicVolume: 65 }
    state.receive(latest)
    read.resolve({ ...initial, startOnLaunch: true })
    await saving
    expect(state.snapshot.config).toEqual(latest)
  })
})
