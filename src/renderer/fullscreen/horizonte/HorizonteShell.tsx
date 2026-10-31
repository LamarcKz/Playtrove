import { ArrowLeft, Bell, Clock3, Gamepad2, Info, ListFilter, Menu, MoreHorizontal, Play, Search, Star, Trophy } from "lucide-react"
import { GameCover } from "@/components/GameCover"
import { ControllerIndicator } from "@/components/ControllerIndicator"
import { hasActiveFilters } from "@/lib/filters"
import { FullscreenMedia } from "../FullscreenMedia"
import { FullscreenClock } from "../FullscreenClock"
import { FullscreenPanels } from "../FullscreenPanels"
import { FullscreenDevBadge, FullscreenGameFacts, FullscreenGameLogo, FullscreenPlaytime, FullscreenRatingText, FullscreenTrophyText } from "../FullscreenParts"
import { FULLSCREEN_COLLECTIONS, type FullscreenThemeProps } from "../useFullscreenSession"

/**
 * Horizonte, inspirado na tela inicial do PS5: a fileira de jogos no topo, a arte (e o trailer) enchendo a tela, a
 * logo do jogo com o Jogar e os cartões embaixo; os detalhes com a arte cheia e as informações rolando.
 */
export function HorizonteShell({ session, onOpenEmulators }: FullscreenThemeProps) {
  const { t, config, notices, collection, label, query, visible, resolvedId, setSelectedId, game, details, setDetails, setPanel, panel, status, editing, games } = session
  const trailers = config?.horizonteTrailers ?? "all"

  return (
    <div {...session.rootProps} className="horizonte-fullscreen">
      <FullscreenMedia game={game} playVideo={trailers === "all" || (trailers === "details" && details)} videoDelay={details ? 600 : 2000} suspended={session.suspended} />
      <section ref={panel ? undefined : session.scope} className="hz-main" inert={panel !== null || session.busy}>
        <header className="hz-top">
          <nav aria-label={t.fullscreen.collection} className="hz-collections">{FULLSCREEN_COLLECTIONS.map((value) => <button type="button" key={value} aria-pressed={!query && collection === value} onClick={() => session.changeCollection(value)}>{label(value)}</button>)}</nav>
          <FullscreenDevBadge />
          <div className="hz-tools">
            <button type="button" aria-label={t.fullscreen.search} onClick={() => setPanel("search")}><Search /></button>
            <button type="button" aria-label={t.filters.title} aria-pressed={hasActiveFilters(session.filters) || session.sort !== "collection"} onClick={() => setPanel("filters")}><ListFilter /></button>
            <button type="button" aria-label={t.fullscreen.notices} className="hz-badged" onClick={session.openNotices}><Bell />{notices.unseen > 0 && <span className="fs-badge" aria-hidden="true">{notices.unseen}</span>}</button>
            <ControllerIndicator />
            {config?.showClock && <FullscreenClock className="hz-clock" />}
            <button type="button" aria-label={t.fullscreen.menu} onClick={() => setPanel("menu")}><Menu /></button>
          </div>
        </header>
        {details && game ? <div className="hz-details" data-testid="fullscreen-details">
          <div className="hz-details-hero">
            <button type="button" className="hz-back" onClick={() => setDetails(false)}><ArrowLeft />{t.fullscreen.back}</button>
            <FullscreenGameLogo game={game} className="hz-logo" />
            <p className="hz-eyebrow">{[game.platform, game.library].filter(Boolean).join(" · ")}{game.favorite && <Star className="hz-favorite" />}</p>
            <div className="hz-actions">
              <button type="button" data-fs-default className="hz-play" disabled={!session.canPlay()} onClick={() => void session.play()}><Play />{session.launching ? t.fullscreen.launching : t.fullscreen.play}</button>
              <button type="button" data-fs-fallback aria-label={t.fullscreen.options} onClick={() => setPanel("options")}><MoreHorizontal /></button>
              <button type="button" aria-label={t.fullscreen.favorite} aria-pressed={game.favorite} disabled={editing} onClick={session.favorite}><Star /></button>
            </div>
          </div>
          <div className="hz-details-cards">
            <section className="hz-card"><h2><Trophy />{t.fields.achievements}</h2><FullscreenTrophyText game={game} />{game.achievements && <button type="button" onClick={() => setPanel("achievements")}>{t.fullscreen.achievements}</button>}</section>
            <section className="hz-card"><h2><Clock3 />{t.fields.playtime}</h2><FullscreenPlaytime game={game} /></section>
            <section className="hz-card"><h2><Star />{t.fullscreen.review}</h2><FullscreenRatingText game={game} /><button type="button" onClick={session.openReview}>{t.fullscreen.editReview}</button></section>
            <section className="hz-card hz-card-wide"><h2><Info />{t.fullscreen.information}</h2><FullscreenGameFacts game={game} status={status} /></section>
          </div>
          <div className="hz-description" data-testid="fullscreen-description" data-fs-scroll tabIndex={0}><h2>{t.details.description}</h2><p>{game.description || t.fullscreen.noDescription}</p></div>
        </div> : <div className="hz-home" data-testid="fullscreen-library">
          <div className="hz-rail-heading"><span>{query ? t.fullscreen.searchResults : label(collection)} · {t.common.games(visible.length)}</span>{query && <button type="button" onClick={session.clearSearch}>{t.fullscreen.clearSearch}</button>}</div>
          <div className="hz-rail" data-fs-rail>{visible.map((item) => <button type="button" key={item.id} data-testid={`fullscreen-game-${item.id}`} data-fs-default={item.id === resolvedId ? "" : undefined} aria-label={item.title} aria-current={item.id === resolvedId ? "true" : undefined} onFocus={() => setSelectedId(item.id)} onMouseEnter={() => setSelectedId(item.id)} onClick={() => session.openDetails(item.id)} className="hz-tile"><GameCover title={item.title} src={item.coverUrl} layout="grid" />{item.id === resolvedId && <span className="hz-tile-title">{item.title}</span>}</button>)}</div>
          {visible.length === 0 && <div className="fs-empty"><Gamepad2 /><p>{games.length ? t.library.noResultsTitle : t.library.emptyDescription}</p>{!games.length && <button type="button" onClick={onOpenEmulators}>{t.library.goToEmulators}</button>}</div>}
          {game && <>
            <div className="hz-hero" key={`hero-${game.id}`}>
              <FullscreenGameLogo game={game} className="hz-logo" />
              <p className="hz-eyebrow">{[game.platform, status].filter(Boolean).join(" · ")}{game.favorite && <Star className="hz-favorite" />}</p>
              <div className="hz-actions">
                <button type="button" className="hz-play" disabled={!session.canPlay()} onClick={() => void session.play()}><Play />{session.launching ? t.fullscreen.launching : t.fullscreen.play}</button>
                <button type="button" aria-label={t.fullscreen.options} onClick={() => session.openDetails(game.id)}><MoreHorizontal /></button>
              </div>
            </div>
            <div className="hz-cards" key={`cards-${game.id}`}>
              <section className="hz-card"><h2><Trophy />{t.fields.achievements}</h2><FullscreenTrophyText game={game} /></section>
              <section className="hz-card"><h2><Clock3 />{t.fields.playtime}</h2><FullscreenPlaytime game={game} /></section>
              <section className="hz-card"><h2><Star />{t.fullscreen.review}</h2><FullscreenRatingText game={game} /></section>
            </div>
          </>}
        </div>}
        {session.disconnected && <p className="hz-status" role="status">{t.fullscreen.disconnected}</p>}
      </section>
      <FullscreenPanels session={session} />
    </div>
  )
}
