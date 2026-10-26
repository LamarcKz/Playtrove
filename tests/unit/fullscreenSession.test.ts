import { describe, expect, it } from "vitest"
import { FullscreenLaunchGuard } from "../../src/renderer/lib/fullscreenSession"

describe("lançamento fullscreen", () => {
  it("bloqueia dois pedidos próximos enquanto a consulta e o lançamento estão pendentes", async () => {
    const guard = new FullscreenLaunchGuard()
    const completions: (() => void)[] = []
    const requests: number[] = []
    const api = { getRunning: async () => [], play: async (id: number) => { requests.push(id); await new Promise<void>((resolve) => { completions.push(resolve) }) } }
    const first = guard.play(1, api)
    const second = guard.play(2, api)
    await Promise.resolve()
    expect(requests).toEqual([1])
    completions.forEach((finish) => finish())
    expect(await first).toBe(true)
    expect(await second).toBe(false)
  })
  it("jogo já aberto impede uma segunda sessão", async () => {
    const requests: number[] = []
    const guard = new FullscreenLaunchGuard()
    expect(await guard.play(2, { getRunning: async () => [1], play: async (id) => { requests.push(id) } })).toBe(false)
    expect(requests).toEqual([])
  })
  it("falha libera a próxima tentativa sem ocultar a rejeição", async () => {
    const guard = new FullscreenLaunchGuard()
    const api = { getRunning: async () => [], play: async () => { throw new Error("failed") } }
    await expect(guard.play(1, api)).rejects.toThrow("failed")
    expect(await guard.play(1, { ...api, play: async () => {} })).toBe(true)
  })
})
