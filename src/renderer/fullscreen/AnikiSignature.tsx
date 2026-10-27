import { Info, Play, SlidersHorizontal, Trophy } from "lucide-react"
import type { Game } from "@shared/types"
import { GameCover } from "@/components/GameCover"
import { PepperIcon } from "@/components/icons/PepperIcon"
import { ProgressBar } from "@/components/AchievementParts"
import { useI18n } from "@/hooks/useI18n"
import { formatLastPlayed, formatPlaytime } from "@/lib/format"
import { progressPercent } from "@/lib/achievements"
import { genreLabel } from "@shared/i18n"
import { AnikiIcon } from "./AnikiGlyph"
import { AnikiTrailerCard } from "./AnikiTrailerCard"

interface Props {
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
}

/** Detalhes no layout Signature do Aniki: nome sobre a arte, painel de vidro com capa e dados, e o trailer em miniatura. */
export function AnikiSignature({ game, status, canPlay, playLabel, playDisabled, playVideo, onPlay, onTrophies, onDescription, onOptions }: Props) {
  const { t } = useI18n()
  const year = game.releaseDate?.slice(0, 4)
  const achievements = game.achievements
  const percent = achievements ? progressPercent(achievements.unlocked, achievements.total) : 0
  return <div className="aniki-signature" data-testid="fullscreen-details">
    <h1 className="aniki-sig-title">{game.title}{game.favorite && <AnikiIcon icon="heartFilled" />}</h1>
    <section className="aniki-sig-panel">
      <div className="aniki-sig-cover">
        <GameCover title={game.title} src={game.coverUrl} />
        {(game.rating !== null || game.difficulty !== null) && <div className="aniki-sig-scores">
          {game.rating !== null && <span title={t.fields.rating}><AnikiIcon icon="star" />{(game.rating / 2).toLocaleString(t.locale)}</span>}
          {game.difficulty !== null && <span title={t.fields.difficulty}><PepperIcon />{(game.difficulty / 2).toLocaleString(t.locale)}</span>}
        </div>}
      </div>
      <div className="aniki-sig-content">
        {(game.developers.length > 0 || year) && <p className="aniki-sig-studio">{game.developers.join(", ")} <strong>{year}</strong></p>}
        <div className="aniki-sig-buttons">
          <button type="button" data-fs-default className="aniki-sig-play" disabled={!canPlay || playDisabled} onClick={onPlay}><Play />{playLabel}</button>
          {achievements && <button type="button" aria-label={t.fields.achievements} title={t.fields.achievements} onClick={onTrophies}><Trophy /></button>}
          <button type="button" aria-label={t.details.description} title={t.details.description} onClick={onDescription}><Info /></button>
          <button type="button" data-fs-fallback aria-label={t.fullscreen.options} title={t.fullscreen.options} onClick={onOptions}><SlidersHorizontal /></button>
        </div>
        <dl className="aniki-sig-facts">
          <div><dt>{t.fields.playtime}</dt><dd>{formatPlaytime(game.playtimeMinutes, t)}</dd></div>
          <div><dt>{t.fields.lastPlayed}</dt><dd>{formatLastPlayed(game.lastPlayedAt, t)}</dd></div>
          <div><dt>{t.fields.status}</dt><dd>{status}</dd></div>
          {game.genres.length > 0 && <div className="aniki-sig-wide"><dt>{t.fields.genre}</dt><dd>{game.genres.map((genre) => genreLabel(genre, t)).join(" / ")}</dd></div>}
        </dl>
        {achievements
          ? <button type="button" className="aniki-sig-achievements" onClick={onTrophies}>
            <Trophy />
            <span><strong>{achievements.unlocked}</strong> / {achievements.total} <small>{t.fields.achievements}</small></span>
            <ProgressBar value={percent} label={t.fields.achievements} className="aniki-sig-progress" />
            <span className="aniki-sig-percent">{percent}%</span>
          </button>
          : <p className="aniki-sig-no-achievements">{game.trophiesPending ? t.achievements.trophiesPending : t.fullscreen.noAchievements}</p>}
      </div>
    </section>
    {game.backgroundVideoUrl && <AnikiTrailerCard key={game.backgroundVideoUrl} url={game.backgroundVideoUrl} play={playVideo} />}
  </div>
}
