import { useState } from "react"
import { genreLabel } from "@shared/i18n"
import type { Game } from "@shared/types"
import { useI18n } from "@/hooks/useI18n"
import { devMark } from "@/lib/devBuild"
import { formatLastPlayed, formatPlaytime, formatReleaseDate } from "@/lib/format"

/** A logo do jogo (o nome desenhado, do SteamGridDB) ou, sem ela ou se não carregar, o nome em letra grande. */
export function FullscreenGameLogo({ game, className }: { game: Game; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (game.logoUrl && failed !== game.logoUrl) return <h1 className={className}><img src={game.logoUrl} alt={game.title} onError={() => setFailed(game.logoUrl)} /></h1>
  return <h1 className={className}>{game.title}</h1>
}

/** A marca DEV do `npm run dev` e dos testes, para a tela cheia nunca parecer o app instalado. */
export function FullscreenDevBadge() {
  const { t } = useI18n()
  if (!devMark) return null
  return <span className="fs-dev-badge" title={devMark === "tests" ? t.topBar.devTestsHint : t.topBar.devHint}>{t.topBar.dev}</span>
}

/** A nota (de 1 a 10) como "4,5 / 5", ou um traço. */
function scoreText(value: number | null, locale: string) {
  return value !== null ? (value / 2).toLocaleString(locale) + " / 5" : "—"
}

/** Plataforma, gênero, desenvolvedora, publicadora, lançamento e status, só o que o jogo tiver. */
export function FullscreenGameFacts({ game, status, className }: { game: Game; status: string | undefined; className?: string }) {
  const { t } = useI18n()
  const rows: [string, string | null | undefined][] = [
    [t.fields.status, status],
    [t.fields.platform, game.platform],
    [t.fields.genre, game.genres.map((genre) => genreLabel(genre, t)).join(", ")],
    [t.fields.developer, game.developers.join(", ")],
    [t.fields.publisher, game.publishers.join(", ")],
    [t.fields.release, game.releaseDate && formatReleaseDate(game.releaseDate, t.locale)],
  ]
  return <dl className={className}>{rows.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

/** O tempo jogado e a última vez jogado. */
export function FullscreenPlaytime({ game }: { game: Game }) {
  const { t } = useI18n()
  return <dl><div><dt>{t.fields.playtime}</dt><dd>{formatPlaytime(game.playtimeMinutes, t)}</dd></div><div><dt>{t.fields.lastPlayed}</dt><dd>{formatLastPlayed(game.lastPlayedAt, t)}</dd></div></dl>
}

/** O progresso dos troféus do jogo (ou o aviso de que ainda não há). */
export function FullscreenTrophyText({ game }: { game: Game }) {
  const { t } = useI18n()
  if (game.achievements) return <p><strong>{game.achievements.unlocked} / {game.achievements.total}</strong>{game.achievements.platinum && " · " + t.achievements.grades.platina}</p>
  return <p>{game.trophiesPending ? t.achievements.trophiesPending : t.fullscreen.noAchievements}</p>
}

/** A nota, a dificuldade e o começo da análise. */
export function FullscreenRatingText({ game }: { game: Game }) {
  const { t } = useI18n()
  if (game.rating === null && game.difficulty === null && !game.review) return <p>{t.fullscreen.noReview}</p>
  return <>
    <dl><div><dt>{t.fields.rating}</dt><dd>{scoreText(game.rating, t.locale)}</dd></div><div><dt>{t.fields.difficulty}</dt><dd>{scoreText(game.difficulty, t.locale)}</dd></div></dl>
    {game.review && <p className="fs-review-snippet">{game.review}</p>}
  </>
}
