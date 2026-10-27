import { useEffect, useState } from "react"
import { TROPHY_GRADES } from "@shared/achievements"
import type { Game } from "@shared/types"
import { ControllerIndicator } from "@/components/ControllerIndicator"
import { TrophyIcon } from "@/components/AchievementParts"
import { useAchievementsOverview } from "@/hooks/useAchievements"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { useI18n } from "@/hooks/useI18n"
import { devMark } from "@/lib/devBuild"
import { AnikiAvatar } from "./AnikiAvatar"

interface Props { games: Game[]; hub: boolean; layoutLabel: string | null; onLayout: () => void; onHub: () => void; onProfile: () => void; onTrophies: () => void; onSearch: () => void; onMenu: () => void }

/**
 * Barra do topo do Aniki (interface Padrão): o perfil à esquerda; no centro, Hub, o layout atual, Menu e Buscar (no Hub,
 * o botão Biblioteca) — o menu fica também nos detalhes, para voltar ao modo janela de qualquer tela,
 * como no Playnite —; e, à direita, os troféus pegos de cada tipo, o controle e o relógio.
 */
export function AnikiTopBar({ games, hub, layoutLabel, onLayout, onHub, onProfile, onTrophies, onSearch, onMenu }: Props) {
  const { t } = useI18n()
  const { config } = useFullscreenConfig()
  const overview = useAchievementsOverview(games)
  const grades = TROPHY_GRADES.map((grade) => ({ grade, unlocked: overview?.games.reduce((sum, game) => sum + game.byGrade[grade].unlocked, 0) ?? 0 }))
  return <header className="aniki-topbar">
    <div className="aniki-topbar-left">
      {config && <><AnikiAvatar avatar={config.profileAvatar} size={52} /><span className="aniki-profile-name">{config.profileName || t.fullscreen.defaultProfileName}</span></>}
      {devMark && <span title={devMark === "tests" ? t.topBar.devTestsHint : t.topBar.devHint} className="aniki-dev">{t.topBar.dev}</span>}
    </div>
    <nav className="aniki-topbar-center" aria-label={t.fullscreen.menu}>
      {hub
        ? <><button type="button" className="aniki-quick" onClick={onHub}>{t.fullscreen.library}</button><button type="button" className="aniki-quick" onClick={onProfile}>{t.fullscreen.profile}</button></>
        : <><button type="button" className="aniki-quick" onClick={onHub}>{t.fullscreen.hub}</button>{layoutLabel && <button type="button" className="aniki-quick" title={t.fullscreen.layout} onClick={onLayout}>{layoutLabel}</button>}</>}
      <button type="button" className="aniki-quick" onClick={onMenu}>{t.fullscreen.menu}</button>
      <button type="button" className="aniki-quick" onClick={onSearch}>{t.fullscreen.searchShort}</button>
    </nav>
    <div className="aniki-topbar-right">
      {overview && overview.unlocked > 0 && <button type="button" className="aniki-grades" title={t.fullscreen.trophiesUnlocked} onClick={onTrophies}>
        {grades.map((item) => <span key={item.grade}><TrophyIcon grade={item.grade} />{item.unlocked}</span>)}
      </button>}
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
