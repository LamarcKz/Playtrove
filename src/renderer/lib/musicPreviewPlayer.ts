import type { AppApi } from "@shared/ipc"

type PreviewAudio = Pick<HTMLAudioElement, "src" | "volume" | "play" | "pause" | "load" | "removeAttribute">
export interface MusicPreviewState { videoId: string | null; loading: boolean; playing: boolean; failed: boolean }
const listeners = new Set<(active: boolean) => void>()
let previewOwner: MusicPreviewPlayer | null = null
const audioOwners = new WeakMap<PreviewAudio, MusicPreviewPlayer>()

/** A suspensão é síncrona, antes de iniciar o áudio, sem mudar a pausa manual do ambiente. */
export function onMusicPreviewChange(callback: (active: boolean) => void) {
  listeners.add(callback)
  callback(previewOwner !== null)
  return () => { listeners.delete(callback) }
}

export class MusicPreviewPlayer {
  private revision = 0
  private disposed = false
  private cancellation: Promise<void> = Promise.resolve()
  private requested = false
  private operation: Promise<string> | null = null
  constructor(private audio: PreviewAudio, private api: Pick<AppApi["music"], "preview" | "cancelPreview">,
    private change: (state: MusicPreviewState) => void) { audioOwners.set(audio, this) }

  async listen(gameId: number, generation: string, videoId: string, volume: number) {
    if (this.disposed) return
    const cancelled = this.stop()
    const previous = previewOwner?.stop()
    previewOwner = this
    listeners.forEach((notify) => notify(true))
    const revision = ++this.revision
    this.setVolume(volume)
    this.change({ videoId, loading: true, playing: false, failed: false })
    try {
      await cancelled
      await previous
      if (this.disposed || revision !== this.revision) return
      this.requested = true
      this.operation = this.api.cancelPreview()
      const operationId = await this.operation
      if (this.disposed || revision !== this.revision) return
      const preview = await this.api.preview(gameId, generation, videoId, operationId)
      if (this.disposed || revision !== this.revision) return
      this.audio.src = preview.url
      this.audio.load()
      await this.audio.play()
      if (this.disposed || revision !== this.revision) {
        if (audioOwners.get(this.audio) === this && previewOwner !== this) this.audio.pause()
        return
      }
      this.change({ videoId, loading: false, playing: true, failed: false })
    } catch {
      if (this.disposed || revision !== this.revision) return
      this.stop()
      this.change({ videoId, loading: false, playing: false, failed: true })
    }
  }

  setVolume(volume: number) { this.audio.volume = Math.max(0, Math.min(100, volume)) / 100 }

  reportError() {
    void this.stop()
    if (!this.disposed) this.change({ videoId: null, loading: false, playing: false, failed: true })
  }

  /** Confirmação reutiliza o arquivo da prévia; a limpeza continua no fechamento e nas interrupções. */
  async prepareChoice() {
    this.stopAudio()
    const revision = this.revision
    if (!this.requested) {
      await this.cancellation
      if (this.disposed || revision !== this.revision) return
      this.requested = true
      this.operation = this.api.cancelPreview()
    }
    const operationId = await this.operation
    if (this.disposed || revision !== this.revision) return
    return operationId ?? undefined
  }

  stop() {
    this.stopAudio()
    if (this.requested) {
      this.requested = false
      this.operation = null
      this.cancellation = this.api.cancelPreview().then(() => {}).catch(() => {})
    }
    return this.cancellation
  }

  private stopAudio() {
    this.revision++
    this.audio.pause()
    this.audio.removeAttribute("src")
    this.audio.load()
    if (previewOwner === this) {
      previewOwner = null
      listeners.forEach((notify) => notify(false))
    }
    if (!this.disposed) this.change({ videoId: null, loading: false, playing: false, failed: false })
  }

  dispose() { void this.stop(); this.disposed = true }
}
