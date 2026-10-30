/** A parte da mídia usada pelo player; os testes fornecem um áudio sem dispositivo real. */
export type ThemeMusicAudio = Pick<HTMLAudioElement, "src" | "loop" | "volume" | "play" | "pause" | "load" | "removeAttribute">

interface PlaybackOptions {
  url: string | null
  enabled: boolean
  suspended: boolean
  volume: number
}

export interface ThemeMusicPlayback {
  playing: boolean
  blocked: boolean
  failed: boolean
}

const owners = new WeakMap<ThemeMusicAudio, ThemeMusicPlayer>()

/**
 * Um único áudio acompanha a seleção da Biblioteca. Cada interrupção invalida também o play
 * assíncrono anterior: terminar uma Promise antiga não pode ressuscitar uma seleção cancelada.
 */
export class ThemeMusicPlayer {
  private options: PlaybackOptions | null = null
  private currentUrl: string | null = null
  private state: ThemeMusicPlayback = { playing: false, blocked: false, failed: false }
  private revision = 0
  private activeAttempt: number | null = null
  private delay: ReturnType<typeof setTimeout> | null = null
  private ramp: ReturnType<typeof setInterval> | null = null
  private manuallyPaused = false
  private disposed = false
  private transitioning = false

  constructor(private audio: ThemeMusicAudio, private onChange: (state: ThemeMusicPlayback) => void) {
    audio.loop = true
    owners.set(audio, this)
  }

  update(options: PlaybackOptions) {
    if (this.disposed) return
    const volumeChanged = options.volume !== this.options?.volume
    this.options = options

    if (!options.enabled || options.suspended || this.manuallyPaused || this.state.blocked) {
      this.stop()
      this.changeSource(options.url)
      return
    }

    if (options.url !== this.currentUrl) {
      if (this.state.playing) {
        if (!this.transitioning) {
          this.transitioning = true
          // A rampa consulta o alvo ao terminar: A → B → C nunca começa B por um callback antigo.
          this.rampTo(0, () => {
            this.stop()
            this.changeSource(this.options!.url)
            this.update(this.options!)
          })
        }
        return
      }
      this.stop()
      this.changeSource(options.url)
    } else if (this.transitioning) {
      // Voltar à faixa que ainda estava tocando cancela sua saída, sem reiniciá-la.
      this.transitioning = false
      this.fadeToVolume()
    }

    if (!this.canPlay() || this.state.failed) {
      this.stop()
      return
    }
    if (this.state.playing) {
      if (volumeChanged) this.fadeToVolume()
      return
    }
    if (this.activeAttempt !== null || this.delay !== null) return

    const revision = this.revision
    this.delay = setTimeout(() => {
      this.delay = null
      if (revision === this.revision && this.canPlay()) this.start()
    }, 300)
  }

  /** Chamada diretamente pelo clique, preservando a ativação de áudio do navegador. */
  toggle() {
    if (this.disposed || !this.canPlay()) return
    if (this.state.playing) {
      this.manuallyPaused = true
      this.stop()
      this.changeSource(this.options!.url)
    } else {
      this.stop()
      this.manuallyPaused = false
      this.publish({ blocked: false, failed: false })
      this.changeSource(this.options!.url)
      this.start()
    }
  }

  reportError() {
    if (this.disposed) return
    this.stop()
    this.publish({ failed: true })
  }

  dispose() {
    this.disposed = true
    this.stop()
    this.audio.removeAttribute("src")
    this.audio.load()
    if (owners.get(this.audio) === this) owners.delete(this.audio)
  }

  private canPlay() {
    return Boolean(this.options?.url && this.options.enabled && !this.options.suspended)
  }

  private stop() {
    this.revision++
    this.activeAttempt = null
    if (this.delay !== null) clearTimeout(this.delay)
    this.delay = null
    this.stopRamp()
    this.transitioning = false
    this.audio.pause()
    this.publish({ playing: false })
  }

  private start() {
    if (!this.canPlay() || this.disposed) return
    const revision = ++this.revision
    this.activeAttempt = revision
    this.audio.volume = 0
    void this.audio.play().then(() => {
      if (this.disposed || revision !== this.revision) {
        const owner = owners.get(this.audio)
        if (owner && owner !== this) return
        // Uma tentativa nova pode já estar tocando a fonte atual. Só ela tem autorização.
        if (this.activeAttempt === null) this.audio.pause()
        return
      }
      this.publish({ playing: true, blocked: false, failed: false })
      this.fadeToVolume()
    }).catch((error: unknown) => {
      if (this.disposed || revision !== this.revision) return
      this.stop()
      const failed = error instanceof Error && error.name === "NotSupportedError"
      // Alguns WebViews devolvem um Error genérico para a mesma restrição de autoplay.
      this.publish({ blocked: !failed, failed })
    })
  }

  private stopRamp() {
    if (this.ramp !== null) clearInterval(this.ramp)
    this.ramp = null
  }

  private fadeToVolume() {
    const target = Math.min(100, Math.max(0, this.options?.volume ?? 0)) / 100
    this.rampTo(target)
  }

  private changeSource(url: string | null) {
    if (url === this.currentUrl) return
    this.audio.removeAttribute("src")
    if (url) this.audio.src = url
    this.audio.load()
    this.currentUrl = url
    this.publish({ failed: false })
  }

  private rampTo(target: number, onComplete?: () => void) {
    this.stopRamp()
    const from = this.audio.volume
    const started = Date.now()
    this.ramp = setInterval(() => {
      const progress = Math.min(1, (Date.now() - started) / 500)
      this.audio.volume = from + (target - from) * progress
      if (progress === 1) {
        this.stopRamp()
        onComplete?.()
      }
    }, 25)
  }

  private publish(change: Partial<ThemeMusicPlayback>) {
    const next = { ...this.state, ...change }
    if (next.playing === this.state.playing && next.blocked === this.state.blocked && next.failed === this.state.failed) return
    this.state = next
    if (!this.disposed) this.onChange(next)
  }
}
