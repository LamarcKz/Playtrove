interface DayObserverOptions { windowTarget?: EventTarget; documentTarget?: EventTarget }

/** Um único prazo até a próxima meia-noite local; foco/visibilidade reconciliam repouso e mudança de relógio. */
export function observeAnikiHubDay(onDay: (day: string) => void, { windowTarget = window, documentTarget = document }: DayObserverOptions = {}): () => void {
  let day = ""
  let timer: ReturnType<typeof setTimeout> | null = null
  const check = () => {
    const now = new Date()
    const current = now.toDateString()
    if (current !== day) { day = current; onDay(current) }
    if (timer !== null) clearTimeout(timer)
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    timer = setTimeout(check, Math.max(1, midnight.getTime() - now.getTime()))
  }
  windowTarget.addEventListener("focus", check)
  documentTarget.addEventListener("visibilitychange", check)
  check()
  return () => {
    if (timer !== null) clearTimeout(timer)
    windowTarget.removeEventListener("focus", check)
    documentTarget.removeEventListener("visibilitychange", check)
  }
}
