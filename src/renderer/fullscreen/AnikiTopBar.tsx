import { useEffect, useState } from "react"
import type { Game } from "@shared/types"
import { ControllerIndicator } from "@/components/ControllerIndicator"
import { useI18n } from "@/hooks/useI18n"
import { devMark } from "@/lib/devBuild"
import { AnikiIcon } from "./AnikiGlyph"

interface Props { games: Game[]; collectionLabel: string; onSearch: () => void; onMenu: () => void }

/** Barra do topo do Aniki (interface Padrão): coleção à esquerda, atalhos no centro e o estado à direita. */
export function AnikiTopBar({ games, collectionLabel, onSearch, onMenu }: Props) {
  const { t } = useI18n()
  const trophies = games.reduce((sum, game) => sum + (game.achievements?.unlocked ?? 0), 0)
  return <header className="aniki-topbar">
    <div className="aniki-topbar-left">
      <span className="aniki-preset">{collectionLabel}</span>
      {devMark && <span title={devMark === "tests" ? t.topBar.devTestsHint : t.topBar.devHint} className="aniki-dev">{t.topBar.dev}</span>}
    </div>
    <nav className="aniki-topbar-center" aria-label={t.fullscreen.menu}>
      <button type="button" className="aniki-quick" onClick={onMenu}>{t.fullscreen.menu}</button>
      <button type="button" className="aniki-quick" onClick={onSearch}>{t.fullscreen.searchShort}</button>
    </nav>
    <div className="aniki-topbar-right">
      {trophies > 0 && <span className="aniki-status" title={t.fullscreen.trophiesUnlocked}>{trophies.toLocaleString(t.locale)}<AnikiIcon icon="trophy" /></span>}
      <ControllerIndicator />
      <AnikiClock />
    </div>
  </header>
}

function AnikiClock() {
  const { t } = useI18n()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(timer)
  }, [])
  return <time className="aniki-clock" dateTime={now.toISOString()}>{now.toLocaleTimeString(t.locale, { hour: "2-digit", minute: "2-digit" })}</time>
}
