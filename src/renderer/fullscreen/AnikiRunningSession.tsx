import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import type { RunningSession } from "@shared/gameSession"
import type { Game } from "@shared/types"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { useI18n } from "@/hooks/useI18n"
import { errorMessage } from "@/lib/errors"
import { formatDateTime } from "@/lib/format"
import { AnikiIcon } from "./AnikiGlyph"

function sameSession(left: RunningSession, right: RunningSession) {
  return left.gameId === right.gameId && left.processId === right.processId && left.startedAt === right.startedAt
}

/** Confere a identidade atual antes da ação e serializa pedidos de controle da sessão. */
export class RunningSessionActionGuard {
  private busy = false
  constructor(private readonly readSessions: () => Promise<RunningSession[]>) {}
  get pending() { return this.busy }

  async run(session: RunningSession, operation: () => Promise<unknown>): Promise<"done" | "busy" | "ended" | "unavailable"> {
    if (this.busy) return "busy"
    this.busy = true
    try {
      const current = (await this.readSessions()).find((item) => sameSession(item, session))
      if (!current) return "ended"
      if (!current.canControl) return "unavailable"
      await operation()
      return "done"
    } finally { this.busy = false }
  }
}

export interface AnikiRunningSessionHandle { back: () => void }
interface Props { runningIds: number[]; focused: boolean; games: Game[]; ref?: Ref<AnikiRunningSessionHandle> }

/** As sessões continuam pertencendo ao Launcher; este painel só retoma ou pede fechamento. */
export function AnikiRunningSession({ runningIds, focused, games, ref }: Props) {
  const { t } = useI18n()
  const { config } = useFullscreenConfig()
  const [sessions, setSessions] = useState<RunningSession[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState<RunningSession | null>(null)
  const [requested, setRequested] = useState<RunningSession[]>([])
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const resumes = useRef(new Map<number, HTMLButtonElement>())
  const lastFocused = useRef<number | null>(null)
  const mounted = useRef(false)
  const revision = useRef(0)
  const loadedIds = useRef<string | null>(null)
  const guard = useRef<RunningSessionActionGuard | null>(null)
  if (!guard.current) guard.current = new RunningSessionActionGuard(window.api.games.getRunningSessions)
  const idsKey = runningIds.join(",")
  const visible = sessions.filter((session) => runningIds.includes(session.gameId))
  const rowsKey = visible.map((session) => session.gameId).join(",")

  const refresh = useCallback(async () => {
    const request = ++revision.current
    setLoading(true)
    try {
      const next = await window.api.games.getRunningSessions()
      if (!mounted.current || request !== revision.current) return
      setSessions(next)
      setRequested((previous) => previous.filter((item) => next.some((current) => sameSession(current, item))))
      setConfirming((previous) => previous && next.some((item) => sameSession(item, previous)) ? previous : null)
      setError(null)
    } catch (reason) {
      if (mounted.current && request === revision.current) setError(errorMessage(reason))
    } finally {
      if (mounted.current && request === revision.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; revision.current++; loadedIds.current = null }
  }, [])
  useEffect(() => {
    if (focused || loadedIds.current !== idsKey) {
      loadedIds.current = idsKey
      void refresh()
    }
  }, [focused, idsKey, refresh])
  useEffect(() => {
    if (!focused || pending) return
    if (confirming) { cancel.current?.focus(); return }
    if (!root.current?.contains(document.activeElement)) {
      const previous = lastFocused.current === null ? null : resumes.current.get(lastFocused.current)
      const fallback = root.current?.querySelector<HTMLButtonElement>("[data-fs-default]:not(:disabled)") ?? root.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      if (previous && !previous.disabled) previous.focus()
      else fallback?.focus()
    }
  }, [confirming, focused, loading, pending, rowsKey])

  const run = async (session: RunningSession, action: "resume" | "close" | "overlay") => {
    if (guard.current!.pending) return
    revision.current++
    setLoading(false)
    setPending(true)
    setError(null)
    try {
      const result = await guard.current!.run(session, () => action === "resume" ? window.api.games.resume(session.gameId)
        : action === "close" ? window.api.games.requestClose(session.gameId) : window.api.gameOverlay.open(session.gameId))
      if (!mounted.current) return
      if (result === "ended" || result === "unavailable") {
        setError(result === "ended" ? t.errors.gameSessionEnded : t.errors.gameSessionControlUnavailable)
        setConfirming(null)
      } else if (result === "done" && action === "close") {
        setRequested((previous) => [...previous.filter((item) => !sameSession(item, session)), session])
        setConfirming(null)
      }
    } catch (reason) {
      if (mounted.current) setError(errorMessage(reason))
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  useImperativeHandle(ref, () => ({ back: () => {
    if (guard.current!.pending) return
    if (confirming) { setConfirming(null); setError(null); return }
    const session = visible.find((item) => item.gameId === lastFocused.current) ?? visible[0]
    if (session) void run(session, "resume")
  } }))

  const titleOf = (session: RunningSession) => games.find((game) => game.id === session.gameId)?.title ?? t.fullscreen.runningSessionUnknown
  return <section ref={root} className="aniki-running-session" data-testid="aniki-running-session" aria-busy={pending || loading}>
    {confirming ? <div className="aniki-running-session-confirm" role="alertdialog" aria-modal="true" aria-label={t.fullscreen.closeGame} aria-describedby="running-session-close-question">
      <p id="running-session-close-question">{t.fullscreen.closeGameConfirm(titleOf(confirming))}</p>
      <div className="aniki-running-session-actions aniki-menu-items">
        <button ref={cancel} type="button" data-fs-default disabled={pending} onClick={() => { setConfirming(null); setError(null) }}>{t.common.cancel}</button>
        <button type="button" disabled={pending} onClick={() => void run(confirming, "close")}>{t.fullscreen.confirmAction}</button>
      </div>
    </div> : <>
      <header className="aniki-running-session-header"><h2>{t.fullscreen.runningSessionsTitle}</h2>
        <button type="button" disabled={pending || loading} data-fs-default={visible.length === 0 ? "" : undefined} onClick={() => void refresh()}><AnikiIcon icon="refresh" />{t.fullscreen.refreshRunningSessions}</button>
      </header>
      {loading && visible.length === 0 && <p role="status">{t.fullscreen.gameSessionLoading}</p>}
      {!loading && visible.length === 0 && !error && <p>{t.fullscreen.runningSessionsEmpty}</p>}
      <div className="aniki-running-session-list">{visible.map((session, index) => <article className="aniki-running-session-card" key={session.gameId} onFocusCapture={() => { lastFocused.current = session.gameId }}>
        <h3>{titleOf(session)}</h3>
        <time dateTime={session.startedAt}>{t.fullscreen.runningSessionStarted(formatDateTime(session.startedAt, t.locale))}</time>
        <div className="aniki-running-session-actions aniki-menu-items">
          <button ref={(node) => { if (node) resumes.current.set(session.gameId, node); else resumes.current.delete(session.gameId) }} type="button" data-fs-default={index === 0 ? "" : undefined} disabled={pending || !session.canControl} onClick={() => void run(session, "resume")}><AnikiIcon icon="home" />{t.fullscreen.returnToGame}</button>
          {config?.inGameOverlayEnabled && <button type="button" disabled={pending || !session.canControl} onClick={() => void run(session, "overlay")}><AnikiIcon icon="layout" />{t.fullscreen.controlCenter}</button>}
          <button type="button" disabled={pending || !session.canControl} onClick={() => { setConfirming(session); setError(null) }}><AnikiIcon icon="exit" />{t.fullscreen.closeGame}</button>
        </div>
        {!session.canControl && <p>{t.errors.gameSessionControlUnavailable}</p>}
        {requested.some((item) => sameSession(item, session)) && <p role="status">{t.fullscreen.closeGameRequested}</p>}
      </article>)}</div>
    </>}
    {error && <p className="aniki-running-session-error" role="alert">{error}</p>}
  </section>
}
