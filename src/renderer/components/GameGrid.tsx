import type { Game } from "@shared/types"
import { GameCard } from "@/components/GameCard"

interface GameGridProps {
  games: Game[]
  selectedGameId: number | null
  onSelectGame: (game: Game) => void
}

/** Grid responsivo de capas: a quantidade de colunas se ajusta à largura disponível. */
export function GameGrid({ games, selectedGameId, onSelectGame }: GameGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-5 gap-y-7">
      {games.map((game) => (
        <GameCard key={game.id} game={game} selected={game.id === selectedGameId} onSelect={onSelectGame} />
      ))}
    </div>
  )
}
