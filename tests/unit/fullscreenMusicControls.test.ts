import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FullscreenMusicControls, type FullscreenMusicOptions } from "../../src/renderer/lib/fullscreenMusicControls"
import { ThemeMusicPlayer, type ThemeMusicAudio } from "../../src/renderer/lib/themeMusicPlayer"

function audioOutput() {
  const audio = {
    src: "", loop: false, volume: 1, currentTime: 0, duration: 180, muted: false, playing: false as boolean,
    play: async () => { audio.playing = true }, pause: () => { audio.playing = false },
    load: () => { audio.currentTime = 0 }, removeAttribute: () => { audio.src = "" },
  } satisfies ThemeMusicAudio & { duration: number; muted: boolean; playing: boolean }
  return audio
}

const ready: FullscreenMusicOptions = { url: "/track-a.wav", context: "library", gameTitle: "Jogo A", enabled: true, suspended: false, volume: 20 }

describe("transporte do único player da tela cheia", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("pausa e retoma o player existente preservando posição e ouvindo o estado real", async () => {
    const audio = audioOutput()
    const controls = new FullscreenMusicControls()
    const player = new ThemeMusicPlayer(audio, (state) => connection.playback(state))
    const connection = controls.connect(player, audio)
    connection.update(ready); player.update(ready)
    await vi.advanceTimersByTimeAsync(800)
    audio.currentTime = 42; connection.refresh()
    expect(controls.getSnapshot()).toMatchObject({ playing: true, available: true, position: 42, duration: 180, gameTitle: "Jogo A" })
    expect(controls.toggle()).toBe(true)
    expect(audio.playing).toBe(false)
    expect(audio.currentTime).toBe(42)
    await vi.advanceTimersByTimeAsync(1000)
    expect(audio.playing).toBe(false)
    expect(controls.toggle()).toBe(true)
    await Promise.resolve()
    expect(audio.playing).toBe(true)
    expect(controls.getSnapshot().playing).toBe(true)
    connection.dispose(); player.dispose()
    expect(controls.getSnapshot().available).toBe(false)
  })

  it("silencia sem pausar nem mudar o volume configurado e acompanha ajustes de volume", async () => {
    const audio = audioOutput()
    const controls = new FullscreenMusicControls()
    const player = new ThemeMusicPlayer(audio, (state) => connection.playback(state))
    const connection = controls.connect(player, audio)
    connection.update(ready); player.update(ready)
    await vi.advanceTimersByTimeAsync(800)
    expect(controls.toggleMute()).toBe(true)
    expect(audio.muted).toBe(true)
    expect(audio.playing).toBe(true)
    expect(audio.volume).toBeCloseTo(0.2)
    connection.update({ ...ready, volume: 60 }); player.update({ ...ready, volume: 60 })
    await vi.advanceTimersByTimeAsync(500)
    expect(controls.getSnapshot()).toMatchObject({ volume: 60, muted: true })
    expect(audio.volume).toBeCloseTo(0.6)
    controls.toggleMute()
    expect(audio.muted).toBe(false)
    expect(audio.volume).toBeCloseTo(0.6)
    connection.dispose(); player.dispose()
  })

  it("respeita suspensão, música desligada e ausência de faixa sem ressuscitar reprodução", async () => {
    const audio = audioOutput()
    const controls = new FullscreenMusicControls()
    const player = new ThemeMusicPlayer(audio, (state) => connection.playback(state))
    const connection = controls.connect(player, audio)
    connection.update(ready); player.update(ready)
    await vi.advanceTimersByTimeAsync(800)
    for (const options of [{ ...ready, suspended: true }, { ...ready, enabled: false }, { ...ready, url: null }]) {
      connection.update(options); player.update(options)
      expect(controls.toggle()).toBe(false)
      await vi.advanceTimersByTimeAsync(1000)
      expect(audio.playing).toBe(false)
      expect(controls.getSnapshot().playing).toBe(false)
    }
    connection.dispose(); player.dispose()
  })

  it("mostra a faixa efetivamente ativa durante uma troca rápida com rampa", async () => {
    const audio = audioOutput()
    const controls = new FullscreenMusicControls()
    const player = new ThemeMusicPlayer(audio, (state) => connection.playback(state))
    const connection = controls.connect(player, audio)
    connection.update(ready); player.update(ready)
    await vi.advanceTimersByTimeAsync(800)
    const hub = { ...ready, url: "/hub.mp3", context: "hub" as const, gameTitle: null }
    connection.update(hub); player.update(hub)
    await vi.advanceTimersByTimeAsync(200)
    const secondary = { ...hub, url: "/secondary.mp3", context: "secondary" as const }
    connection.update(secondary); player.update(secondary)
    expect(controls.getSnapshot()).toMatchObject({ context: "library", gameTitle: "Jogo A" })
    await vi.advanceTimersByTimeAsync(300)
    connection.refresh()
    expect(audio.src).toBe("/secondary.mp3")
    expect(controls.getSnapshot()).toMatchObject({ context: "secondary", gameTitle: null })
    connection.dispose(); player.dispose()
  })

  it("cleanup antigo não apaga o player que reassumiu o elemento no StrictMode", () => {
    const audio = audioOutput()
    const controls = new FullscreenMusicControls()
    const first = controls.connect({ toggle: () => {} }, audio)
    first.update(ready)
    const second = controls.connect({ toggle: () => {} }, audio)
    second.update({ ...ready, context: "hub", gameTitle: null })
    first.dispose()
    audio.src = ready.url!
    second.refresh()
    expect(controls.getSnapshot()).toMatchObject({ available: true, context: "hub" })
    second.dispose()
    expect(controls.getSnapshot().available).toBe(false)
  })

  it("notifica a interface sobre progresso real e para de notificar ao remover a assinatura", () => {
    const audio = audioOutput()
    const controls = new FullscreenMusicControls()
    const connection = controls.connect({ toggle: () => {} }, audio)
    const positions: number[] = []
    const stop = controls.subscribe(() => positions.push(controls.getSnapshot().position))
    connection.update(ready)
    audio.src = ready.url!
    audio.currentTime = 15
    connection.refresh()
    expect(positions).toContain(15)
    stop()
    const count = positions.length
    audio.currentTime = 16
    connection.refresh()
    expect(positions).toHaveLength(count)
    expect(controls.getSnapshot().position).toBe(16)
    connection.dispose()
  })
})
