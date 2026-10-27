import { useState } from "react"
import { TROPHY_GRADES, type AchievementGameRow, type Rarity } from "@shared/achievements"
import type { FullscreenConfig } from "@shared/fullscreen"
import type { Game } from "@shared/types"
import { GameCover } from "@/components/GameCover"
import { ProgressBar, TrophyIcon } from "@/components/AchievementParts"
import { useAchievementsOverview } from "@/hooks/useAchievements"
import { useI18n } from "@/hooks/useI18n"
import { progressPercent } from "@/lib/achievements"
import { AnikiAvatar } from "./AnikiAvatar"
import { useCollectorLevel } from "./AnikiProfile"

type Sort = "recent" | "name" | "progress"
type Filter = "all" | "progress" | "complete"
const rarities: Rarity[] = ["comum", "rara", "muito-rara", "ultrarrara"]

/** Ordena e filtra a lista de jogos da tela geral de troféus. */
function trophyRows(rows: AchievementGameRow[], sort: Sort, filter: Filter, locale: string): AchievementGameRow[] {
  const list = rows.filter((row) => filter === "all" || (filter === "complete" ? row.platinum : !row.platinum && row.unlocked > 0))
  if (sort === "name") list.sort((a, b) => a.title.localeCompare(b.title, locale))
  if (sort === "progress") list.sort((a, b) => progressPercent(b.unlocked, b.total) - progressPercent(a.unlocked, a.total))
  return list
}

interface Props { games: Game[]; config: FullscreenConfig; onOpen: (id: number) => void }

/** Tela geral de troféus do Aniki (PlayniteAchievements): nível de colecionador, totais e os jogos com progresso. */
export function AnikiTrophyOverview({ games, config, onOpen }: Props) {
  const { t } = useI18n()
  const overview = useAchievementsOverview(games)
  const level = useCollectorLevel(overview)
  const [sort, setSort] = useState<Sort>("recent")
  const [filter, setFilter] = useState<Filter>("all")
  if (!overview) return <p className="aniki-trophies-loading">{t.common.loading}</p>
  const covers = new Map(games.map((game) => [game.id, game]))
  const rows = trophyRows(overview.games, sort, filter, t.locale)
  return <div className="aniki-trophy-overview" data-testid="aniki-trophy-overview">
    <header className="aniki-overview-header">
      <AnikiAvatar avatar={config.profileAvatar} size={96} />
      <div>
        <h2>{t.fullscreen.trophiesTitle}</h2>
        <p>{config.profileName || t.fullscreen.defaultProfileName}</p>
      </div>
      <div className="aniki-overview-level">
        <strong>{t.fullscreen.level(level.level)}</strong>
        {level.rank && <span>{t.fullscreen.ranks[level.rank.tier]} {level.rank.step}</span>}
        <ProgressBar value={level.progress} label={t.fullscreen.nextLevel} className="aniki-overview-progress" />
        <small>{t.fullscreen.pointsToNext(level.pointsToNext.toLocaleString(t.locale))}</small>
      </div>
    </header>
    <div className="aniki-overview-stats">
      <ul className="aniki-trophies-grades">{TROPHY_GRADES.map((grade) => <li key={grade}><TrophyIcon grade={grade} /><span>{overview.games.reduce((sum, row) => sum + row.byGrade[grade].unlocked, 0)}</span></li>)}</ul>
      <dl>{rarities.map((rarity) => <div key={rarity}><dt>{t.achievements.rarities[rarity]}</dt><dd>{overview.byRarity[rarity]}</dd></div>)}
        <div><dt>{t.fullscreen.completedGames}</dt><dd>{overview.platinums}</dd></div>
        <div><dt>{t.fullscreen.unlockedTotal}</dt><dd>{overview.unlocked} / {overview.total}</dd></div>
      </dl>
    </div>
    <div className="aniki-trophies-tools">
      <button type="button" data-fs-default onClick={() => setSort(sort === "recent" ? "name" : sort === "name" ? "progress" : "recent")}>{t.fullscreen.sortBy}: {t.fullscreen.gameSorts[sort]}</button>
      <button type="button" onClick={() => setFilter(filter === "all" ? "progress" : filter === "progress" ? "complete" : "all")}>{t.fullscreen.showing}: {t.fullscreen.gameFilters[filter]}</button>
    </div>
    <ul className="aniki-overview-games">
      {rows.map((row) => {
        const game = covers.get(row.gameId)
        const percent = progressPercent(row.unlocked, row.total)
        return <li key={row.gameId}><button type="button" onClick={() => onOpen(row.gameId)}>
          <span className="aniki-overview-cover"><GameCover title={row.title} src={game?.coverUrl ?? null} layout="grid" /></span>
          <span className="aniki-overview-info"><strong>{row.title}</strong><ProgressBar value={percent} label={row.title} /><small>{row.unlocked} / {row.total} · {percent}%</small></span>
          <span className="aniki-overview-grades">{TROPHY_GRADES.map((grade) => <span key={grade}><TrophyIcon grade={grade} />{row.byGrade[grade].unlocked}/{row.byGrade[grade].total}</span>)}</span>
        </button></li>
      })}
    </ul>
  </div>
}
