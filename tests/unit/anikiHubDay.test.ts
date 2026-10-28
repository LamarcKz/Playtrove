import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { observeAnikiHubDay } from "../../src/renderer/lib/anikiHubDay"

describe("virada diária do Welcome Hub", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("informa o dia inicial e a próxima meia-noite local sem emitir durante o mesmo dia", async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 23, 59, 58))
    const focus = new EventTarget()
    const visibility = new EventTarget()
    const days: string[] = []
    const stop = observeAnikiHubDay((day) => days.push(day), { windowTarget: focus, documentTarget: visibility })
    expect(days).toEqual([new Date(2026, 9, 28).toDateString()])
    focus.dispatchEvent(new Event("focus"))
    visibility.dispatchEvent(new Event("visibilitychange"))
    await vi.advanceTimersByTimeAsync(1999)
    expect(days).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(days).toEqual([new Date(2026, 9, 28).toDateString(), new Date(2026, 9, 29).toDateString()])
    expect(vi.getTimerCount()).toBe(1)
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("reconcilia o dia ao voltar do repouso e limpa timer e listeners ao sair do Hub", async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 12))
    const focus = new EventTarget()
    const visibility = new EventTarget()
    const days: string[] = []
    const stop = observeAnikiHubDay((day) => days.push(day), { windowTarget: focus, documentTarget: visibility })
    vi.setSystemTime(new Date(2026, 9, 30, 8))
    focus.dispatchEvent(new Event("focus"))
    visibility.dispatchEvent(new Event("visibilitychange"))
    expect(days).toEqual([new Date(2026, 9, 28).toDateString(), new Date(2026, 9, 30).toDateString()])
    expect(vi.getTimerCount()).toBe(1)
    stop()
    vi.setSystemTime(new Date(2026, 10, 1, 8))
    focus.dispatchEvent(new Event("focus"))
    visibility.dispatchEvent(new Event("visibilitychange"))
    await vi.advanceTimersByTimeAsync(86400000)
    expect(days).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
