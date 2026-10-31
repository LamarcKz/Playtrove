import { useCallback, useEffect, useRef, useState } from "react"
import { useI18n } from "@/hooks/useI18n"

export interface FullscreenNotice {
  id: number
  title: string
  description?: string
}

/** Quantos avisos a lista guarda (os mais novos primeiro). */
const KEEP = 50
/** Quanto tempo o aviso novo fica no canto da tela. */
const BANNER_MS = 4000

/**
 * Os avisos da tela cheia do tema Playtrove, como o NotificationsMenu do Playnite: conquistas novas,
 * fim de uma leva de metadados, versão nova do app e o que a própria tela avisar (ex.: biblioteca
 * atualizada). Valem só durante a sessão.
 */
export function useFullscreenNotices() {
  const { t } = useI18n()
  const [notices, setNotices] = useState<FullscreenNotice[]>([])
  const [latest, setLatest] = useState<FullscreenNotice | null>(null)
  const [seen, setSeen] = useState(0)
  const next = useRef(0)
  const push = useCallback((title: string, description?: string) => {
    const notice = { id: ++next.current, title, description }
    setNotices((list) => [notice, ...list].slice(0, KEEP))
    setLatest(notice)
  }, [])
  useEffect(() => {
    if (!latest) return
    const timer = setTimeout(() => setLatest(null), BANNER_MS)
    return () => clearTimeout(timer)
  }, [latest])
  useEffect(() => {
    const stopAchievements = window.api.achievements.onUnlocked((achievements) => {
      for (const achievement of achievements) {
        push(`${t.achievements.sources[achievement.source].unlockedToast}: ${achievement.title}`, `${achievement.gameTitle} · ${t.achievements.grades[achievement.grade]}`)
      }
    })
    let running = false
    const stopMetadata = window.api.metadata.onProgress((progress) => {
      if (running && !progress.running && progress.total > 0) push(t.metadata.downloadedFor(progress.found))
      running = progress.running
    })
    let announced: string | null = null
    const stopUpdates = window.api.updates.onStatus((status) => {
      if (status.state !== "available" || !status.version || status.version === announced) return
      announced = status.version
      push(t.updates.available(status.version))
    })
    return () => { stopAchievements(); stopMetadata(); stopUpdates() }
  }, [t, push])
  return {
    notices,
    latest,
    unseen: Math.max(0, notices.length - seen),
    push,
    markSeen: () => setSeen(notices.length),
    clear: () => { setNotices([]); setSeen(0) },
  }
}
