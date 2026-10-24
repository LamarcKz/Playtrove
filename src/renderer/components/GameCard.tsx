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
 * A capa inteira fica centralizada numa área 2:3, com leve zoom no hover. A faixa fica embaixo
 * dessa área, sem cobrir a arte; os cantos de baixo são retos para a faixa não ficar cortada.
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
          "w-full overflow-hidden rounded-t-lg shadow-md shadow-black/20 transition duration-200 ease-out group-hover:scale-[1.04] group-hover:shadow-xl group-focus-visible:ring-3 group-focus-visible:ring-ring/60",
          selected && "ring-2 ring-primary"
        )}
      >
        <GameCover title={game.title} src={game.coverUrl} layout="grid" className="mx-auto w-full rounded-none" />
        {/* Faixa do status: logo embaixo da capa, sem cobrir a imagem. */}
        <span className="block bg-cover-label px-2.5 py-1.5 text-xs font-medium text-cover-label-foreground [overflow-wrap:anywhere]">
          {statusName(game.statusId)}
        </span>
      </div>
      <div className="min-w-0 px-0.5">
        <p className="text-sm font-medium [overflow-wrap:anywhere]" title={game.title}>
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
