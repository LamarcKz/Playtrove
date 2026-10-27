import type { ReactNode } from "react"
import { CalendarDays, CircleDot, Clock, Gamepad2, Info, Play, SlidersHorizontal, Star, Tag, Trophy, type LucideIcon } from "lucide-react"
import type { DetailsLayout } from "@shared/fullscreen"
import type { Game } from "@shared/types"
import { genreLabel } from "@shared/i18n"
import { GameCover } from "@/components/GameCover"
import { PepperIcon } from "@/components/icons/PepperIcon"
import { ProgressBar } from "@/components/AchievementParts"
import { useI18n } from "@/hooks/useI18n"
import { formatLastPlayed, formatPlaytime, formatReleaseDate } from "@/lib/format"
import { progressPercent } from "@/lib/achievements"
import { AnikiIcon } from "./AnikiGlyph"
import { AnikiTrailerCard } from "./AnikiTrailerCard"
import { AnikiLogo } from "./AnikiLogo"

interface Props {
  layout: DetailsLayout
  game: Game
  status: string | undefined
  canPlay: boolean
  playLabel: string
  playDisabled: boolean
  playVideo: boolean
  onPlay: () => void
  onTrophies: () => void
  onDescription: () => void
  onOptions: () => void
  onReview: () => void
}

/**
 * Detalhes nos seis layouts do Aniki (GameDetails e os de "7.Other Views"): Signature, Moderno, Clássico,
 * Original, Showcase e Painéis. Todos usam as mesmas peças, em lugares diferentes.
 */
export function AnikiDetails({ layout, game, status, canPlay, playLabel, playDisabled, playVideo, onPlay, onTrophies, onDescription, onOptions, onReview }: Props) {
  const { t } = useI18n()
  const year = game.releaseDate?.slice(0, 4)
  const achievements = game.achievements
  const percent = achievements ? progressPercent(achievements.unlocked, achievements.total) : 0
  const genres = game.genres.map((genre) => genreLabel(genre, t))
  const rating = game.rating !== null ? `${(game.rating / 2).toLocaleString(t.locale)} / 5` : null
  const difficulty = game.difficulty !== null ? `${(game.difficulty / 2).toLocaleString(t.locale)} / 5` : null

  const title = <h1 className="aniki-details-title"><AnikiLogo game={game} />{game.favorite && <AnikiIcon icon="heartFilled" />}</h1>
  const studio = (game.developers.length > 0 || year) && <p className="aniki-details-studio">{game.developers.join(", ")} <strong>{year}</strong></p>
  const cover = <div className="aniki-details-cover">
    <GameCover title={game.title} src={game.coverUrl} />
    {(game.rating !== null || game.difficulty !== null) && <div className="aniki-details-scores">
      {game.rating !== null && <span title={t.fields.rating}><AnikiIcon icon="star" />{(game.rating / 2).toLocaleString(t.locale)}</span>}
      {game.difficulty !== null && <span title={t.fields.difficulty}><PepperIcon />{(game.difficulty / 2).toLocaleString(t.locale)}</span>}
    </div>}
  </div>
  const play = <button type="button" data-fs-default className="aniki-details-play" disabled={!canPlay || playDisabled} onClick={onPlay}><Play />{playLabel}</button>
  const icons = <>
    {achievements && <button type="button" aria-label={t.fields.achievements} title={t.fields.achievements} onClick={onTrophies}><Trophy /></button>}
    <button type="button" aria-label={t.details.description} title={t.details.description} onClick={onDescription}><Info /></button>
    <button type="button" data-fs-fallback aria-label={t.fullscreen.options} title={t.fullscreen.options} onClick={onOptions}><SlidersHorizontal /></button>
  </>
  const iconFacts = <ul className="aniki-details-iconfacts">
    <IconFact icon={Clock} label={t.fields.playtime}>{formatPlaytime(game.playtimeMinutes, t)}</IconFact>
    <IconFact icon={CalendarDays} label={t.fields.lastPlayed}>{formatLastPlayed(game.lastPlayedAt, t)}</IconFact>
    {achievements && <IconFact icon={Trophy} label={t.fields.achievements}>{achievements.unlocked} / {achievements.total}</IconFact>}
    {genres.length > 0 && <IconFact icon={Tag} label={t.fields.genre}>{genres.join(" & ")}</IconFact>}
    {status && <IconFact icon={CircleDot} label={t.fields.status}>{status}</IconFact>}
    {(game.platform ?? game.library) && <IconFact icon={Gamepad2} label={t.fields.platform}>{game.platform ?? game.library}</IconFact>}
    {(rating || difficulty) && <IconFact icon={Star} label={t.fields.rating}>{[rating && `${t.fields.rating} ${rating}`, difficulty && `${t.fields.difficulty} ${difficulty}`].filter(Boolean).join(" / ")}</IconFact>}
  </ul>
  const lines = (entries: [string, ReactNode][]) => <dl className="aniki-details-lines">{entries.filter(([, value]) => value !== null && value !== undefined && value !== "").map(([label, value]) => <div key={label}><dt>{label} :</dt><dd>{value}</dd></div>)}</dl>
  const achievementBar = achievements
    ? <button type="button" className="aniki-details-achievements" onClick={onTrophies}>
      <Trophy />
      <span><strong>{achievements.unlocked}</strong> / {achievements.total} <small>{t.fields.achievements}</small></span>
      <ProgressBar value={percent} label={t.fields.achievements} className="aniki-details-progress" />
      <span className="aniki-details-percent">{percent}%</span>
    </button>
    : <p className="aniki-details-none">{game.trophiesPending ? t.achievements.trophiesPending : t.fullscreen.noAchievements}</p>
  const description = <div className="aniki-details-description" data-fs-scroll tabIndex={0}><p>{game.description || t.fullscreen.noDescription}</p></div>
  const trailer = (position: string) => game.backgroundVideoUrl && <AnikiTrailerCard key={game.backgroundVideoUrl} url={game.backgroundVideoUrl} play={playVideo} className={position} />

  return <div className={`aniki-details aniki-details-${layout}`} data-testid="fullscreen-details" data-layout={layout}>
    {layout === "signature" && <>
      {title}
      <section className="aniki-sig-panel">
        {cover}
        <div className="aniki-sig-content">
          {studio}
          <div className="aniki-details-buttons">{play}{icons}</div>
          <dl className="aniki-sig-facts">
            <div><dt>{t.fields.playtime}</dt><dd>{formatPlaytime(game.playtimeMinutes, t)}</dd></div>
            <div><dt>{t.fields.lastPlayed}</dt><dd>{formatLastPlayed(game.lastPlayedAt, t)}</dd></div>
            <div><dt>{t.fields.status}</dt><dd>{status}</dd></div>
            {genres.length > 0 && <div className="aniki-sig-wide"><dt>{t.fields.genre}</dt><dd>{genres.join(" / ")}</dd></div>}
          </dl>
          {achievementBar}
        </div>
      </section>
      {trailer("aniki-trailer-mini")}
    </>}
    {layout === "modern" && <>
      <aside className="aniki-modern-panel">
        {cover}
        {studio}
        {play}
        <div className="aniki-details-buttons aniki-details-buttons-centered">{icons}</div>
        <hr />
        {iconFacts}
      </aside>
      {trailer("aniki-trailer-mini")}
    </>}
    {layout === "classic" && <>
      {title}
      <div className="aniki-classic-content">
        {studio}
        {play}
        <div className="aniki-details-buttons">{icons}</div>
        {iconFacts}
      </div>
      {trailer("aniki-trailer-mini")}
    </>}
    {layout === "original" && <>
      {title}
      <div className="aniki-original-content">
        {lines([
          [game.developers.join(", ") || t.fields.release, year ?? null],
          [t.fields.playtime, formatPlaytime(game.playtimeMinutes, t)],
          [t.fields.lastPlayed, formatLastPlayed(game.lastPlayedAt, t)],
          [t.fields.status, status ?? null],
          [t.fields.rating, rating],
          [t.fields.difficulty, difficulty],
          [t.fields.achievements, achievements ? `${achievements.unlocked} / ${achievements.total}` : null],
        ])}
        <div className="aniki-details-buttons">{play}{icons}</div>
        {description}
      </div>
      {genres.length > 0 && <p className="aniki-original-genres">{genres.join(" • ")}</p>}
      {trailer("aniki-trailer-mini")}
    </>}
    {layout === "showcase" && <>
      <h1 className="aniki-showcase-title"><AnikiLogo game={game} /></h1>
      <div className="aniki-showcase-bar"><div className="aniki-details-buttons">{play}{icons}</div></div>
      <section className="aniki-showcase-bottom">
        {cover}
        <div className="aniki-showcase-facts">{studio}{iconFacts}</div>
        {description}
        <div className="aniki-showcase-trailer">{trailer("aniki-trailer-fill")}</div>
      </section>
    </>}
    {layout === "panel" && <>
      <nav className="aniki-panel-nav" aria-label={t.fullscreen.options}>
        {play}
        {achievements && <button type="button" onClick={onTrophies}>{t.fields.achievements}</button>}
        <button type="button" onClick={onReview}>{t.fullscreen.editReview}</button>
        <button type="button" data-fs-fallback onClick={onOptions}>{t.fullscreen.options}</button>
      </nav>
      <section className="aniki-panel-center">
        <div className="aniki-panel-media">
          {(game.backgroundUrl ?? game.coverUrl) && <img src={game.backgroundUrl ?? game.coverUrl!} alt="" />}
          {trailer("aniki-trailer-fill")}
        </div>
        <div className="aniki-panel-description"><h2>{t.details.description}</h2>{description}</div>
      </section>
      <aside className="aniki-panel-info">
        <h2>{t.fullscreen.gameInfo}</h2>
        {lines([
          [t.fields.playtime, formatPlaytime(game.playtimeMinutes, t)],
          [t.fields.lastPlayed, formatLastPlayed(game.lastPlayedAt, t)],
          [t.fields.release, game.releaseDate ? formatReleaseDate(game.releaseDate, t.locale) : null],
          [t.fields.achievements, achievements ? `${achievements.unlocked} / ${achievements.total}` : null],
          [t.fields.rating, rating],
          [t.fields.difficulty, difficulty],
        ])}
        {genres.length > 0 && <><h2>{t.fullscreen.gameProfile}</h2><ul className="aniki-panel-chips">{genres.map((genre) => <li key={genre}>{genre}</li>)}</ul></>}
        <h2>{t.fields.status}</h2>
        {lines([
          [t.fields.status, status ?? null],
          [t.fields.platform, game.platform],
          [t.fields.library, game.library],
        ])}
      </aside>
    </>}
  </div>
}

function IconFact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return <li title={label}><Icon aria-hidden="true" /><span className="sr-only">{label}: </span><span>{children}</span></li>
}
