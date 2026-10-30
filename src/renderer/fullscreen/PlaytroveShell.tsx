import { ArrowLeft, Bell, Gamepad2, ListFilter, Menu, MoreHorizontal, Play, Search, Star, Trophy } from "lucide-react"
import { GameCover } from "@/components/GameCover"
import { AppLogo } from "@/components/AppLogo"
import { ControllerIndicator } from "@/components/ControllerIndicator"
import { hasActiveFilters } from "@/lib/filters"
import { devMark } from "@/lib/devBuild"
import { formatPlaytime } from "@/lib/format"
import { FullscreenMedia } from "./FullscreenMedia"
import { FullscreenClock } from "./FullscreenClock"
import { FullscreenPanels } from "./FullscreenPanels"
import { FULLSCREEN_COLLECTIONS, type FullscreenThemeProps } from "./useFullscreenSession"

/** O tema Playtrove, o padrão: segue a tela cheia do próprio Playnite. */
export function PlaytroveShell({ session, onOpenEmulators }: FullscreenThemeProps) {
  const { t, config, notices, collection, label, query, filters, sort, visible, resolvedId, setSelectedId, game, details, setDetails, setPanel, panel, status, editing, launching, running, disconnected, games } = session
  const trailers = config?.playtroveTrailers ?? "all"

  return (
    <div {...session.rootProps} className="playtrove-fullscreen">
      <FullscreenMedia game={game} playVideo={trailers === "all" || (trailers === "details" && details)} videoDelay={details ? 600 : 1000} suspended={session.suspended} />
      <section ref={panel ? undefined : session.scope} className="fs-main" inert={panel !== null || running.length > 0 || launching}>
        <header className="fs-header">
          <div className="fs-brand relative">
            <AppLogo />
            {devMark && (
              <span
                title={devMark === "tests" ? t.topBar.devTestsHint : t.topBar.devHint}
                className="absolute -bottom-1.5 left-0 rounded bg-dev px-1 text-[9px] leading-3.5 font-bold text-dev-foreground"
              >
                {t.topBar.dev}
              </span>
            )}
            <span>{"Playtrove"}</span>
          </div>
          <nav aria-label={t.fullscreen.collection} className="fs-collections">{FULLSCREEN_COLLECTIONS.map((value) => <button type="button" key={value} aria-pressed={!query && collection === value} onClick={() => session.changeCollection(value)}>{label(value)}</button>)}</nav>
          <div className="fs-header-tools">{config?.showClock && <FullscreenClock className="fs-clock" />}<ControllerIndicator /><button type="button" aria-label={t.fullscreen.search} onClick={() => setPanel("search")}><Search /></button><button type="button" aria-label={t.filters.title} aria-pressed={hasActiveFilters(filters) || sort !== "collection"} onClick={() => setPanel("filters")}><ListFilter /></button><button type="button" aria-label={t.fullscreen.notices} className="fs-notices-button" onClick={session.openNotices}><Bell />{notices.unseen > 0 && <span className="fs-badge" aria-hidden="true">{notices.unseen}</span>}</button><button type="button" className="fs-menu-button" onClick={() => setPanel("menu")}><Menu />{t.fullscreen.menu}</button></div>
        </header>
        {details && game ? <div className="fs-signature" data-testid="fullscreen-details">
          <div className="fs-signature-heading">
            <button type="button" className="fs-back" onClick={() => setDetails(false)}><ArrowLeft />{t.fullscreen.back}</button>
            <p className="fs-eyebrow">{[game.platform, game.library].filter(Boolean).join(" · ")}</p>
            <h1>{game.title}{game.favorite && <Star className="fs-favorite" />}</h1>
          </div>
          <div className="fs-signature-card">
            <div className="fs-signature-cover"><GameCover title={game.title} src={game.coverUrl} /></div>
            <div className="fs-signature-content">
              <p className="fs-eyebrow">{[game.developers.join(", "), game.releaseDate?.slice(0, 4)].filter(Boolean).join(" · ")}</p>
              <div className="fs-details-actions">
                <button type="button" data-fs-default className="fs-primary fs-play" disabled={!session.canPlay()} onClick={() => void session.play()}><Play />{launching ? t.fullscreen.launching : t.fullscreen.play}</button>
                <button type="button" data-fs-fallback aria-label={t.fullscreen.options} onClick={() => setPanel("options")}><MoreHorizontal /></button>
                <button type="button" aria-label={t.fullscreen.favorite} aria-pressed={game.favorite} disabled={editing} onClick={session.favorite}><Star /></button>
              </div>
              <dl className="fs-facts">
                <div><dt>{t.fields.status}</dt><dd>{status}</dd></div>
                <div><dt>{t.fields.playtime}</dt><dd>{formatPlaytime(game.playtimeMinutes, t)}</dd></div>
                <div><dt>{t.fields.rating}</dt><dd>{game.rating !== null ? (game.rating / 2).toLocaleString(t.locale) + " / 5" : "—"}</dd></div>
                <div><dt>{t.fields.difficulty}</dt><dd>{game.difficulty !== null ? (game.difficulty / 2).toLocaleString(t.locale) + " / 5" : "—"}</dd></div>
              </dl>
              <div className="fs-achievement-card"><Trophy /><div><h2>{t.fields.achievements}</h2>{game.achievements ? <p>{game.achievements.unlocked} / {game.achievements.total}</p> : <p>{game.trophiesPending ? t.achievements.trophiesPending : t.fullscreen.noAchievements}</p>}</div>{game.achievements && <button type="button" onClick={() => setPanel("achievements")}>{t.fullscreen.achievements}</button>}</div>
              <button type="button" onClick={session.openReview}>{t.fullscreen.editReview}</button>
            </div>
          </div>
          <div className="fs-description" data-testid="fullscreen-description" data-fs-scroll tabIndex={0}><h2>{t.details.description}</h2><p>{game.description || t.fullscreen.noDescription}</p>{game.review && <><h2>{t.fullscreen.review}</h2><p className="fs-review-text">{game.review}</p></>}</div>
        </div> : <div className="fs-library" data-testid="fullscreen-library">
          <div className="fs-game-info"><p className="fs-eyebrow">{[game?.platform, game?.library].filter(Boolean).join(" · ")}</p><h1>{game?.title ?? t.library.emptyTitle}{game?.favorite && <Star className="fs-favorite" />}</h1></div>
          {game && <aside className="fs-library-stats"><dl><div><dt>{t.fields.status}</dt><dd>{status}</dd></div><div><dt>{t.fields.playtime}</dt><dd>{formatPlaytime(game.playtimeMinutes, t)}</dd></div>{game.rating !== null && <div><dt>{t.fields.rating}</dt><dd>{(game.rating / 2).toLocaleString(t.locale)} / 5</dd></div>}{game.achievements && <div><dt>{t.fields.achievements}</dt><dd><Trophy />{game.achievements.unlocked} / {game.achievements.total}</dd></div>}</dl></aside>}
          <div className="fs-library-bottom"><p className="fs-rail-controls">{t.fullscreen.controls}</p><div className="fs-rail-heading"><h2>{query ? t.fullscreen.searchResults : label(collection)}</h2><span>{t.common.games(visible.length)}</span>{query && <button type="button" onClick={session.clearSearch}>{t.fullscreen.clearSearch}</button>}</div><div className="fs-cover-rail" data-rows={config?.coverRows ?? 1}>{visible.map((item) => <button type="button" key={item.id} data-testid={`fullscreen-game-${item.id}`} data-fs-default={item.id === resolvedId ? "" : undefined} aria-label={item.title} aria-current={item.id === resolvedId ? "true" : undefined} onFocus={() => setSelectedId(item.id)} onMouseEnter={() => setSelectedId(item.id)} onClick={() => session.openDetails(item.id)} className="fs-cover"><GameCover title={item.title} src={item.coverUrl} layout="grid" /><span>{item.title}</span></button>)}</div>{visible.length === 0 && <div className="fs-empty"><Gamepad2 /><p>{games.length ? t.library.noResultsTitle : t.library.emptyDescription}</p>{!games.length && <button type="button" onClick={onOpenEmulators}>{t.library.goToEmulators}</button>}</div>}</div>
        </div>}
        <footer className="fs-footer"><span>{details ? t.fullscreen.controls : ""}</span>{disconnected && <span role="status">{t.fullscreen.disconnected}</span>}</footer>
      </section>
      <FullscreenPanels session={session} />
    </div>
  )
}
