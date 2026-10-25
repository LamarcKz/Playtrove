import { describe, expect, it, vi } from "vitest"
import type { MusicConfig } from "@shared/types"
import { MusicConfigSaveQueue } from "../../src/renderer/lib/musicConfigSaveQueue"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const initial: MusicConfig = { enabled: true, volume: 20, autoDownload: true }

describe("salvamento das preferências de música entre telas", () => {
  it("trocar de tela cancela volumes ainda na fila e a nova mudança conserva o volume já salvo", async () => {
    let stored = initial
    const firstWrite = deferred<void>()
    const started = deferred<void>()
    const writes: MusicConfig[] = []
    const queue = new MusicConfigSaveQueue({
      getConfig: async () => stored,
      setConfig: async (value) => {
        writes.push(value)
        if (writes.length === 1) {
          started.resolve()
          await firstWrite.promise
        }
        stored = value
        return stored
      },
    })
    const library = queue.createSession()
    const dragging = library.save({ volume: 30 })
    await started.promise
    const obsolete = library.save({ volume: 70 })
    library.dispose()
    const settings = queue.createSession()
    const disabled = settings.save({ enabled: false })
    firstWrite.resolve()
    await Promise.all([dragging, obsolete, disabled])

    expect(await obsolete).toBeNull()
    expect(writes).toEqual([
      { ...initial, volume: 30 },
      { ...initial, volume: 30, enabled: false },
    ])
    expect(stored).toEqual({ ...initial, volume: 30, enabled: false })
  })

  it("mudanças de duas instâncias ativas aplicam somente seus campos sobre a preferência mais recente", async () => {
    let stored = initial
    const queue = new MusicConfigSaveQueue({
      getConfig: async () => stored,
      setConfig: async (value) => { stored = value; return stored },
    })
    const library = queue.createSession()
    const settings = queue.createSession()
    await Promise.all([
      settings.save({ enabled: false }),
      library.save({ volume: 65 }),
      settings.save({ autoDownload: false }),
    ])
    expect(stored).toEqual({ enabled: false, volume: 65, autoDownload: false })
  })

  it("desmontar durante a leitura anterior ao save impede iniciar aquela gravação", async () => {
    const reading = deferred<MusicConfig>()
    const started = deferred<void>()
    const setConfig = vi.fn(async (value: MusicConfig) => value)
    const queue = new MusicConfigSaveQueue({
      getConfig: () => { started.resolve(); return reading.promise },
      setConfig,
    })
    const session = queue.createSession()
    const save = session.save({ volume: 80 })
    await started.promise
    session.dispose()
    reading.resolve(initial)
    expect(await save).toBeNull()
    expect(setConfig).not.toHaveBeenCalled()
  })

  it("uma gravação rejeitada não impede salvar na tela seguinte", async () => {
    const queue = new MusicConfigSaveQueue({
      getConfig: async () => initial,
      setConfig: vi.fn()
        .mockRejectedValueOnce(new Error("disco"))
        .mockImplementationOnce(async (value: MusicConfig) => value),
    })
    await expect(queue.createSession().save({ volume: 70 })).rejects.toThrow("disco")
    await expect(queue.createSession().save({ enabled: false })).resolves.toEqual({ ...initial, enabled: false })
  })
})
