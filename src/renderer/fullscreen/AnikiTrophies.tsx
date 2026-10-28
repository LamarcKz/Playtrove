import { useState } from "react"
import { TROPHY_GRADES, type GameAchievement } from "@shared/achievements"
import type { Game } from "@shared/types"
import { GameCover } from "@/components/GameCover"
import { AchievementBadge, ProgressBar, TrophyIcon } from "@/components/AchievementParts"
import { useGameAchievements } from "@/hooks/useAchievements"
import { useI18n } from "@/hooks/useI18n"
import { AnikiLogo } from "./AnikiLogo"
import { formatPercent, progressPercent, sortAchievements, type AchievementSort } from "@/lib/achievements"
import { formatDate, formatTime } from "@/lib/format"

type Show = "all" | "unlocked" | "locked"
const sorts: AchievementSort[] = ["default", "name", "date", "rarity", "grade"]

/** Painel de troféus dos Detalhes do Aniki: cabeçalho com capa e progresso, totais por tipo e a lista em cartões. */
export function AnikiTrophies({ game }: { game: Game }) {
  const { t } = useI18n()
  const details = useGameAchievements(game.id, game)
  const [show, setShow] = useState<Show>("all")
  const [sort, setSort] = useState<AchievementSort>("default")
  const [revealHidden, setRevealHidden] = useState(false)
  const words = t.achievements
  const source = words.sources[details?.source ?? game.achievements?.source ?? "retroachievements"]
  if (!details) return <p className="aniki-trophies-loading">{t.common.loading}</p>
  const percent = progressPercent(details.unlocked, details.total)
  const visible = sortAchievements(details.achievements, sort, t.locale).filter((item) => show === "all" || (show === "unlocked") === (item.earnedAt !== null))
  const showLabel = { all: source.all, unlocked: source.unlocked, locked: words.lockedFilter }
  return <div className="aniki-trophies" data-testid="aniki-trophies">
    <header className="aniki-trophies-header">
      <div className="aniki-trophies-cover"><GameCover title={game.title} src={game.coverUrl} /></div>
      <div className="aniki-trophies-title">
        <h2><AnikiLogo game={game} label={source.titleOf(game.title)} /></h2>
        <ProgressBar value={percent} label={source.progress} className="aniki-trophies-progress" />
        <p>{percent}%</p>
      </div>
      <ul className="aniki-trophies-grades">
        {TROPHY_GRADES.map((grade) => <li key={grade}><TrophyIcon grade={grade} /><span>{details.byGrade[grade].unlocked}</span></li>)}
      </ul>
    </header>
    <div className="aniki-trophies-tools">
      <button type="button" data-fs-default onClick={() => setSort(sorts[(sorts.indexOf(sort) + 1) % sorts.length])}>{t.fullscreen.sortBy}: {t.fullscreen.sorts[sort]}</button>
      <button type="button" onClick={() => setShow(show === "all" ? "unlocked" : show === "unlocked" ? "locked" : "all")}>{t.fullscreen.showing}: {showLabel[show]}</button>
      <button type="button" aria-pressed={revealHidden} onClick={() => setRevealHidden(!revealHidden)}>{words.showHidden}</button>
    </div>
    <ul className="aniki-trophies-list">
      {visible.map((item) => <AnikiTrophyCard key={item.key} achievement={item} revealHidden={revealHidden} />)}
    </ul>
    <p className="aniki-trophies-total">{t.fullscreen.totalUnlocked(details.unlocked, details.total)}</p>
  </div>
}

function AnikiTrophyCard({ achievement, revealHidden }: { achievement: GameAchievement; revealHidden: boolean }) {
  const { t } = useI18n()
  const words = t.achievements
  const earned = achievement.earnedAt !== null
  const masked = achievement.hidden && !earned && !revealHidden
  const title = masked ? words.hiddenTitle : achievement.title
  return <li className={earned ? "aniki-trophy aniki-trophy-earned" : "aniki-trophy"} tabIndex={0}>
    <AchievementBadge url={masked ? null : achievement.badgeUrl} title={title} earned={earned} dim={achievement.source === "rpcs3"} decorative className="aniki-trophy-badge" />
    <div className="aniki-trophy-text">
      <p className="aniki-trophy-name">{title}</p>
      <p className="aniki-trophy-desc">{masked ? words.hiddenDescription : achievement.description}</p>
      <p className="aniki-trophy-meta">
        {words.grades[achievement.grade]}
        {achievement.rarity && ` · ${words.rarities[achievement.rarity]} · ${words.ofPlayers(formatPercent(achievement.percent ?? 0, t.locale))}`}
        {achievement.points !== null && ` · ${words.points(achievement.points)}`}
        {achievement.group && ` · ${achievement.group}`}
        {achievement.hardcore && ` · ${words.hardcore}`}
      </p>
    </div>
    <div className="aniki-trophy-when">
      {achievement.earnedAt ? <><span>{formatTime(achievement.earnedAt, t.locale)}</span><span>{formatDate(new Date(achievement.earnedAt), t.locale)}</span></> : <span>{words.locked}</span>}
    </div>
    <TrophyIcon grade={achievement.grade} className="aniki-trophy-grade" />
  </li>
}
