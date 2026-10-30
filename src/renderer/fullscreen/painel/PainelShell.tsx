import { useEffect, useState } from "react"
import { ArrowLeft, BarChart3, Bell, Clock3, Gamepad2, Info, Library, ListFilter, Menu, MoreHorizontal, Play, Search, Star, Trophy } from "lucide-react"
import type { DailyPlaytime } from "@shared/types"
import { GameCover } from "@/components/GameCover"
import { ControllerIndicator } from "@/components/ControllerIndicator"
import { useAchievementsOverview } from "@/hooks/useAchievements"
import { hasActiveFilters } from "@/lib/filters"
import { formatPlaytime } from "@/lib/format"
import { activityTotals, summarize } from "@/lib/stats"
import { FullscreenMedia } from "../FullscreenMedia"
import { FullscreenClock } from "../FullscreenClock"
import { FullscreenPanels } from "../FullscreenPanels"
import { FullscreenDevBadge, FullscreenGameFacts, FullscreenGameLogo, FullscreenPlaytime, FullscreenRatingText, FullscreenTrophyText } from "../FullscreenParts"
import { FULLSCREEN_COLLECTIONS, type FullscreenThemeProps } from "../useFullscreenSession"

/**
 * Painel, inspirado na tela inicial do Xbox: a arte (e o trailer) no fundo, a fileira de capas no topo com a escolhida
 * maior e os blocos grandes embaixo (Continuar jogando, Coleções, Conquistas e Estatísticas); os detalhes com uma
 * coluna de ações e os blocos de informação.
 */
export function PainelShell({ session, onOpenEmulators }: FullscreenThemeProps) {
  const { t, config, notices, collection, label, query, visible, resolvedId, setSelectedId, game, details, setDetails, setPanel, panel, status, editing, games } = session
  const trailers = config?.painelTrailers ?? "all"
  const lastPlayed = games.filter((item) => item.lastPlayedAt).sort((a, b) => b.lastPlayedAt!.localeCompare(a.lastPlayedAt!))[0]
  const totalMinutes = summarize(games).totalMinutes
  const overview = useAchievementsOverview(games)
  const [days, setDays] = useState<DailyPlaytime[] | null>(null)
  useEffect(() => {
    let live = true
    void window.api.stats.dailyPlaytime().then((result) => { if (live) setDays(result) }).catch(() => {})
    return () => { live = false }
  }, [games])

  return (
    <div {...session.rootProps} className="painel-fullscreen">
      <FullscreenMedia game={game} playVideo={trailers === "all" || (trailers === "details" && details)} videoDelay={details ? 600 : 2000} suspended={session.suspended} />
      <section ref={panel ? undefined : session.scope} className="pn-main" inert={panel !== null || session.busy}>
        <header className="pn-top">
          <FullscreenDevBadge />
          <div className="pn-tools">
            <button type="button" aria-label={t.fullscreen.search} onClick={() => setPanel("search")}><Search /></button>
            <button type="button" aria-label={t.filters.title} aria-pressed={hasActiveFilters(session.filters) || session.sort !== "collection"} onClick={() => setPanel("filters")}><ListFilter /></button>
            <button type="button" aria-label={t.fullscreen.notices} className="pn-badged" onClick={session.openNotices}><Bell />{notices.unseen > 0 && <span className="fs-badge" aria-hidden="true">{notices.unseen}</span>}</button>
            <button type="button" aria-label={t.fullscreen.menu} onClick={() => setPanel("menu")}><Menu /></button>
            <ControllerIndicator />
            {config?.showClock && <FullscreenClock className="pn-clock" />}
          </div>
        </header>
        {details && game ? <div className="pn-details" data-testid="fullscreen-details">
          <div className="pn-details-column">
            <button type="button" className="pn-back" onClick={() => setDetails(false)}><ArrowLeft />{t.fullscreen.back}</button>
            <FullscreenGameLogo game={game} className="pn-logo" />
            <p className="pn-eyebrow">{[game.platform, game.library].filter(Boolean).join(" · ")}{game.favorite && <Star className="pn-favorite" />}</p>
            <button type="button" data-fs-default className="pn-play" disabled={!session.canPlay()} onClick={() => void session.play()}><Play />{session.launching ? t.fullscreen.launching : t.fullscreen.play}</button>
            <button type="button" data-fs-fallback onClick={() => setPanel("options")}><MoreHorizontal />{t.fullscreen.options}</button>
            <button type="button" aria-pressed={game.favorite} disabled={editing} onClick={session.favorite}><Star />{t.fullscreen.favorite}</button>
          </div>
          <div className="pn-details-blocks">
            <section className="pn-block"><h2><Trophy />{t.fields.achievements}</h2><FullscreenTrophyText game={game} />{game.achievements && <button type="button" onClick={() => setPanel("achievements")}>{t.fullscreen.achievements}</button>}</section>
            <section className="pn-block"><h2><Clock3 />{t.fields.playtime}</h2><FullscreenPlaytime game={game} /></section>
            <section className="pn-block"><h2><Star />{t.fullscreen.review}</h2><FullscreenRatingText game={game} /><button type="button" onClick={session.openReview}>{t.fullscreen.editReview}</button></section>
            <section className="pn-block"><h2><Info />{t.fullscreen.information}</h2><FullscreenGameFacts game={game} status={status} /></section>
            <div className="pn-description" data-testid="fullscreen-description" data-fs-scroll tabIndex={0}><h2>{t.details.description}</h2><p>{game.description || t.fullscreen.noDescription}</p></div>
          </div>
        </div> : <div className="pn-home" data-testid="fullscreen-library">
          <div className="pn-rail-heading"><h2>{query ? t.fullscreen.searchResults : label(collection)}</h2><span>{t.common.games(visible.length)}</span>{query && <button type="button" onClick={session.clearSearch}>{t.fullscreen.clearSearch}</button>}</div>
          <div className="pn-rail">{visible.map((item) => <button type="button" key={item.id} data-testid={`fullscreen-game-${item.id}`} data-fs-default={item.id === resolvedId ? "" : undefined} aria-label={item.title} aria-current={item.id === resolvedId ? "true" : undefined} onFocus={() => setSelectedId(item.id)} onMouseEnter={() => setSelectedId(item.id)} onClick={() => session.openDetails(item.id)} className="pn-tile"><GameCover title={item.title} src={item.coverUrl} layout="grid" /></button>)}</div>
          {visible.length === 0 && <div className="fs-empty"><Gamepad2 /><p>{games.length ? t.library.noResultsTitle : t.library.emptyDescription}</p>{!games.length && <button type="button" onClick={onOpenEmulators}>{t.library.goToEmulators}</button>}</div>}
          {game && <p className="pn-selected">{game.title}{game.favorite && <Star className="pn-favorite" />}<span>{[game.platform, status].filter(Boolean).join(" · ")}</span></p>}
          <div className="pn-blocks">
            <section className="pn-block pn-block-continue"><h2><Play />{t.fullscreen.continuePlaying}</h2>{lastPlayed ? <>
              <p className="pn-block-title">{lastPlayed.title}</p>
              <p>{formatPlaytime(lastPlayed.playtimeMinutes, t)}</p>
              <button type="button" className="pn-play" disabled={!session.canPlay(lastPlayed)} onClick={() => void session.play(lastPlayed)}><Play />{t.fullscreen.play}</button>
            </> : <p>{t.fullscreen.nothingPlayed}</p>}</section>
            <section className="pn-block"><h2><Library />{t.fullscreen.collections}</h2><div className="pn-block-buttons">{FULLSCREEN_COLLECTIONS.map((value) => <button type="button" key={value} aria-pressed={!query && collection === value} onClick={() => session.changeCollection(value)}>{label(value)}</button>)}</div></section>
            <section className="pn-block"><h2><Trophy />{t.fields.achievements}</h2>{overview && overview.total > 0 ? <>
              <p className="pn-block-title">{t.fullscreen.trophyTotal(overview.unlocked, overview.total)}</p>
              {overview.recent.length > 0 && <ul aria-label={t.fullscreen.recentUnlocks}>{overview.recent.slice(0, 2).map((item) => <li key={item.key}>{item.title}<span>{item.gameTitle}</span></li>)}</ul>}
            </> : <p>{t.fullscreen.noAchievements}</p>}<button type="button" onClick={() => setPanel("trophies")}>{t.fullscreen.achievements}</button></section>
            <section className="pn-block"><h2><BarChart3 />{t.fullscreen.statistics}</h2><dl>
              <div><dt>{t.fullscreen.totalPlaytime}</dt><dd>{formatPlaytime(totalMinutes, t)}</dd></div>
              <div><dt>{t.fullscreen.last30Days}</dt><dd>{days ? formatPlaytime(activityTotals(days).minutes, t) : "—"}</dd></div>
            </dl></section>
          </div>
        </div>}
        {session.disconnected && <p className="pn-status" role="status">{t.fullscreen.disconnected}</p>}
      </section>
      <FullscreenPanels session={session} />
    </div>
  )
}
