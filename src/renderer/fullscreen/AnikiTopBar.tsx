import { useEffect, useState } from "react"
import { TROPHY_GRADES } from "@shared/achievements"
import type { Game } from "@shared/types"
import { ControllerIndicator } from "@/components/ControllerIndicator"
import { TrophyIcon } from "@/components/AchievementParts"
import { useAchievementsOverview } from "@/hooks/useAchievements"
import { useI18n } from "@/hooks/useI18n"
import { devMark } from "@/lib/devBuild"

interface Props { games: Game[]; label: string; onSearch: () => void; onMenu: () => void }

/**
 * Barra do topo do Aniki (interface Padrão): a coleção (ou, nos detalhes, a origem do jogo) à esquerda, o
 * menu e a busca no centro — o menu fica também nos detalhes, para voltar ao modo janela de qualquer tela,
 * como no Playnite — e, à direita, os troféus pegos de cada tipo, o controle e o relógio.
 */
export function AnikiTopBar({ games, label, onSearch, onMenu }: Props) {
  const { t } = useI18n()
  const overview = useAchievementsOverview(games)
  const grades = TROPHY_GRADES.map((grade) => ({ grade, unlocked: overview?.games.reduce((sum, game) => sum + game.byGrade[grade].unlocked, 0) ?? 0 }))
  return <header className="aniki-topbar">
    <div className="aniki-topbar-left">
      <span className="aniki-preset">{label}</span>
      {devMark && <span title={devMark === "tests" ? t.topBar.devTestsHint : t.topBar.devHint} className="aniki-dev">{t.topBar.dev}</span>}
    </div>
    <nav className="aniki-topbar-center" aria-label={t.fullscreen.menu}>
      <button type="button" className="aniki-quick" onClick={onMenu}>{t.fullscreen.menu}</button>
      <button type="button" className="aniki-quick" onClick={onSearch}>{t.fullscreen.searchShort}</button>
    </nav>
    <div className="aniki-topbar-right">
      {overview && overview.unlocked > 0 && <ul className="aniki-grades" title={t.fullscreen.trophiesUnlocked}>
        {grades.map((item) => <li key={item.grade}><TrophyIcon grade={item.grade} />{item.unlocked}</li>)}
      </ul>}
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
