import type { AnikiMediaContext } from "./anikiMedia"
import type { ThemeMusicPlayback } from "./themeMusicPlayer"

export interface FullscreenMusicOptions {
  url: string | null
  context: AnikiMediaContext
  gameTitle: string | null
  enabled: boolean
  suspended: boolean
  volume: number
}

export interface FullscreenMusicSnapshot extends ThemeMusicPlayback {
  available: boolean
  enabled: boolean
  suspended: boolean
  muted: boolean
  volume: number
  position: number
  duration: number
  context: AnikiMediaContext | null
  gameTitle: string | null
}

export interface FullscreenMusicConnection {
  update: (options: FullscreenMusicOptions) => void
  playback: (state: ThemeMusicPlayback) => void
  refresh: () => void
  dispose: () => void
}

type MusicElement = Pick<HTMLAudioElement, "src" | "currentTime" | "duration" | "muted">

const EMPTY: FullscreenMusicSnapshot = {
  playing: false, blocked: false, failed: false, available: false, enabled: false, suspended: false,
  muted: false, volume: 20, position: 0, duration: 0, context: null, gameTitle: null,
}

/** Transporte sobre o único player já montado; não cria nem reproduz outro elemento de áudio. */
export class FullscreenMusicControls {
  private snapshot = EMPTY
  private listeners = new Set<() => void>()
  private muted = false
  private owner: {
    token: object
    player: { toggle: () => void }
    audio: MusicElement
    options: FullscreenMusicOptions | null
    previous: FullscreenMusicOptions | null
    playback: ThemeMusicPlayback
  } | null = null

  getSnapshot = (): FullscreenMusicSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  connect(player: { toggle: () => void }, audio: MusicElement): FullscreenMusicConnection {
    const token = {}
    audio.muted = this.muted
    this.owner = { token, player, audio, options: null, previous: null, playback: { playing: false, blocked: false, failed: false } }
    this.publish()
    const current = () => this.owner?.token === token
    return {
      update: (options) => {
        if (!current()) return
        this.owner!.previous = this.activeTrack()
        this.owner!.options = { ...options }
        this.publish()
      },
      playback: (state) => {
        if (!current()) return
        this.owner!.playback = state
        this.publish()
      },
      refresh: () => { if (current()) this.publish() },
      dispose: () => { if (current()) { this.owner = null; this.publish() } },
    }
  }

  toggle(): boolean {
    const owner = this.owner
    if (!owner?.options?.url || !owner.options.enabled || owner.options.suspended) return false
    owner.player.toggle()
    this.publish()
    return true
  }

  toggleMute(): boolean {
    if (!this.owner || !this.snapshot.available) return false
    this.muted = !this.owner.audio.muted
    this.owner.audio.muted = this.muted
    this.publish()
    return true
  }

  private activeTrack(): FullscreenMusicOptions | null {
    const owner = this.owner
    if (!owner) return null
    if (owner.audio.src && owner.options?.url === owner.audio.src) return owner.options
    if (owner.audio.src && owner.previous?.url === owner.audio.src) return owner.previous
    return owner.options?.url ? owner.options : null
  }

  private publish() {
    const owner = this.owner
    const track = this.activeTrack()
    const duration = owner && Number.isFinite(owner.audio.duration) && owner.audio.duration > 0 ? owner.audio.duration : 0
    const seconds = owner && Number.isFinite(owner.audio.currentTime) ? Math.max(0, owner.audio.currentTime) : 0
    const next: FullscreenMusicSnapshot = owner ? {
      ...owner.playback,
      available: Boolean(track),
      enabled: owner.options?.enabled ?? false,
      suspended: owner.options?.suspended ?? false,
      muted: owner.audio.muted,
      volume: Math.max(0, Math.min(100, owner.options?.volume ?? 20)),
      position: duration ? Math.min(seconds, duration) : seconds,
      duration,
      context: track?.context ?? null,
      gameTitle: track?.context === "library" ? track.gameTitle : null,
    } : { ...EMPTY, muted: this.muted }
    if (!(Object.keys(next) as (keyof FullscreenMusicSnapshot)[]).some((key) => next[key] !== this.snapshot[key])) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

export const fullscreenMusicControls = new FullscreenMusicControls()
