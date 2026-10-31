import { useState } from "react"
import { ArrowLeft, Bell, Gamepad2, ListFilter, MoreHorizontal, Play, Power, Search, Settings2, Star, Trophy } from "lucide-react"
import { GameCover } from "@/components/GameCover"
import { ControllerIndicator } from "@/components/ControllerIndicator"
import { hasActiveFilters } from "@/lib/filters"
import { FullscreenMedia } from "../FullscreenMedia"
import { FullscreenClock } from "../FullscreenClock"
import { FullscreenPanels } from "../FullscreenPanels"
import { FullscreenDevBadge, FullscreenGameFacts, FullscreenPlaytime, FullscreenRatingText, FullscreenTrophyText } from "../FullscreenParts"
import { FULLSCREEN_COLLECTIONS, type FullscreenThemeProps } from "../useFullscreenSession"

/**
 * Mosaico, inspirado na tela inicial do Switch: capas grandes e quadradas numa linha, os atalhos redondos embaixo e
 * uma barra fina com o relógio e o controle; os detalhes com a capa à esquerda e as informações em lista. O fundo é
 * liso: o trailer só aparece nos detalhes, num quadro ao lado da capa.
 */
export function MosaicoShell({ session, onOpenEmulators }: FullscreenThemeProps) {
  const { t, config, notices, collection, label, query, visible, resolvedId, setSelectedId, game, details, setDetails, setPanel, panel, status, editing, games } = session
  const trailer = details && (config?.mosaicoTrailers ?? "details") === "details"
  const [frame, setFrame] = useState<HTMLDivElement | null>(null)
  const shortcuts = [
    { key: "search", icon: Search, label: t.fullscreen.search, open: () => setPanel("search") },
    { key: "filters", icon: ListFilter, label: t.fullscreen.filtersAndCollections, open: () => setPanel("filters"), pressed: hasActiveFilters(session.filters) || session.sort !== "collection" },
    { key: "trophies", icon: Trophy, label: t.fields.achievements, open: () => setPanel("trophies") },
    { key: "notices", icon: Bell, label: t.fullscreen.notices, open: session.openNotices, badge: notices.unseen },
    { key: "preferences", icon: Settings2, label: t.fullscreen.settings, open: () => setPanel("preferences") },
    { key: "menu", icon: Power, label: t.fullscreen.power, open: () => setPanel("menu") },
  ]

  return (
    <div {...session.rootProps} className="mosaico-fullscreen">
      {/* Sem arte de fundo: a mídia fica para a música e para o quadro do trailer nos detalhes. */}
      <FullscreenMedia game={game} playVideo={trailer} videoDelay={600} suspended={session.suspended} container={trailer ? frame : null} />
      <section ref={panel ? undefined : session.scope} className="ms-main" inert={panel !== null || session.busy}>
        <header className="ms-top">
          <nav aria-label={t.fullscreen.collection} className="ms-collections">{FULLSCREEN_COLLECTIONS.map((value) => <button type="button" key={value} aria-pressed={!query && collection === value} onClick={() => session.changeCollection(value)}>{label(value)}</button>)}</nav>
          <FullscreenDevBadge />
          <div className="ms-status">{config?.showClock && <FullscreenClock className="ms-clock" />}<ControllerIndicator /></div>
        </header>
        {details && game ? <div className="ms-details" data-testid="fullscreen-details">
          <div className="ms-details-side">
            <div className="ms-details-cover"><GameCover title={game.title} src={game.coverUrl} /></div>
            {trailer && game.backgroundVideoUrl && <div ref={setFrame} className="ms-trailer-frame" />}
          </div>
          <div className="ms-details-info">
            <button type="button" className="ms-back" onClick={() => setDetails(false)}><ArrowLeft />{t.fullscreen.back}</button>
            <h1>{game.title}{game.favorite && <Star className="ms-favorite" />}</h1>
            <div className="ms-actions">
              <button type="button" data-fs-default className="ms-play" disabled={!session.canPlay()} onClick={() => void session.play()}><Play />{session.launching ? t.fullscreen.launching : t.fullscreen.play}</button>
              <button type="button" data-fs-fallback aria-label={t.fullscreen.options} onClick={() => setPanel("options")}><MoreHorizontal /></button>
              <button type="button" aria-label={t.fullscreen.favorite} aria-pressed={game.favorite} disabled={editing} onClick={session.favorite}><Star /></button>
            </div>
            <div className="ms-list">
              <FullscreenGameFacts game={game} status={status} />
              <FullscreenPlaytime game={game} />
              <div className="ms-row"><Trophy /><FullscreenTrophyText game={game} />{game.achievements && <button type="button" onClick={() => setPanel("achievements")}>{t.fullscreen.achievements}</button>}</div>
              <div className="ms-row"><Star /><div><FullscreenRatingText game={game} /></div><button type="button" onClick={session.openReview}>{t.fullscreen.editReview}</button></div>
            </div>
            <div className="ms-description" data-testid="fullscreen-description" data-fs-scroll tabIndex={0}><h2>{t.details.description}</h2><p>{game.description || t.fullscreen.noDescription}</p></div>
          </div>
        </div> : <div className="ms-home" data-testid="fullscreen-library">
          <p className="ms-title">{game ? game.title : query ? t.fullscreen.searchResults : label(collection)}</p>
          {query && <button type="button" className="ms-clear" onClick={session.clearSearch}>{t.fullscreen.clearSearch}</button>}
          <div className="ms-rail" data-fs-rail>{visible.map((item) => <button type="button" key={item.id} data-testid={`fullscreen-game-${item.id}`} data-fs-default={item.id === resolvedId ? "" : undefined} aria-label={item.title} aria-current={item.id === resolvedId ? "true" : undefined} onFocus={() => setSelectedId(item.id)} onMouseEnter={() => setSelectedId(item.id)} onClick={() => session.openDetails(item.id)} className="ms-tile"><GameCover title={item.title} src={item.coverUrl} /></button>)}</div>
          {visible.length === 0 && <div className="fs-empty"><Gamepad2 /><p>{games.length ? t.library.noResultsTitle : t.library.emptyDescription}</p>{!games.length && <button type="button" onClick={onOpenEmulators}>{t.library.goToEmulators}</button>}</div>}
          <nav className="ms-shortcuts" aria-label={t.fullscreen.shortcuts}>{shortcuts.map(({ key, icon: Icon, label: name, open, pressed, badge }) => <button type="button" key={key} aria-label={name} aria-pressed={pressed} onClick={open}><Icon />{badge ? <span className="fs-badge" aria-hidden="true">{badge}</span> : null}<span className="ms-shortcut-label">{name}</span></button>)}</nav>
        </div>}
        {session.disconnected && <p className="ms-disconnected" role="status">{t.fullscreen.disconnected}</p>}
      </section>
      <FullscreenPanels session={session} />
    </div>
  )
}
