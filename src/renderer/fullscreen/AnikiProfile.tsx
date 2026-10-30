import { useEffect, useState } from "react"
import { TROPHY_GRADES, type AchievementsOverview, type UnlockedAchievement } from "@shared/achievements"
import type { FullscreenConfig } from "@shared/fullscreen"
import type { DailyPlaytime, Game } from "@shared/types"
import { genreLabel } from "@shared/i18n"
import { GameCover } from "@/components/GameCover"
import { AchievementBadge, ProgressBar } from "@/components/AchievementParts"
import { AnikiRankImage, AnikiTrophyIcon as TrophyIcon } from "./AnikiImage"
import { useAchievementsOverview } from "@/hooks/useAchievements"
import { useI18n } from "@/hooks/useI18n"
import { COLLECTOR_CURVE, achievementLevel, collectorScore } from "@/lib/collectorLevel"
import { formatPercent } from "@/lib/achievements"
import { formatPlaytime } from "@/lib/format"
import { hubProfileStats } from "@/lib/fullscreenHub"
import { AnikiAvatar } from "./AnikiAvatar"

interface Props { games: Game[]; config: FullscreenConfig; onOpen: (id: number) => void }

/** O nível de colecionador do perfil, com a patente e o progresso até o próximo. */
export function useCollectorLevel(overview: AchievementsOverview | null) {
  const score = overview ? collectorScore(overview.byRarity) : 0
  return { score, ...achievementLevel(score, COLLECTOR_CURVE) }
}

/** Tela de perfil do Aniki (ProfilView): nível, números da biblioteca, destaques, prateleiras e troféus. */
export function AnikiProfile({ games, config, onOpen }: Props) {
  const { t } = useI18n()
  const overview = useAchievementsOverview(games)
  const level = useCollectorLevel(overview)
  const [daily, setDaily] = useState<DailyPlaytime[]>([])
  useEffect(() => {
    let live = true
    void window.api.stats.dailyPlaytime().then((days) => { if (live) setDaily(days) }).catch(() => {})
    return () => { live = false }
  }, [games])
  const stats = hubProfileStats(games, daily)
  const played = games.filter((game) => game.playtimeMinutes > 0)
  const byDate = (pick: (game: Game) => string | null) => games.filter((game) => pick(game)).sort((a, b) => pick(b)!.localeCompare(pick(a)!)).slice(0, 6)
  const shelves = [
    [t.fullscreen.shelfRecentlyPlayed, byDate((game) => game.lastPlayedAt)],
    [t.fullscreen.shelfRecentlyAdded, byDate((game) => game.addedAt)],
    [t.fullscreen.shelfNeverPlayed, games.filter((game) => !game.lastPlayedAt && game.playtimeMinutes === 0).slice(0, 6)],
    [t.fullscreen.shelfMostPlayed, [...played].sort((a, b) => b.playtimeMinutes - a.playtimeMinutes).slice(0, 6)],
  ] as const
  const tiles = [
    [t.fullscreen.hubTotalGames, stats.totalGames],
    [t.fullscreen.hubPlayable, stats.playable],
    [t.fullscreen.favorites, stats.favorites],
    [t.fullscreen.totalPlaytime, formatPlaytime(stats.totalMinutes, t)],
    [t.fullscreen.averagePlaytime, formatPlaytime(played.length ? Math.round(stats.totalMinutes / played.length) : 0, t)],
    [t.fullscreen.hubMonthTime, formatPlaytime(stats.monthMinutes, t)],
  ] as const
  const platforms = Object.entries(games.reduce<Record<string, number>>((count, game) => { const key = game.platform ?? game.library; if (key) count[key] = (count[key] ?? 0) + 1; return count }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5)
  return <div className="aniki-profile" data-testid="aniki-profile">
    <header className="aniki-profile-header">
      <AnikiAvatar avatar={config.profileAvatar} size={140} />
      <div className="aniki-profile-identity">
        <h2>{config.profileName || t.fullscreen.defaultProfileName}</h2>
        {stats.topGenre && <p className="aniki-hub-rank">{t.fullscreen.fanOf(genreLabel(stats.topGenre, t))}</p>}
        <p className="aniki-profile-level aniki-level-line"><AnikiRankImage rank={level.rank} />{t.fullscreen.level(level.level)}{level.rank && ` · ${t.fullscreen.ranks[level.rank.tier]} ${level.rank.step}`}</p>
        <ProgressBar value={level.progress} label={t.fullscreen.nextLevel} className="aniki-profile-progress" />
        <p className="aniki-profile-points">{t.fullscreen.collectorPoints(level.score.toLocaleString(t.locale))} · {t.fullscreen.pointsToNext(level.pointsToNext.toLocaleString(t.locale))}</p>
      </div>
      <dl className="aniki-hub-tiles">{tiles.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </header>
    <div className="aniki-profile-body" data-fs-scroll tabIndex={0}>
      {overview && overview.unlocked > 0 && <section className="aniki-profile-trophies">
        <h3>{t.fields.achievements}</h3>
        <ul className="aniki-trophies-grades">{TROPHY_GRADES.map((grade) => <li key={grade}><TrophyIcon grade={grade} /><span>{overview.games.reduce((sum, row) => sum + row.byGrade[grade].unlocked, 0)}</span></li>)}</ul>
        <div className="aniki-profile-unlocks">
          <ProfileUnlocks title={t.fullscreen.recentUnlocks} items={overview.recent.slice(0, 4)} />
          <ProfileUnlocks title={t.fullscreen.rarestUnlocks} items={overview.rarest.slice(0, 4)} />
        </div>
      </section>}
      {shelves.map(([title, list]) => list.length > 0 && <section key={title} className="aniki-profile-shelf">
        <h3>{title}</h3>
        <div className="aniki-profile-covers">{list.map((game) => <button type="button" key={game.id} aria-label={game.title} onClick={() => onOpen(game.id)}><GameCover title={game.title} src={game.coverUrl} layout="grid" /></button>)}</div>
      </section>)}
      {platforms.length > 0 && <section className="aniki-profile-platforms">
        <h3>{t.fullscreen.byPlatform}</h3>
        <ul>{platforms.map(([name, count]) => <li key={name}><span>{name}</span><ProgressBar value={Math.round((count / games.length) * 100)} label={name} /><strong>{count}</strong></li>)}</ul>
      </section>}
    </div>
  </div>
}

function ProfileUnlocks({ title, items }: { title: string; items: UnlockedAchievement[] }) {
  const { t } = useI18n()
  if (!items.length) return null
  return <div>
    <h4>{title}</h4>
    <ul>{items.map((item) => <li key={item.key}>
      <AchievementBadge url={item.badgeUrl} title={item.title} earned decorative className="aniki-profile-badge" />
      <span><strong>{item.title}</strong><small>{item.gameTitle}{item.percent !== null && ` · ${t.achievements.ofPlayers(formatPercent(item.percent, t.locale))}`}</small></span>
    </li>)}</ul>
  </div>
}
