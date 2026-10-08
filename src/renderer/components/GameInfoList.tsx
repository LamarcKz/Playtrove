import { Fragment, type ReactNode } from "react"
import { genreLabel } from "@shared/i18n"
import type { Game } from "@shared/types"
import { useI18n } from "@/hooks/useI18n"
import { useStatusName } from "@/hooks/useStatuses"
import { formatLastPlayed, formatPlaytime, formatReleaseDate } from "@/lib/format"

interface GameInfoListProps {
  game: Game
}

/** Lista "nome: valor" com as informações do jogo (painel lateral e modo Detalhes). Sem valor, mostra "—". */
export function GameInfoList({ game }: GameInfoListProps) {
  const { t } = useI18n()
  const statusName = useStatusName()

  // Gênero, desenvolvedora, publicadora e lançamento vêm dos metadados (IGDB).
  const fields: [string, ReactNode][] = [
    [t.fields.status, statusName(game.statusId)],
    [t.fields.playtime, formatPlaytime(game.playtimeMinutes, t)],
    [t.fields.lastPlayed, formatLastPlayed(game.lastPlayedAt, t)],
    [t.fields.library, game.library],
    [t.fields.platform, game.platform],
    [t.fields.genre, game.genres.map((genre) => genreLabel(genre, t)).join(", ")],
    [t.fields.developer, game.developers.join(", ")],
    [t.fields.publisher, game.publishers.join(", ")],
    [t.fields.release, game.releaseDate && formatReleaseDate(game.releaseDate, t.locale)],
  ]

  return (
    <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-2.5 text-sm">
      {fields.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className={value ? undefined : "text-muted-foreground"}>{value || "—"}</dd>
        </Fragment>
      ))}
    </dl>
  )
}
