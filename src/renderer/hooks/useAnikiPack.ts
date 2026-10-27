import { useCallback, useEffect, useState } from "react"
import type { AnikiPackStatus } from "@shared/fullscreen"
import { errorMessage } from "@/lib/errors"

/** O pacote do tema Aniki: estado, progresso do download e as ações de instalar, cancelar e remover. */
export function useAnikiPack() {
  const [status, setStatus] = useState<AnikiPackStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    let received = false
    const stop = window.api.themes.onAnikiProgress((next) => {
      received = true
      if (live) setStatus(next)
    })
    void window.api.themes.anikiStatus().then((next) => { if (live && !received) setStatus(next) }).catch((reason: unknown) => {
      if (live) setError(errorMessage(reason))
    })
    return () => { live = false; stop() }
  }, [])
  const install = useCallback(async () => {
    setError(null)
    try { setStatus(await window.api.themes.installAniki()) } catch (reason) { setError(errorMessage(reason)) }
  }, [])
  const cancel = useCallback(() => { void window.api.themes.cancelAniki().catch(() => {}) }, [])
  const remove = useCallback(async () => {
    setError(null)
    try { setStatus(await window.api.themes.removeAniki()) } catch (reason) { setError(errorMessage(reason)) }
  }, [])
  return { status, error, install, cancel, remove }
}
