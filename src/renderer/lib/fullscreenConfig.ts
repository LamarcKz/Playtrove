import type { FullscreenConfig } from "@shared/fullscreen"
interface ConfigApi {
  getConfig: () => Promise<FullscreenConfig>
  setConfig: (patch: Partial<FullscreenConfig>) => Promise<FullscreenConfig>
}
export interface FullscreenConfigState {
  config: FullscreenConfig | null
  pending: boolean
  error: string | null
}

/** Patches pendentes ficam sobre o estado confirmado, inclusive durante eventos e rollback. */
export class FullscreenConfigQueue {
  snapshot: FullscreenConfigState = { config: null, pending: false, error: null }
  private confirmed: FullscreenConfig | null = null
  private requests: { patch: Partial<FullscreenConfig>; done: () => void }[] = []
  private writing = false
  private eventRevision = 0
  private error: string | null = null

  constructor(private api: ConfigApi, private changed: () => void) {}

  receive(config: FullscreenConfig) {
    this.eventRevision++
    this.confirmed = config
    this.publish()
  }

  save(patch: Partial<FullscreenConfig>): Promise<void> {
    if (!this.confirmed) return Promise.resolve()
    const result = new Promise<void>((done) => { this.requests.push({ patch, done }) })
    this.error = null
    this.publish()
    if (!this.writing) void this.flush()
    return result
  }

  private async flush() {
    this.writing = true
    while (this.requests.length) {
      const request = this.requests[0]
      let error: string | null = null
      const beforeWrite = this.eventRevision
      try {
        const response = await this.api.setConfig(request.patch)
        if (this.eventRevision === beforeWrite) this.confirmed = response
      } catch (reason) { error = String(reason) }
      // A leitura também cobre escrita que falhou depois de já ter sido aplicada no serviço.
      const beforeRead = this.eventRevision
      try {
        const actual = await this.api.getConfig()
        if (this.eventRevision === beforeRead) this.confirmed = actual
      } catch { /* A resposta confirmada ou o último evento continuam sendo a base do rollback. */ }
      this.requests.shift()
      this.error = error
      this.publish()
      request.done()
    }
    this.writing = false
  }

  private publish() {
    let config = this.confirmed
    if (config) for (const { patch } of this.requests) config = { ...config, ...patch }
    this.snapshot = { config, pending: this.requests.length > 0, error: this.error }
    this.changed()
  }
}
