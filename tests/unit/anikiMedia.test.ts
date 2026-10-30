import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveAnikiMusicUrl } from "../../src/renderer/lib/anikiMedia"
import { ThemeMusicPlayer, type ThemeMusicAudio } from "../../src/renderer/lib/themeMusicPlayer"

const game = { themeMusicUrl: "http://playtrove-music.localhost/1/theme.m4a", themeMusicMode: "auto" as const }

describe("música ambiente do Aniki", () => {
  it("usa a OST local da tela sem depender da música ou da seleção de um jogo", () => {
    expect(resolveAnikiMusicUrl("login", undefined)).toBe("http://playtrove-theme.localhost/aniki/audio/LoginOST.mp3")
    expect(resolveAnikiMusicUrl("hub", game)).toBe("http://playtrove-theme.localhost/aniki/audio/HubOST.mp3")
    expect(resolveAnikiMusicUrl("secondary", { ...game, themeMusicMode: "disabled" })).toBe("http://playtrove-theme.localhost/aniki/audio/SecondaryViewsOST.mp3")
  })

  it("a proteção de tela tem sua OST própria sem reutilizar Hub, biblioteca ou telas secundárias", () => {
    expect(resolveAnikiMusicUrl("screensaver", game)).toBe("http://playtrove-theme.localhost/aniki/audio/ScreenSaverOST.mp3")
  })

  it("devolve a faixa salva na biblioteca e conserva o silêncio sem música válida", () => {
    expect(resolveAnikiMusicUrl("library", game)).toBe(game.themeMusicUrl)
    expect(resolveAnikiMusicUrl("library", undefined)).toBeNull()
    expect(resolveAnikiMusicUrl("library", { ...game, themeMusicUrl: null })).toBeNull()
    expect(resolveAnikiMusicUrl("library", { ...game, themeMusicMode: "disabled" })).toBeNull()
  })
})

function audioOutput() {
  const played: string[] = []
  const audio = {
    src: "", loop: false, volume: 1, currentTime: 0, playing: false as boolean,
    play: async () => { audio.playing = true; played.push(audio.src) },
    pause: () => { audio.playing = false },
    load: () => { audio.currentTime = 0 },
    removeAttribute: () => { audio.src = "" },
  } satisfies ThemeMusicAudio & { playing: boolean }
  return { audio, played }
}

describe("transição entre ambientes do Aniki no mesmo player", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("faz as rampas de 1,2 s e ignora um contexto abandonado antes de trocar a fonte", async () => {
    const { audio, played } = audioOutput()
    const player = new ThemeMusicPlayer(audio, () => {})
    const options = { enabled: true, suspended: false, volume: 40, transitionMs: 1200 }
    player.update({ ...options, url: resolveAnikiMusicUrl("login", game) })
    await vi.advanceTimersByTimeAsync(900)
    expect(audio.volume).toBeCloseTo(0.2)
    await vi.advanceTimersByTimeAsync(600)
    expect(audio.volume).toBeCloseTo(0.4)

    player.update({ ...options, url: resolveAnikiMusicUrl("hub", game) })
    await vi.advanceTimersByTimeAsync(600)
    expect(audio.src).toBe("http://playtrove-theme.localhost/aniki/audio/LoginOST.mp3")
    expect(audio.volume).toBeCloseTo(0.2)
    player.update({ ...options, url: resolveAnikiMusicUrl("secondary", game) })
    await vi.advanceTimersByTimeAsync(600)
    expect(audio.src).toBe("http://playtrove-theme.localhost/aniki/audio/SecondaryViewsOST.mp3")
    expect(audio.volume).toBe(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect(played).toEqual([
      "http://playtrove-theme.localhost/aniki/audio/LoginOST.mp3",
      "http://playtrove-theme.localhost/aniki/audio/SecondaryViewsOST.mp3",
    ])
    expect(audio.volume).toBeCloseTo(0.4)
    player.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("suspende uma troca pendente e restaura só a faixa atual do jogo com suas preferências", async () => {
    const { audio, played } = audioOutput()
    const player = new ThemeMusicPlayer(audio, () => {})
    const options = { enabled: true, suspended: false, volume: 20, transitionMs: 1200 }
    player.update({ ...options, url: resolveAnikiMusicUrl("hub", game) })
    await vi.advanceTimersByTimeAsync(1500)
    player.update({ ...options, url: resolveAnikiMusicUrl("secondary", game) })
    await vi.advanceTimersByTimeAsync(200)
    player.update({ ...options, url: resolveAnikiMusicUrl("library", game), suspended: true })
    await vi.advanceTimersByTimeAsync(3000)
    expect(audio.playing).toBe(false)
    expect(played).toHaveLength(1)
    player.update({ ...options, url: resolveAnikiMusicUrl("library", game), enabled: false })
    await vi.advanceTimersByTimeAsync(1500)
    expect(audio.playing).toBe(false)
    player.update({ ...options, url: resolveAnikiMusicUrl("library", game), volume: 65 })
    await vi.advanceTimersByTimeAsync(1500)
    expect(played).toEqual(["http://playtrove-theme.localhost/aniki/audio/HubOST.mp3", game.themeMusicUrl])
    expect(audio.playing).toBe(true)
    expect(audio.volume).toBeCloseTo(0.65)
    player.dispose()
    expect(audio.src).toBe("")
    expect(audio.playing).toBe(false)
  })

  it("retoma o mesmo jogo aos 17 s e o Hub em sua própria posição usando o mesmo áudio", async () => {
    const { audio, played } = audioOutput()
    const player = new ThemeMusicPlayer(audio, () => {})
    const options = { enabled: true, suspended: false, volume: 20, transitionMs: 1200 }
    player.update({ ...options, url: resolveAnikiMusicUrl("library", game), positionKey: "library" })
    await vi.advanceTimersByTimeAsync(1500)
    audio.currentTime = 17
    player.update({ ...options, url: resolveAnikiMusicUrl("hub", game), positionKey: "hub" })
    await vi.advanceTimersByTimeAsync(1500)
    audio.currentTime = 9
    player.update({ ...options, url: resolveAnikiMusicUrl("library", game), positionKey: "library" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(audio.currentTime).toBe(17)
    expect(audio.src).toBe(game.themeMusicUrl)
    player.update({ ...options, url: resolveAnikiMusicUrl("hub", game), positionKey: "hub" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(audio.currentTime).toBe(9)
    expect(played).toHaveLength(4)
    player.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("não ressuscita um contexto abandonado ao suspender e trocar as fontes rapidamente", async () => {
    const { audio, played } = audioOutput()
    const player = new ThemeMusicPlayer(audio, () => {})
    const options = { enabled: true, suspended: false, volume: 20, transitionMs: 1200 }
    player.update({ ...options, url: game.themeMusicUrl, positionKey: "library" })
    await vi.advanceTimersByTimeAsync(1500)
    audio.currentTime = 17
    player.update({ ...options, url: resolveAnikiMusicUrl("hub", game), positionKey: "hub" })
    await vi.advanceTimersByTimeAsync(200)
    player.update({ ...options, url: resolveAnikiMusicUrl("hub", game), positionKey: "hub", suspended: true })
    player.update({ ...options, url: resolveAnikiMusicUrl("secondary", game), positionKey: "secondary", suspended: true })
    player.update({ ...options, url: game.themeMusicUrl, positionKey: "library", suspended: true })
    await vi.advanceTimersByTimeAsync(3000)
    expect(audio.playing).toBe(false)
    expect(audio.currentTime).toBe(17)
    expect(played).toEqual([game.themeMusicUrl])
    player.update({ ...options, url: game.themeMusicUrl, positionKey: "library" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(audio.currentTime).toBe(17)
    expect(played).toEqual([game.themeMusicUrl, game.themeMusicUrl])
    player.dispose()
  })

  it("reinicia o Login ao perder foco e não reutiliza a posição de outro jogo", async () => {
    const { audio } = audioOutput()
    const player = new ThemeMusicPlayer(audio, () => {})
    const options = { enabled: true, suspended: false, volume: 20, transitionMs: 1200 }
    const login = { ...options, url: resolveAnikiMusicUrl("login", game), positionKey: null, resetOnSuspend: true }
    player.update(login)
    await vi.advanceTimersByTimeAsync(1500)
    audio.currentTime = 12
    player.update({ ...login, suspended: true })
    expect(audio.currentTime).toBe(0)
    player.update({ ...options, url: game.themeMusicUrl, positionKey: "library" })
    await vi.advanceTimersByTimeAsync(1500)
    audio.currentTime = 17
    player.update({ ...options, url: "/other-game.m4a", positionKey: "library" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(audio.currentTime).toBe(0)
    audio.currentTime = 5
    player.update({ ...options, url: game.themeMusicUrl, positionKey: "library" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(audio.currentTime).toBe(0)
    player.dispose()
  })

  it("aplica a posição guardada quando os metadados da fonte atual permitem buscar no áudio", async () => {
    const { audio } = audioOutput()
    const events = new EventTarget()
    let ready = false
    let position = 0
    Object.defineProperty(audio, "currentTime", {
      get: () => position,
      set: (value: number) => { if (!ready && value > 0) throw new DOMException("metadata pending", "InvalidStateError"); position = value },
    })
    audio.load = () => { ready = false; position = 0 }
    const output = Object.assign(audio, {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    })
    const metadata = () => { ready = true; events.dispatchEvent(new Event("loadedmetadata")) }
    const player = new ThemeMusicPlayer(output, () => {})
    const options = { enabled: true, suspended: false, volume: 20, transitionMs: 1200 }
    player.update({ ...options, url: game.themeMusicUrl, positionKey: "library" })
    metadata()
    await vi.advanceTimersByTimeAsync(1500)
    audio.currentTime = 17
    player.update({ ...options, url: resolveAnikiMusicUrl("hub", game), positionKey: "hub" })
    await vi.advanceTimersByTimeAsync(1500)
    metadata()
    player.update({ ...options, url: game.themeMusicUrl, positionKey: "library" })
    await vi.advanceTimersByTimeAsync(1200)
    expect(audio.currentTime).toBe(0)
    // Outra troca antes de loadedmetadata não pode gravar o zero provisório por cima dos 17 s.
    player.update({ ...options, url: resolveAnikiMusicUrl("secondary", game), positionKey: "secondary", suspended: true })
    player.update({ ...options, url: game.themeMusicUrl, positionKey: "library", suspended: true })
    metadata()
    expect(audio.currentTime).toBe(17)
    await vi.advanceTimersByTimeAsync(1500)
    expect(audio.currentTime).toBe(17)
    player.dispose()
  })
})
