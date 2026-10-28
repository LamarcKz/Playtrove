import { useEffect, useState } from "react"
import { useI18n } from "@/hooks/useI18n"

/** O relógio da barra do topo da tela cheia (horas e minutos no formato do idioma). */
export function FullscreenClock({ className }: { className: string }) {
  const { t } = useI18n()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(timer)
  }, [])
  return <time className={className} dateTime={now.toISOString()}>{now.toLocaleTimeString(t.locale, { hour: "2-digit", minute: "2-digit" })}</time>
}
