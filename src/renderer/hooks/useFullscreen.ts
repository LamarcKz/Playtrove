import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { FullscreenConfig } from "@shared/fullscreen"
import { FullscreenConfigQueue, type FullscreenConfigState } from "@/lib/fullscreenConfig"

export function useFullscreenConfig() {
  const [state, setState] = useState<FullscreenConfigState>({ config: null, pending: false, error: null })
  const active = useRef(true)
  const queue = useRef<FullscreenConfigQueue | null>(null)
  if (!queue.current) queue.current = new FullscreenConfigQueue(window.api.fullscreen, () => {
    if (active.current) setState(queue.current!.snapshot)
  })
  useEffect(() => {
    active.current = true
    let listening = true
    let received = false
    const stop = window.api.fullscreen.onConfigChange((next) => {
      received = true
      if (listening) queue.current!.receive(next)
    })
    void window.api.fullscreen.getConfig().then((next) => {
      if (listening && !received) queue.current!.receive(next)
    }).catch((reason: unknown) => {
      if (listening) setState((current) => ({ ...current, error: String(reason) }))
    })
    return () => { listening = false; active.current = false; stop() }
  }, [])
  const save = useCallback((patch: Partial<FullscreenConfig>) => queue.current!.save(patch), [])
  return { ...state, save }
}
/** A apresentação só acompanha uma transição nativa confirmada. */
export function useFullscreenMode() {
  const [enabled, setEnabled] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const mounted = useRef(true)
  const desktopFocus = useRef<HTMLElement | null>(null)
  const previousEnabled = useRef(false)
  useLayoutEffect(() => {
    if (!enabled && previousEnabled.current && document.hasFocus()) desktopFocus.current?.focus()
    previousEnabled.current = enabled
  }, [enabled])
  const change = useCallback(async (next: boolean) => {
    if (busy.current) return
    busy.current = true
    if (next) desktopFocus.current = document.activeElement as HTMLElement
    setPending(true)
    try {
      const state = await window.api.windowControls.setFullscreen(next)
      if (mounted.current) { setEnabled(state.isFullscreen); setError(null) }
    } catch (reason) { if (mounted.current) setError(String(reason)) }
    finally { busy.current = false; if (mounted.current) setPending(false) }
  }, [])
  useEffect(() => {
    mounted.current = true
    let received = false
    const stop = window.api.windowControls.onStateChange((state) => { received = true; if (mounted.current) setEnabled(state.isFullscreen) })
    void window.api.windowControls.getState().then((state) => {
      if (!mounted.current) return
      if (!received) setEnabled(state.isFullscreen)
    }).catch((reason: unknown) => { if (mounted.current) setError(String(reason)) })
    return () => { mounted.current = false; stop() }
  }, [change])
  return { enabled, pending, error, change }
}
