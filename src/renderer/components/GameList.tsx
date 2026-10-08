import type { Game } from "@shared/types"
import { AchievementCount } from "@/components/AchievementParts"
import { GameIcon } from "@/components/GameIcon"
import { cn } from "@/lib/utils"

interface GameListProps {
  games: Game[]
  selectedGameId: number
  onSelectGame: (game: Game) => void
}

/**
 * Lista de jogos do modo Detalhes (coluna da esquerda): ícone e nome de cada jogo e, nos que têm
 * conquistas, o troféu com o progresso.
 */
export function GameList({ games, selectedGameId, onSelectGame }: GameListProps) {
  return (
    <div className="flex w-72 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2">
      {games.map((game) => {
        const selected = game.id === selectedGameId
        return (
          <button
            key={game.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelectGame(game)}
            className={cn(
              "relative flex h-9 shrink-0 items-center gap-3 rounded-md px-2.5 text-left text-sm transition-colors outline-none hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50",
              // Jogo aberto: fundo destacado e uma barrinha na cor principal à esquerda.
              selected &&
                "bg-accent font-medium before:absolute before:top-1/2 before:left-0 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary hover:bg-accent"
            )}
          >
            <GameIcon game={game} />
            <span className="min-w-0 truncate">{game.title}</span>
            {game.achievements && <AchievementCount progress={game.achievements} className="ml-auto" />}
          </button>
        )
      })}
    </div>
  )
}
