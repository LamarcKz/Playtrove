import { describe, expect, it } from "vitest"
import type { RunningSession } from "../../src/shared/gameSession"
import { RunningSessionActionGuard } from "../../src/renderer/fullscreen/AnikiRunningSession"

const session: RunningSession = { gameId: 7, processId: 4242, startedAt: "2026-10-01T12:00:00.000Z", canControl: true }

describe("ações das sessões em execução", () => {
  it("serializa ações enquanto a identidade está sendo consultada", async () => {
    let release!: (sessions: RunningSession[]) => void
    const read = new Promise<RunningSession[]>((resolve) => { release = resolve })
    const guard = new RunningSessionActionGuard(() => read)
    let executed = 0
    const first = guard.run(session, async () => { executed++ })
    expect(guard.pending).toBe(true)
    expect(await guard.run(session, async () => { executed++ })).toBe("busy")
    expect(executed).toBe(0)
    release([session])
    expect(await first).toBe("done")
    expect(executed).toBe(1)
    expect(guard.pending).toBe(false)
  })

  it.each([
    { ...session, processId: 8181 },
    { ...session, startedAt: "2026-10-01T13:00:00.000Z" },
  ])("recusa uma confirmação antiga depois da troca da sessão", async (current) => {
    const guard = new RunningSessionActionGuard(async () => [current])
    let executed = false
    expect(await guard.run(session, async () => { executed = true })).toBe("ended")
    expect(executed).toBe(false)
  })

  it.each([
    { sessions: [], expected: "ended" },
    { sessions: [{ ...session, canControl: false }], expected: "unavailable" },
  ])("não executa quando a sessão termina ou perde o controle", async ({ sessions, expected }) => {
    const guard = new RunningSessionActionGuard(async () => sessions)
    let executed = false
    expect(await guard.run(session, async () => { executed = true })).toBe(expected)
    expect(executed).toBe(false)
    expect(guard.pending).toBe(false)
  })

  it("libera o guard após falha de leitura ou da operação", async () => {
    let failRead = true
    const guard = new RunningSessionActionGuard(async () => {
      if (failRead) throw new Error("consulta falhou")
      return [session]
    })
    await expect(guard.run(session, async () => {})).rejects.toThrow("consulta falhou")
    expect(guard.pending).toBe(false)
    failRead = false
    await expect(guard.run(session, async () => { throw new Error("ação falhou") })).rejects.toThrow("ação falhou")
    expect(guard.pending).toBe(false)
    let executed = false
    expect(await guard.run(session, async () => { executed = true })).toBe("done")
    expect(executed).toBe(true)
  })
})
