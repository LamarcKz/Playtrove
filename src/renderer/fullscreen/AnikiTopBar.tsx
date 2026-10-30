import { TROPHY_GRADES } from "@shared/achievements"
import type { Game } from "@shared/types"
import { ControllerIndicator } from "@/components/ControllerIndicator"
import { Menu } from "lucide-react"
import { AnikiPlatformImage, AnikiTrophyIcon as TrophyIcon } from "./AnikiImage"
import { useAchievementsOverview } from "@/hooks/useAchievements"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { useI18n } from "@/hooks/useI18n"
import { FullscreenClock } from "./FullscreenClock"
import { devMark } from "@/lib/devBuild"
import { AnikiAvatar } from "./AnikiAvatar"
import { AnikiIcon } from "./AnikiGlyph"

interface Props { games: Game[]; hub: boolean; detailsGame?: Game; layoutLabel: string | null; filtered: boolean; unseen: number; onLayout: () => void; onHub: () => void; onProfile: () => void; onTrophies: () => void; onSearch: () => void; onMenu: () => void; onFilters: () => void; onNotices: () => void }

/**
 * A biblioteca mantém navegação e perfil; os detalhes usam a barra de origem, conquistas e avatar.
 * Um botão discreto preserva o acesso ao menu principal também pelos detalhes.
 */
export function AnikiTopBar({ games, hub, detailsGame, layoutLabel, filtered, unseen, onLayout, onHub, onProfile, onTrophies, onSearch, onMenu, onFilters, onNotices }: Props) {
  const { t } = useI18n()
  const { config } = useFullscreenConfig()
  const overview = useAchievementsOverview(games)
  const trophyGames = detailsGame ? overview?.games.filter((game) => game.gameId === detailsGame.id) : overview?.games
  const grades = TROPHY_GRADES.map((grade) => ({ grade, unlocked: trophyGames?.reduce((sum, game) => sum + game.byGrade[grade].unlocked, 0) ?? 0 }))
  const source = detailsGame?.platform ?? detailsGame?.library
  return <header className={`aniki-topbar${detailsGame ? " aniki-topbar-details" : ""}`}>
    <div className="aniki-topbar-left">
      {detailsGame
        ? source && <span className="aniki-topbar-source"><AnikiPlatformImage platform={source} /><span>{source}</span></span>
        : config && <><AnikiAvatar avatar={config.profileAvatar} size={52} /><span className="aniki-profile-name">{config.profileName || t.fullscreen.defaultProfileName}</span></>}
      {devMark && <span title={devMark === "tests" ? t.topBar.devTestsHint : t.topBar.devHint} className="aniki-dev">{t.topBar.dev}</span>}
    </div>
    {!detailsGame && <nav className="aniki-topbar-center" aria-label={t.fullscreen.menu}>
      {hub
        ? <><button type="button" className="aniki-quick" onClick={onHub}>{t.fullscreen.library}</button><button type="button" className="aniki-quick" onClick={onProfile}>{t.fullscreen.profile}</button></>
        : <><button type="button" className="aniki-quick" onClick={onHub}>{t.fullscreen.hub}</button>{layoutLabel && <button type="button" className="aniki-quick" title={t.fullscreen.layout} onClick={onLayout}>{layoutLabel}</button>}</>}
      <button type="button" className="aniki-quick" onClick={onMenu}>{t.fullscreen.menu}</button>
      <button type="button" className="aniki-quick" onClick={onSearch}>{t.fullscreen.searchShort}</button>
      <button type="button" className="aniki-quick aniki-tool" aria-label={t.filters.title} aria-pressed={filtered} onClick={onFilters}><AnikiIcon icon="filter" /></button>
      <button type="button" className="aniki-quick aniki-tool" aria-label={t.fullscreen.notices} onClick={onNotices}><AnikiIcon icon="notices" />{unseen > 0 && <span className="aniki-notice-count">{unseen}</span>}</button>
    </nav>}
    <div className="aniki-topbar-right">
      {overview && <button type="button" className="aniki-grades" aria-label={t.fullscreen.trophiesUnlocked} title={t.fullscreen.trophiesUnlocked} onClick={onTrophies}>
        {grades.map((item) => <span key={item.grade}><TrophyIcon grade={item.grade} />{item.unlocked}</span>)}
      </button>}
      {detailsGame ? <>
        <button type="button" className="aniki-quick aniki-tool" aria-label={t.fullscreen.menu} title={t.fullscreen.menu} onClick={onMenu}><Menu /></button>
        {config && <button type="button" className="aniki-details-profile" aria-label={t.fullscreen.profile} title={t.fullscreen.profile} onClick={onProfile}><AnikiAvatar avatar={config.profileAvatar} size={56} /></button>}
      </> : <><ControllerIndicator /><FullscreenClock className="aniki-clock" /></>}
    </div>
  </header>
}
