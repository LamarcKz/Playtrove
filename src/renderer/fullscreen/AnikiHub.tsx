import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { FullscreenConfig } from "@shared/fullscreen"
import type { AchievementsOverview, UnlockedAchievement } from "@shared/achievements"
import { ANIKI_FINISHED_STATUS_MARKERS, type HubGameActivity } from "@shared/anikiHub"
import type { DailyPlaytime, Game } from "@shared/types"
import { genreLabel } from "@shared/i18n"
import { useI18n } from "@/hooks/useI18n"
import { formatPlaytime } from "@/lib/format"
import { hubProfileStats } from "@/lib/fullscreenHub"
import { anikiHubPages, anikiHubRecommendations, anikiAchievementMemories, anikiHubOverview, loadAnikiAchievementHistory } from "@/lib/anikiHubPages"
import { observeAnikiHubDay } from "@/lib/anikiHubDay"
import { AnikiAvatar } from "./AnikiAvatar"
import { AnikiRankImage } from "./AnikiImage"
import { AnikiShortcutBar } from "./AnikiShortcutBar"
import { useCollectorLevel } from "./AnikiProfile"
import { useAchievementsOverview } from "@/hooks/useAchievements"
import { useStatuses } from "@/hooks/useStatuses"

export const HUB_PAGES = 2

interface Props { games: Game[]; config: FullscreenConfig; page: number; onOpen: (id: number) => void; onPageCount?: (count: number) => void }

/** Welcome Hub do Aniki: a Home com páginas (L1/R1) sobre a biblioteca. */
export function AnikiHub({ games, config, page, onOpen, onPageCount }: Props) {
  const { t } = useI18n()
  const statuses = useStatuses()
  const overview = useAchievementsOverview(games)
  const [daily, setDaily] = useState<DailyPlaytime[]>([])
  const [activity, setActivity] = useState<HubGameActivity[] | null>(null)
  const [history, setHistory] = useState<UnlockedAchievement[]>([])
  const [samples] = useState(() => [Math.random(), Math.random(), Math.random()])
  const previousOverview = useRef<ReturnType<typeof anikiHubOverview> | undefined>(undefined)
  const [reference, setReference] = useState<{ day: string; id: number | null }>({ day: "", id: null })
  const [today, setToday] = useState(() => new Date().toDateString())
  useEffect(() => observeAnikiHubDay(setToday), [])
  const finishedStatusIds = useMemo(() => {
    const names = [t.statusPresets.beaten, t.statusPresets.complete100, t.statusPresets.platinum]
    return statuses.filter((status) => names.includes(status.name) || ANIKI_FINISHED_STATUS_MARKERS.some((term) => status.name.toLowerCase().includes(term))).map((status) => status.id)
  }, [statuses, t.statusPresets])
  const recommendations = useMemo(() => activity === null ? { referenceId: null, items: [] } : anikiHubRecommendations(games, { activity, finishedStatusIds, stickyReferenceId: reference.day === today ? reference.id : null }), [games, activity, finishedStatusIds, reference, today])
  const libraryOverview = useMemo(() => { let index = 0; return anikiHubOverview(games, activity ?? [], () => samples[index++], previousOverview.current) }, [games, activity, samples])
  const memories = useMemo(() => anikiAchievementMemories(games, history, () => samples[2]), [games, history, samples])
  const pages = anikiHubPages(recommendations.items.length, memories.items.length)
  const current = pages[Math.max(0, Math.min(page, pages.length - 1))]
  useEffect(() => { onPageCount?.(pages.length) }, [onPageCount, pages.length])
  useEffect(() => { previousOverview.current = libraryOverview }, [libraryOverview])
  useEffect(() => {
    if (recommendations.referenceId !== null) setReference({ day: today, id: recommendations.referenceId })
  }, [recommendations.referenceId, today])
  useEffect(() => {
    let live = true
    void window.api.stats.dailyPlaytime().then((days) => { if (live) setDaily(days) }).catch(() => {})
    void window.api.stats.hubGameActivity().then((rows) => { if (live) setActivity(rows) }).catch(() => {})
    return () => { live = false }
  }, [games, today])
  useEffect(() => {
    let live = true
    void loadAnikiAchievementHistory(games, window.api.achievements.game, () => !live).then((items) => { if (live) setHistory(items) })
    return () => { live = false }
  }, [games])
  return <div className="aniki-hub" data-testid="aniki-hub">
    {current === "profile" ? <HubProfile games={games} daily={daily} config={config} overview={overview} /> : current === "activity" ? <HubActivity activity={libraryOverview} onOpen={onOpen} /> : current === "recommendations" ? <section className="aniki-hub-activity" data-testid="aniki-hub-recommendations">
      <h2>{t.fullscreen.hubRecommendations}</h2>
      <div className="aniki-hub-cards">{recommendations.items.map((item, index) => <HubCard key={item.game.id} game={item.game} onOpen={onOpen} isDefault={index === 0} label={item.reason ? t.fullscreen.hubRecommendationReasons[item.reason](item.reference.title) : undefined} />)}</div>
    </section> : <section className="aniki-hub-activity" data-testid="aniki-hub-memories">
      <h2>{t.fullscreen.hubAchievementMemories}</h2>
      {memories.month && <p className="aniki-hub-page-subtitle">{new Intl.DateTimeFormat(t.locale, { month: "long", year: "numeric" }).format(new Date(Number(memories.month.slice(0, 4)), Number(memories.month.slice(5)) - 1, 1))}</p>}
      <div className="aniki-hub-cards">{memories.items.map((item, index) => {
        const game = games.find((game) => game.id === item.gameId)!
        return <HubCard key={`${item.gameId}:${item.key}`} game={game} onOpen={onOpen} isDefault={index === 0} label={game.title} title={item.title} badge={item.badgeUrl} detail={<>{new Date(item.earnedAt!).toLocaleDateString(t.locale)}{item.percent !== null && ` · ${item.percent.toLocaleString(t.locale)}%`}</>} />
      })}</div>
    </section>}
    <ol className="aniki-hub-dots" aria-hidden="true">{pages.map((id, index) => <li key={id} className={index === Math.max(0, Math.min(page, pages.length - 1)) ? "aniki-hub-dot-active" : undefined} />)}</ol>
    <AnikiShortcutBar shortcuts={[
      { button: "create", label: t.fullscreen.library },
      { button: "options", label: t.fullscreen.quickAccess },
      { button: "l1", label: t.fullscreen.switchSection },
      { button: "cross", label: t.fullscreen.select },
    ]} />
  </div>
}

function HubProfile({ games, daily, config, overview }: { games: Game[]; daily: DailyPlaytime[]; config: FullscreenConfig; overview: AchievementsOverview | null }) {
  const { t } = useI18n()
  const stats = hubProfileStats(games, daily)
  const level = useCollectorLevel(overview)
  const tiles = [
    [t.fullscreen.hubTotalGames, stats.totalGames],
    [t.fullscreen.hubPlayable, stats.playable],
    [t.fullscreen.favorites, stats.favorites],
    [t.fullscreen.hubMonthTime, formatPlaytime(stats.monthMinutes, t)],
    [t.fullscreen.hubPlayedMonth, stats.playedThisMonth],
    [t.fullscreen.hubCompleted, stats.completed],
  ] as const
  return <section className="aniki-hub-profile">
    <AnikiAvatar avatar={config.profileAvatar} size={120} />
    <div className="aniki-hub-identity">
      <h2>{config.profileName || t.fullscreen.defaultProfileName}</h2>
      {stats.topGenre && <p className="aniki-hub-rank">{t.fullscreen.fanOf(genreLabel(stats.topGenre, t))}</p>}
      <p className="aniki-level-line"><AnikiRankImage rank={level.rank} />{t.fullscreen.level(level.level)}{level.rank && ` · ${t.fullscreen.ranks[level.rank.tier]} ${level.rank.step}`}</p>
      <p>{t.fullscreen.totalPlaytime}: {formatPlaytime(stats.totalMinutes, t)}</p>
      {stats.topPlatform && <p className="aniki-hub-tags"><span>{t.fullscreen.topPlatform} · {stats.topPlatform}</span></p>}
    </div>
    <dl className="aniki-hub-tiles">{tiles.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </section>
}

function HubActivity({ activity, onOpen }: { activity: ReturnType<typeof anikiHubOverview>; onOpen: (id: number) => void }) {
  const { t } = useI18n()
  const cards = [
    [t.fullscreen.hubLastPlayed, activity.lastPlayed],
    [activity.mostPlayedMonthly ? t.fullscreen.hubMostPlayedMonth : t.fullscreen.hubMostPlayed, activity.mostPlayed],
    [t.fullscreen.hubRecentlyAdded, activity.recentlyAdded],
    [t.fullscreen.hubNeverPlayed, activity.neverPlayed],
  ] as const
  return <section className="aniki-hub-activity">
    <h2>{t.fullscreen.hubActivity}</h2>
    <div className="aniki-hub-cards">
      {cards.map(([label, game], index) => game && <HubCard key={label} game={game} onOpen={onOpen} isDefault={index === 0} label={label} detail={game.playtimeMinutes > 0 ? formatPlaytime(game === activity.mostPlayed ? activity.mostPlayedMinutes : game.playtimeMinutes, t) : undefined} />)}
    </div>
  </section>
}

function HubCard({ game, onOpen, isDefault, label, title, detail, badge }: { game: Game; onOpen: (id: number) => void; isDefault: boolean; label?: string; title?: string; detail?: ReactNode; badge?: string | null }) {
  return <button type="button" data-fs-default={isDefault ? "" : undefined} className="aniki-hub-card" onClick={() => onOpen(game.id)}>
    {(game.backgroundUrl ?? game.coverUrl) && <img src={game.backgroundUrl ?? game.coverUrl!} alt="" />}
    {badge && <img className="aniki-hub-memory-badge" src={badge} alt="" />}
    <span className="aniki-hub-card-band">{label && <small>{label}</small>}<strong>{title ?? game.title}</strong>{detail && <span>{detail}</span>}</span>
  </button>
}
