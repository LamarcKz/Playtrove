import type { Game } from "@shared/types"
import { AchievementCount } from "@/components/AchievementParts"
import { GameCover } from "@/components/GameCover"
import { useI18n } from "@/hooks/useI18n"
import { useStatusName } from "@/hooks/useStatuses"
import { formatPlaytime } from "@/lib/format"
import { cn } from "@/lib/utils"

interface GameCardProps {
  game: Game
  selected: boolean
  onSelect: (game: Game) => void
}

/**
 * Card de um jogo no grid: capa com o status numa faixa embaixo, título, tempo jogado e, nos jogos
 * com conquistas, o troféu com o progresso.
 * A capa dá um leve zoom no hover. Os cantos de baixo são retos, para a faixa do status não ficar
 * cortada (pedido do usuário em 2026-09-19).
 */
export function GameCard({ game, selected, onSelect }: GameCardProps) {
  const { t } = useI18n()
  const statusName = useStatusName()

  return (
    <button
      type="button"
      onClick={() => onSelect(game)}
      aria-pressed={selected}
      className="group flex min-w-0 flex-col gap-2.5 text-left outline-none"
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-t-lg shadow-md shadow-black/20 transition duration-200 ease-out group-hover:scale-[1.04] group-hover:shadow-xl group-focus-visible:ring-3 group-focus-visible:ring-ring/60",
          selected && "ring-2 ring-primary"
        )}
      >
        <GameCover title={game.title} src={game.coverUrl} className="w-full rounded-none" />
        {/* Faixa do status: encostada nas bordas de baixo, que são retas. */}
        <span className="absolute inset-x-0 bottom-0 truncate bg-cover-label px-2.5 py-1.5 text-xs font-medium text-cover-label-foreground backdrop-blur-sm">
          {statusName(game.statusId)}
        </span>
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-sm font-medium" title={game.title}>
          {game.title}
        </p>
        <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{formatPlaytime(game.playtimeMinutes, t)}</span>
          {game.achievements && <AchievementCount progress={game.achievements} />}
        </p>
      </div>
    </button>
  )
}
