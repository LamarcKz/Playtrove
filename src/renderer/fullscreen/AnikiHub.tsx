import { useEffect, useState } from "react"
import type { FullscreenConfig } from "@shared/fullscreen"
import type { DailyPlaytime, Game } from "@shared/types"
import { genreLabel } from "@shared/i18n"
import { useI18n } from "@/hooks/useI18n"
import { formatPlaytime } from "@/lib/format"
import { hubActivity, hubProfileStats } from "@/lib/fullscreenHub"
import { AnikiAvatar } from "./AnikiAvatar"
import { AnikiShortcutBar } from "./AnikiShortcutBar"

export const HUB_PAGES = 2

interface Props { games: Game[]; config: FullscreenConfig; page: number; onOpen: (id: number) => void }

/** Welcome Hub do Aniki: a Home com páginas (L1/R1) sobre a biblioteca. */
export function AnikiHub({ games, config, page, onOpen }: Props) {
  const { t } = useI18n()
  const [daily, setDaily] = useState<DailyPlaytime[]>([])
  useEffect(() => {
    let live = true
    void window.api.stats.dailyPlaytime().then((days) => { if (live) setDaily(days) }).catch(() => {})
    return () => { live = false }
  }, [games])
  return <div className="aniki-hub" data-testid="aniki-hub">
    {page === 0 ? <HubProfile games={games} daily={daily} config={config} /> : <HubActivity games={games} onOpen={onOpen} />}
    <ol className="aniki-hub-dots" aria-hidden="true">{Array.from({ length: HUB_PAGES }, (_, index) => <li key={index} className={index === page ? "aniki-hub-dot-active" : undefined} />)}</ol>
    <AnikiShortcutBar shortcuts={[
      { button: "create", label: t.fullscreen.library },
      { button: "options", label: t.fullscreen.quickAccess },
      { button: "l1", label: t.fullscreen.switchSection },
      { button: "cross", label: t.fullscreen.select },
    ]} />
  </div>
}

function HubProfile({ games, daily, config }: { games: Game[]; daily: DailyPlaytime[]; config: FullscreenConfig }) {
  const { t } = useI18n()
  const stats = hubProfileStats(games, daily)
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
      <p>{t.fullscreen.totalPlaytime}: {formatPlaytime(stats.totalMinutes, t)}</p>
      {stats.topPlatform && <p className="aniki-hub-tags"><span>{t.fullscreen.topPlatform} · {stats.topPlatform}</span></p>}
    </div>
    <dl className="aniki-hub-tiles">{tiles.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </section>
}

function HubActivity({ games, onOpen }: { games: Game[]; onOpen: (id: number) => void }) {
  const { t } = useI18n()
  const activity = hubActivity(games)
  const cards = [
    [t.fullscreen.hubLastPlayed, activity.lastPlayed],
    [t.fullscreen.hubMostPlayed, activity.mostPlayed],
    [t.fullscreen.hubRecentlyAdded, activity.recentlyAdded],
    [t.fullscreen.hubNeverPlayed, activity.neverPlayed],
  ] as const
  return <section className="aniki-hub-activity">
    <h2>{t.fullscreen.hubActivity}</h2>
    <div className="aniki-hub-cards">
      {cards.map(([label, game], index) => game && <button type="button" key={label} data-fs-default={index === 0 ? "" : undefined} className="aniki-hub-card" onClick={() => onOpen(game.id)}>
        {(game.backgroundUrl ?? game.coverUrl) && <img src={game.backgroundUrl ?? game.coverUrl!} alt="" />}
        <span className="aniki-hub-card-band"><small>{label}</small><strong>{game.title}</strong>{game.playtimeMinutes > 0 && <span>{formatPlaytime(game.playtimeMinutes, t)}</span>}</span>
      </button>)}
    </div>
  </section>
}
