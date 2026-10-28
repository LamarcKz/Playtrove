import type { ReactNode } from "react"
import { CalendarDays, CircleDot, Clock, Gamepad2, Star, Tag, Trophy } from "lucide-react"
import type { FullscreenInterface, LibraryLayout } from "@shared/fullscreen"
import type { Game } from "@shared/types"
import { genreLabel } from "@shared/i18n"
import { GameCover } from "@/components/GameCover"
import { useI18n } from "@/hooks/useI18n"
import { formatLastPlayed, formatPlaytime } from "@/lib/format"
import { AnikiIcon } from "./AnikiGlyph"
import { AnikiLogo } from "./AnikiLogo"
import { IconFact } from "./AnikiDetails"
import { AnikiTrailerCard } from "./AnikiTrailerCard"
import { progressPercent } from "@/lib/achievements"
import { AnikiShortcutBar, type AnikiShortcut } from "./AnikiShortcutBar"

interface Props {
  layout: LibraryLayout
  interfaceStyle: FullscreenInterface
  /** O trailer do jogo toca sem som atrás da biblioteca horizontal (trailers em "Biblioteca e detalhes"). */
  trailer: boolean
  playVideo: boolean
  game: Game | undefined
  games: Game[]
  visible: Game[]
  selectedId: number | null
  query: string
  collectionLabel: string
  status: string | undefined
  shortcuts: AnikiShortcut[]
  onSelect: (id: number) => void
  onOpen: (id: number) => void
  onClearSearch: () => void
  onOpenEmulators: () => void
}

/**
 * Biblioteca do Aniki nos três layouts: Horizontal (nome sobre a arte, etiquetas, atalhos e a faixa de
 * capas), Vertical (nome no alto e as capas em grade) e Lista (a lista à esquerda e o jogo à direita).
 */
export function AnikiLibrary({ layout, interfaceStyle, trailer, playVideo, game, games, visible, selectedId, query, collectionLabel, status, shortcuts, onSelect, onOpen, onClearSearch, onOpenEmulators }: Props) {
  const { t } = useI18n()
  const item = (entry: Game, children: ReactNode) => <button
    type="button"
    key={entry.id}
    data-testid={`fullscreen-game-${entry.id}`}
    data-fs-default={entry.id === selectedId ? "" : undefined}
    aria-label={entry.title}
    aria-current={entry.id === selectedId ? "true" : undefined}
    onFocus={() => onSelect(entry.id)}
    onMouseEnter={() => onSelect(entry.id)}
    onClick={() => onOpen(entry.id)}
    className={layout === "list" ? "aniki-list-item" : "aniki-cover"}
  >{children}</button>
  const cover = (entry: Game) => <>
    <GameCover title={entry.title} src={entry.coverUrl} layout="grid" />
    {entry.achievements && entry.id === selectedId && <span className="aniki-cover-trophy"><AnikiIcon icon="trophy" /></span>}
  </>
  const empty = visible.length === 0 && <div className="aniki-empty"><Gamepad2 /><p>{games.length ? t.library.noResultsTitle : t.library.emptyDescription}</p>{!games.length && <button type="button" onClick={onOpenEmulators}>{t.library.goToEmulators}</button>}</div>
  const clear = query && <button type="button" className="aniki-chip aniki-clear-search" onClick={onClearSearch}>{t.fullscreen.clearSearch}</button>
  if (layout === "list") return <div className="aniki-library aniki-library-list" data-testid="fullscreen-library">
    <section className="aniki-list-column">
      <header><p className="aniki-list-collection">{collectionLabel}</p><span>{t.common.games(visible.length)}</span>{clear}</header>
      <div className="aniki-list-items">{visible.map((entry) => item(entry, <>
        <span className="aniki-list-cover"><GameCover title={entry.title} src={entry.coverUrl} layout="grid" /></span>
        <span className="aniki-list-info"><strong>{entry.title}</strong><small>{entry.platform ?? entry.library}</small></span>
        {entry.favorite && <AnikiIcon icon="heartFilled" />}
      </>))}</div>
      {empty}
    </section>
    {game && <section className="aniki-list-game">
      <h1>{game.title}</h1>
      <p className="aniki-list-sub">{[game.developers.join(", "), game.releaseDate?.slice(0, 4)].filter(Boolean).join(" · ")}</p>
      <div className="aniki-list-hero">
        {(game.backgroundUrl ?? game.coverUrl) && <img src={game.backgroundUrl ?? game.coverUrl!} alt="" />}
      </div>
      <dl className="aniki-list-cards">
        <div><dt>{t.fields.playtime}</dt><dd>{formatPlaytime(game.playtimeMinutes, t)}</dd></div>
        <div><dt>{t.fields.lastPlayed}</dt><dd>{formatLastPlayed(game.lastPlayedAt, t)}</dd></div>
        <div><dt>{t.fields.status}</dt><dd>{status}</dd></div>
        <div><dt>{t.fields.rating}</dt><dd>{game.rating !== null ? `${(game.rating / 2).toLocaleString(t.locale)} / 5` : "—"}</dd></div>
        <div><dt>{t.fields.genre}</dt><dd>{game.genres.slice(0, 2).map((genre) => genreLabel(genre, t)).join(" · ") || "—"}</dd></div>
        <div><dt>{t.fields.platform}</dt><dd>{game.platform ?? game.library ?? "—"}</dd></div>
        <div><dt>{t.fields.achievements}</dt><dd>{game.achievements ? `${game.achievements.unlocked} / ${game.achievements.total}` : "—"}</dd></div>
        <div><dt>{t.fields.difficulty}</dt><dd>{game.difficulty !== null ? `${(game.difficulty / 2).toLocaleString(t.locale)} / 5` : "—"}</dd></div>
      </dl>
    </section>}
    <AnikiShortcutBar shortcuts={shortcuts} />
  </div>
  if (layout === "vertical") return <div className="aniki-library aniki-library-vertical" data-testid="fullscreen-library">
    <p className="aniki-preset">{collectionLabel}</p>
    <h1 className="aniki-vertical-title">{game ? <AnikiLogo game={game} /> : t.library.emptyTitle}</h1>
    {clear}
    <div className="aniki-grid">{visible.map((entry) => item(entry, cover(entry)))}</div>
    {empty}
    <AnikiShortcutBar shortcuts={shortcuts} />
  </div>
  return <div className="aniki-library" data-testid="fullscreen-library">
    <p className="aniki-preset">{collectionLabel}</p>
    <div className="aniki-hero">
      <h1 className="aniki-game-title">{game ? <AnikiLogo game={game} /> : t.library.emptyTitle}</h1>
    </div>
    {trailer && game?.backgroundVideoUrl && <AnikiTrailerCard key={game.backgroundVideoUrl} url={game.backgroundVideoUrl} play={playVideo} className="aniki-trailer-background" />}
    {game && interfaceStyle === "complete" && <aside className="aniki-side-info" aria-label={game.title}>
      <ul className="aniki-details-iconfacts">
        {game.achievements && <IconFact icon={Trophy} label={t.fields.achievements}>{game.achievements.unlocked} / {game.achievements.total} · {progressPercent(game.achievements.unlocked, game.achievements.total)}%</IconFact>}
        <IconFact icon={Clock} label={t.fields.playtime}>{formatPlaytime(game.playtimeMinutes, t)}</IconFact>
        <IconFact icon={CalendarDays} label={t.fields.lastPlayed}>{formatLastPlayed(game.lastPlayedAt, t)}</IconFact>
        {game.genres.length > 0 && <IconFact icon={Tag} label={t.fields.genre}>{game.genres.slice(0, 2).map((genre) => genreLabel(genre, t)).join(" · ")}</IconFact>}
        {status && <IconFact icon={CircleDot} label={t.fields.status}>{status}</IconFact>}
        {game.rating !== null && <IconFact icon={Star} label={t.fields.rating}>{(game.rating / 2).toLocaleString(t.locale)} / 5</IconFact>}
        {(game.platform ?? game.library) && <IconFact icon={Gamepad2} label={t.fields.platform}>{game.platform ?? game.library}</IconFact>}
      </ul>
    </aside>}
    {game && interfaceStyle !== "complete" && <div className="aniki-chips">
      {clear}
      {game.favorite && <span className="aniki-chip"><AnikiIcon icon="heartFilled" />{t.fullscreen.favorite}</span>}
      {game.achievements && <span className="aniki-chip"><AnikiIcon icon="trophy" />{game.achievements.unlocked} / {game.achievements.total}</span>}
      {(game.platform ?? game.library) && <span className="aniki-chip aniki-chip-source">{game.platform ?? game.library}</span>}
    </div>}
    <AnikiShortcutBar shortcuts={shortcuts} />
    <div className="aniki-rail">{visible.map((entry) => item(entry, cover(entry)))}</div>
    {empty}
  </div>
}
