import { useEffect, useRef, useState } from "react"
import type { MusicConfig } from "@shared/types"
import { useI18n } from "@/hooks/useI18n"
import { useToast } from "@/hooks/useToast"
import { errorMessage } from "@/lib/errors"
import { MusicConfigSaveQueue } from "@/lib/musicConfigSaveQueue"

const saves = new MusicConfigSaveQueue({
  getConfig: () => window.api.music.getConfig(),
  setConfig: (config) => window.api.music.setConfig(config),
})

/** Preferências persistidas; eventos também atualizam a Biblioteca quando a origem é outra tela. */
export function useMusicConfig() {
  const [config, setConfig] = useState<MusicConfig | null>(null)
  const current = useRef<MusicConfig | null>(null)
  const session = useRef<ReturnType<typeof saves.createSession> | null>(null)
  const pending = useRef(0)
  const lifetime = useRef(0)
  const { t } = useI18n()
  const toast = useToast()

  useEffect(() => {
    const generation = ++lifetime.current
    const owner = saves.createSession()
    session.current = owner
    let receivedEvent = false
    const apply = (value: MusicConfig) => {
      current.current = value
      setConfig(value)
    }
    const stop = window.api.music.onConfigChange((value) => {
      if (lifetime.current !== generation) return
      receivedEvent = true
      if (pending.current === 0) apply(value)
    })
    void window.api.music.getConfig().then((value) => {
      if (lifetime.current === generation && !receivedEvent && pending.current === 0) apply(value)
    }).catch((error: unknown) => {
      if (lifetime.current === generation) toast({ kind: "error", title: t.music.loadError, description: errorMessage(error) })
    })
    return () => {
      lifetime.current++
      owner.dispose()
      if (session.current === owner) session.current = null
      stop()
    }
  }, [])

  function changeConfig(patch: Partial<MusicConfig>) {
    const owner = session.current
    if (!current.current || !owner) return
    const next = { ...current.current, ...patch }
    const generation = lifetime.current
    current.current = next
    setConfig(next)
    pending.current++
    void (async () => {
      try {
        const saved = await owner.save(patch)
        if (saved && pending.current === 1 && generation === lifetime.current) {
          current.current = saved
          setConfig(saved)
        }
      } catch (error) {
        if (generation === lifetime.current) {
          toast({ kind: "error", title: t.music.configError, description: errorMessage(error) })
          if (pending.current === 1) {
            const saved = await window.api.music.getConfig().catch(() => null)
            if (saved && generation === lifetime.current) {
              current.current = saved
              setConfig(saved)
            }
          }
        }
      } finally {
        pending.current--
      }
    })()
  }

  return { config, changeConfig }
}
