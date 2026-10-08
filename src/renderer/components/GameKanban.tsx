import { useState, type DragEvent } from "react"
import type { Game, Status } from "@shared/types"
import { GameIcon } from "@/components/GameIcon"
import { useI18n } from "@/hooks/useI18n"
import { cn } from "@/lib/utils"

/** Tipo do dado arrastado: assim as colunas só aceitam jogos (e não arquivos ou textos). */
const DRAG_TYPE = "application/x-playtrove-game"

interface GameKanbanProps {
  games: Game[]
  /** As colunas do quadro, na ordem (todos os status, ou só os escolhidos no filtro de status). */
  statuses: Status[]
  selectedGameId: number | null
  onSelectGame: (game: Game) => void
  onStatusChange: (gameId: number, statusId: number) => void
}

/**
 * Modo Kanban: uma coluna para cada status (Planejo jogar, Jogando, Zerado...). As colunas dividem a
 * largura da tela, então todas aparecem de uma vez, sem rolar para os lados. Arrastar um jogo para
 * outra coluna muda o status dele.
 */
export function GameKanban({ games, statuses, selectedGameId, onSelectGame, onStatusChange }: GameKanbanProps) {
  const [draggingGameId, setDraggingGameId] = useState<number | null>(null)

  return (
    <div className="flex h-full min-w-0 flex-1 gap-1.5 p-2 lg:gap-2 lg:p-3">
      {statuses.map((status) => (
        <KanbanColumn
          key={status.id}
          status={status}
          games={games.filter((game) => game.statusId === status.id)}
          selectedGameId={selectedGameId}
          draggingGameId={draggingGameId}
          onSelectGame={onSelectGame}
          onDragGame={setDraggingGameId}
          onDropGame={(gameId) => {
            // O card muda de coluna e o antigo sai da tela sem avisar o fim do arraste (onDragEnd).
            setDraggingGameId(null)
            onStatusChange(gameId, status.id)
          }}
        />
      ))}
    </div>
  )
}

interface KanbanColumnProps {
  status: Status
  games: Game[]
  selectedGameId: number | null
  draggingGameId: number | null
  onSelectGame: (game: Game) => void
  onDragGame: (gameId: number | null) => void
  onDropGame: (gameId: number) => void
}

/**
 * Uma coluna do quadro: o nome do status, quantos jogos ele tem e os cards. O tamanho de tudo
 * acompanha a largura da coluna: estreita (janela pequena), fica mais compacta; larga (janela
 * maximizada), os cards ganham o ícone e letra maior.
 */
function KanbanColumn({
  status,
  games,
  selectedGameId,
  draggingGameId,
  onSelectGame,
  onDragGame,
  onDropGame,
}: KanbanColumnProps) {
  const { t } = useI18n()
  const [isDropTarget, setIsDropTarget] = useState(false)

  function handleDragOver(event: DragEvent) {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
    event.preventDefault() // sem isto o navegador não deixa soltar aqui
    event.dataTransfer.dropEffect = "move"
    setIsDropTarget(true)
  }

  function handleDragLeave(event: DragEvent) {
    // Passar por cima dos cards da própria coluna também dispara este evento; só vale sair dela.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDropTarget(false)
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    setIsDropTarget(false)
    const gameId = Number(event.dataTransfer.getData(DRAG_TYPE))
    if (gameId) onDropGame(gameId)
  }

  return (
    <section
      aria-label={status.name}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "@container flex min-w-0 flex-1 basis-0 flex-col rounded-lg bg-card/60 transition-colors",
        isDropTarget && "bg-accent/60 ring-2 ring-primary/50 ring-inset"
      )}
    >
      <header className="flex shrink-0 px-2 pt-3 pb-2 @[8rem]:px-2.5">
        {/* O número fica logo depois do nome e desce para a linha de baixo quando não cabe. */}
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 text-xs leading-4">
          <span className="min-w-0 font-semibold break-words">{status.name}</span>
          <span className="text-muted-foreground tabular-nums">{games.length}</span>
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1 pb-1 @[7rem]:px-1.5 @[7rem]:pb-1.5">
        {games.map((game) => (
          <KanbanCard
            key={game.id}
            game={game}
            selected={game.id === selectedGameId}
            dragging={game.id === draggingGameId}
            onSelect={onSelectGame}
            onDragGame={onDragGame}
          />
        ))}
        {games.length === 0 && (
          <p className="rounded-md border border-dashed px-2 py-3 text-center text-xs text-muted-foreground">
            {t.kanban.empty}
          </p>
        )}
      </div>
    </section>
  )
}

interface KanbanCardProps {
  game: Game
  selected: boolean
  dragging: boolean
  onSelect: (game: Game) => void
  onDragGame: (gameId: number | null) => void
}

/** Card de um jogo: clicar abre os detalhes; arrastar leva para outra coluna. */
function KanbanCard({ game, selected, dragging, onSelect, onDragGame }: KanbanCardProps) {
  return (
    <button
      type="button"
      draggable
      aria-pressed={selected}
      onClick={() => onSelect(game)}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, String(game.id))
        event.dataTransfer.effectAllowed = "move"
        onDragGame(game.id)
      }}
      onDragEnd={() => onDragGame(null)}
      className={cn(
        "flex shrink-0 cursor-grab items-center gap-2 rounded-md bg-secondary px-1.5 py-1.5 text-left text-[11px] leading-4 font-medium transition outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing @[7rem]:px-2 @[7rem]:text-xs @[11rem]:py-2 @[11rem]:text-sm @[11rem]:leading-5",
        selected && "ring-2 ring-primary",
        dragging && "opacity-40"
      )}
    >
      <GameIcon game={game} className="hidden @[11rem]:flex" />
      <span className="min-w-0 break-words">{game.title}</span>
    </button>
  )
}
