import { useState, type ReactNode } from "react"
import { Joystick, Library, SearchX } from "lucide-react"
import type { Game } from "@shared/types"
import { EmptyState } from "@/components/EmptyState"
import { FilterPanel } from "@/components/FilterPanel"
import { GameDetailsPanel } from "@/components/GameDetailsPanel"
import { GameDetailsView } from "@/components/GameDetailsView"
import { GameGrid } from "@/components/GameGrid"
import { GameKanban } from "@/components/GameKanban"
import { GameList } from "@/components/GameList"
import { GameTable } from "@/components/GameTable"
import type { LibraryView } from "@/components/LibraryTools"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/useI18n"
import { useStatuses } from "@/hooks/useStatuses"
import { EMPTY_FILTERS, filterGames, hasActiveFilters, type LibraryFilters } from "@/lib/filters"

interface LibraryPageProps {
  /** Todos os jogos da biblioteca (vindos do banco de dados). */
  games: Game[]
  /** Texto digitado na busca da barra do topo. */
  searchQuery: string
  /** Filtros ligados no painel de filtros. */
  filters: LibraryFilters
  onFiltersChange: (filters: LibraryFilters) => void
  /** O painel de filtros (na direita) está aberto? Quem abre é o botão de filtros da barra do topo. */
  filtersOpen: boolean
  onCloseFilters: () => void
  /** Modo escolhido na barra do topo: Detalhes (o principal), Grade, Lista ou Kanban. */
  view: LibraryView
  /** Um jogo mudou de status (arrastado para outra coluna no modo Kanban). */
  onGameStatusChange: (gameId: number, statusId: number) => void
  /** Vai para a aba Emuladores (botão da biblioteca vazia). */
  onOpenEmulators: () => void
}

/**
 * Tela "Biblioteca", com quatro modos de exibição:
 * - Detalhes (principal): lista de jogos à esquerda + detalhes grandes à direita (como no Playnite);
 * - Grade: capas;
 * - Lista: uma linha por jogo, com colunas;
 * - Kanban: uma coluna por status, como um quadro do Notion.
 * Na Grade, na Lista e no Kanban, clicar num jogo abre o painel de detalhes à direita. No Kanban ele
 * abre por cima do quadro, para as colunas não ficarem espremidas. Trocar de modo fecha esse painel
 * (o jogo escolhido continua destacado). O painel de filtros, quando aberto, fica na ponta direita,
 * em todos os modos.
 */
export function LibraryPage({
  games: allGames,
  searchQuery,
  filters,
  onFiltersChange,
  filtersOpen,
  onCloseFilters,
  view,
  onGameStatusChange,
  onOpenEmulators,
}: LibraryPageProps) {
  const { t } = useI18n()
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [lastView, setLastView] = useState(view)
  const statuses = useStatuses()

  // Trocar de modo mostra só a biblioteca: o painel de detalhes fecha, e o jogo continua destacado.
  if (view !== lastView) {
    setLastView(view)
    setDetailsOpen(false)
  }

  const games = filterGames(allGames, searchQuery, filters)
  const selectedGame = games.find((game) => game.id === selectedGameId)
  const selectGame = (game: Game) => {
    setSelectedGameId(game.id)
    setDetailsOpen(true)
  }
  // Com o filtro de status ligado, o Kanban mostra só as colunas dos status escolhidos.
  const kanbanStatuses =
    filters.statuses.length > 0 ? statuses.filter((status) => filters.statuses.includes(status.id)) : statuses

  let content: ReactNode
  if (allGames.length === 0) {
    content = (
      <EmptyState
        icon={Library}
        title={t.library.emptyTitle}
        description={t.library.emptyDescription}
        action={
          <Button variant="secondary" onClick={onOpenEmulators}>
            <Joystick />
            {t.library.goToEmulators}
          </Button>
        }
      />
    )
  } else if (games.length === 0) {
    content = (
      <EmptyState
        icon={SearchX}
        title={t.library.noResultsTitle}
        description={t.library.noResultsDescription}
        action={
          hasActiveFilters(filters) && (
            <Button variant="secondary" onClick={() => onFiltersChange(EMPTY_FILTERS)}>
              {t.library.clearFilters}
            </Button>
          )
        }
      />
    )
  } else if (view === "details") {
    // No modo Detalhes sempre há um jogo aberto: se nenhum foi escolhido, mostra o primeiro.
    const shownGame = selectedGame ?? games[0]
    content = (
      <>
        <GameList games={games} selectedGameId={shownGame.id} onSelectGame={selectGame} />
        <GameDetailsView game={shownGame} />
      </>
    )
  } else {
    content = (
      <>
        {view === "grid" && (
          <div className="min-w-0 flex-1 overflow-y-auto p-6">
            <GameGrid games={games} selectedGameId={selectedGameId} onSelectGame={selectGame} />
          </div>
        )}
        {view === "list" && <GameTable games={games} selectedGameId={selectedGameId} onSelectGame={selectGame} />}
        {view === "kanban" && (
          <GameKanban
            games={games}
            statuses={kanbanStatuses}
            selectedGameId={selectedGameId}
            onSelectGame={selectGame}
            onStatusChange={onGameStatusChange}
          />
        )}
        {detailsOpen && selectedGame && (
          <GameDetailsPanel
            game={selectedGame}
            onClose={() => setDetailsOpen(false)}
            className={view === "kanban" ? "absolute inset-y-0 right-0 z-10 shadow-2xl shadow-black/40" : undefined}
          />
        )}
      </>
    )
  }

  return (
    <div className="flex h-full">
      <div className="relative flex min-w-0 flex-1">{content}</div>
      {filtersOpen && (
        <FilterPanel games={allGames} filters={filters} onFiltersChange={onFiltersChange} onClose={onCloseFilters} />
      )}
    </div>
  )
}
