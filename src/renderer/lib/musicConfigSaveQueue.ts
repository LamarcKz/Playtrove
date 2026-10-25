import type { MusicConfig } from "@shared/types"

interface MusicConfigApi {
  getConfig: () => Promise<MusicConfig>
  setConfig: (config: MusicConfig) => Promise<MusicConfig>
}

/** Serializa saves entre telas; cada alteração envia só seu patch sobre a configuração atual. */
export class MusicConfigSaveQueue {
  private tail = Promise.resolve()

  constructor(private api: MusicConfigApi) {}

  createSession() {
    let active = true
    return {
      save: (patch: Partial<MusicConfig>): Promise<MusicConfig | null> => {
        const change = { ...patch }
        const saved = this.tail.then(async () => {
          if (!active) return null
          const current = await this.api.getConfig()
          if (!active) return null
          return this.api.setConfig({ ...current, ...change })
        })
        // Uma falha não prende os pedidos seguintes; o chamador recebe o erro original.
        this.tail = saved.then(() => undefined, () => undefined)
        return saved
      },
      // O save que já chegou ao backend termina antes de qualquer pedido da próxima tela.
      dispose: () => { active = false },
    }
  }
}
