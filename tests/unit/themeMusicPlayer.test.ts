import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeMusicPlayer, type ThemeMusicAudio } from "../../src/renderer/lib/themeMusicPlayer"

function audioDouble() {
  return {
    src: "",
    loop: false,
    volume: 1,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
  } satisfies ThemeMusicAudio
}

const ready = { url: "/theme-a.wav", enabled: true, suspended: false, volume: 20 }

describe("música tema da seleção", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("ignora seleções rápidas e começa a faixa atual com uma rampa de volume", async () => {
    const audio = audioDouble()
    const player = new ThemeMusicPlayer(audio, vi.fn())
    player.update(ready)
    await vi.advanceTimersByTimeAsync(200)
    player.update({ ...ready, url: "/theme-b.wav" })
    await vi.advanceTimersByTimeAsync(299)
    expect(audio.play).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(audio.src).toBe("/theme-b.wav")
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.loop).toBe(true)
    expect(audio.volume).toBe(0)
    await vi.advanceTimersByTimeAsync(250)
    expect(audio.volume).toBeGreaterThan(0)
    expect(audio.volume).toBeLessThan(0.2)
    await vi.advanceTimersByTimeAsync(250)
    expect(audio.volume).toBeCloseTo(0.2)
    player.dispose()
  })

  it("mantém a faixa ao receber a mesma seleção e ajusta o volume sem reiniciar", async () => {
    const audio = audioDouble()
    const player = new ThemeMusicPlayer(audio, vi.fn())
    player.update(ready)
    await vi.advanceTimersByTimeAsync(800)
    const loads = audio.load.mock.calls.length
    player.update({ ...ready, volume: 60 })
    await vi.advanceTimersByTimeAsync(500)
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.load).toHaveBeenCalledTimes(loads)
    expect(audio.volume).toBeCloseTo(0.6)
    player.dispose()
  })

  it("faz a saída antes de trocar a fonte e só começa o último alvo da seleção", async () => {
    const audio = audioDouble()
    const player = new ThemeMusicPlayer(audio, vi.fn())
    player.update(ready)
    await vi.advanceTimersByTimeAsync(800)
    player.update({ ...ready, url: "/theme-b.wav" })
    await vi.advanceTimersByTimeAsync(250)
    expect(audio.src).toBe("/theme-a.wav")
    expect(audio.volume).toBeGreaterThan(0)
    expect(audio.volume).toBeLessThan(0.2)
    player.update({ ...ready, url: "/theme-c.wav" })
    await vi.advanceTimersByTimeAsync(250)
    expect(audio.src).toBe("/theme-c.wav")
    expect(audio.volume).toBe(0)
    expect(audio.play).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(300)
    expect(audio.play).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(audio.volume).toBeCloseTo(0.2)
    player.dispose()
  })

  it("retornar à faixa durante sua saída conserva a reprodução e cancela a troca", async () => {
    const audio = audioDouble()
    const player = new ThemeMusicPlayer(audio, vi.fn())
    player.update(ready)
    await vi.advanceTimersByTimeAsync(800)
    player.update({ ...ready, url: "/theme-b.wav" })
    await vi.advanceTimersByTimeAsync(250)
    player.update(ready)
    await vi.advanceTimersByTimeAsync(1000)
    expect(audio.src).toBe("/theme-a.wav")
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.volume).toBeCloseTo(0.2)
    player.dispose()
  })

  it("silencia sem faixa e cancela um play pendente ao suspender ou desmontar", async () => {
    const audio = audioDouble()
    let finish!: () => void
    audio.play.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    const changed = vi.fn()
    const player = new ThemeMusicPlayer(audio, changed)
    player.update(ready)
    await vi.advanceTimersByTimeAsync(300)
    player.update({ ...ready, suspended: true })
    const pauses = audio.pause.mock.calls.length
    finish()
    await Promise.resolve()
    expect(audio.pause.mock.calls.length).toBeGreaterThan(pauses)
    expect(changed).not.toHaveBeenLastCalledWith({ playing: true, blocked: false, failed: false })
    player.update({ ...ready, url: null })
    await vi.advanceTimersByTimeAsync(1000)
    expect(audio.play).toHaveBeenCalledTimes(1)
    player.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("um autoplay bloqueado espera um clique e só retoma com todas as condições liberadas", async () => {
    const audio = audioDouble()
    audio.play.mockRejectedValueOnce(new Error("NotAllowedError"))
    const changed = vi.fn()
    const player = new ThemeMusicPlayer(audio, changed)
    player.update(ready)
    await vi.advanceTimersByTimeAsync(1000)
    expect(changed).toHaveBeenLastCalledWith({ playing: false, blocked: true, failed: false })
    player.update({ ...ready, suspended: true })
    player.update(ready)
    await vi.advanceTimersByTimeAsync(1000)
    expect(audio.play).toHaveBeenCalledTimes(1)
    player.toggle()
    await Promise.resolve()
    expect(audio.play).toHaveBeenCalledTimes(2)
    player.update({ ...ready, enabled: false })
    player.update({ ...ready, enabled: false, suspended: true })
    player.update({ ...ready, suspended: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(audio.play).toHaveBeenCalledTimes(2)
    player.update(ready)
    await vi.advanceTimersByTimeAsync(300)
    expect(audio.play).toHaveBeenCalledTimes(3)
    player.dispose()
  })

  it("um play antigo que termina depois da troca não começa a nova faixa antes do atraso", async () => {
    const audio = audioDouble()
    let finish!: () => void
    audio.play.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const player = new ThemeMusicPlayer(audio, vi.fn())
    player.update(ready)
    await vi.advanceTimersByTimeAsync(300)
    player.update({ ...ready, url: "/theme-b.wav" })
    const pauses = audio.pause.mock.calls.length
    finish()
    await Promise.resolve()
    expect(audio.pause.mock.calls.length).toBeGreaterThan(pauses)
    await vi.advanceTimersByTimeAsync(299)
    expect(audio.play).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(audio.play).toHaveBeenCalledTimes(2)
    player.dispose()
  })

  it("o cleanup anterior do StrictMode não pausa o player que reassumiu o mesmo elemento", async () => {
    const audio = audioDouble()
    let finish!: () => void
    audio.play.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const previous = new ThemeMusicPlayer(audio, vi.fn())
    previous.update(ready)
    await vi.advanceTimersByTimeAsync(300)
    previous.dispose()
    const current = new ThemeMusicPlayer(audio, vi.fn())
    current.update(ready)
    await vi.advanceTimersByTimeAsync(800)
    const pauses = audio.pause.mock.calls.length
    finish()
    await Promise.resolve()
    expect(audio.pause).toHaveBeenCalledTimes(pauses)
    expect(audio.volume).toBeCloseTo(0.2)
    current.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("a pausa pedida pelo usuário persiste até tocar novamente, inclusive após mudar de jogo", async () => {
    const audio = audioDouble()
    const player = new ThemeMusicPlayer(audio, vi.fn())
    player.update(ready)
    await vi.advanceTimersByTimeAsync(800)
    player.toggle()
    player.update({ ...ready, url: "/theme-b.wav" })
    player.update({ ...ready, url: "/theme-b.wav", suspended: true })
    player.update({ ...ready, url: "/theme-b.wav" })
    await vi.advanceTimersByTimeAsync(1000)
    expect(audio.play).toHaveBeenCalledTimes(1)
    player.toggle()
    await Promise.resolve()
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(audio.src).toBe("/theme-b.wav")
    player.dispose()
  })
})
