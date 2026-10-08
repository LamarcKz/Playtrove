import { LayoutGrid, LayoutList, Rows3, SquareKanban, type LucideIcon } from "lucide-react"
import { FilterButton } from "@/components/FilterButton"
import { SearchBar } from "@/components/SearchBar"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/hooks/useI18n"

/** Modos de exibição da Biblioteca. O principal é o "details" (Detalhes). */
export type LibraryView = "details" | "grid" | "list" | "kanban"

const VIEWS: { value: LibraryView; icon: LucideIcon }[] = [
  { value: "details", icon: LayoutList },
  { value: "grid", icon: LayoutGrid },
  { value: "list", icon: Rows3 },
  { value: "kanban", icon: SquareKanban },
]

interface LibraryToolsProps {
  searchQuery: string
  onSearchChange: (value: string) => void
  /** O painel de filtros está aberto? */
  filtersOpen: boolean
  /** Há algum filtro ligado? */
  filtersActive: boolean
  onToggleFilters: () => void
  view: LibraryView
  onViewChange: (view: LibraryView) => void
}

/** Ferramentas da Biblioteca na barra do topo: busca, botão dos filtros e modo de exibição. */
export function LibraryTools({
  searchQuery,
  onSearchChange,
  filtersOpen,
  filtersActive,
  onToggleFilters,
  view,
  onViewChange,
}: LibraryToolsProps) {
  const { t } = useI18n()
  return (
    <div className="app-no-drag flex items-center gap-1.5">
      <SearchBar value={searchQuery} onChange={onSearchChange} />
      <FilterButton open={filtersOpen} active={filtersActive} onToggle={onToggleFilters} />

      <Separator orientation="vertical" className="mx-1.5 h-5 data-vertical:self-center" />

      <ToggleGroup
        type="single"
        value={view}
        onValueChange={(value) => {
          // Clicar no modo que já está ativo manda "" (nenhum); nesse caso o modo atual continua.
          if (value) onViewChange(value as LibraryView)
        }}
        aria-label={t.library.viewMode}
      >
        {VIEWS.map(({ value, icon: Icon }) => (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              {/* O destaque usa aria-checked porque o tooltip sobrescreve o data-state do botão. */}
              <ToggleGroupItem
                value={value}
                aria-label={t.library.views[value]}
                className="aria-checked:bg-muted aria-checked:text-foreground"
              >
                <Icon />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>{t.library.views[value]}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
    </div>
  )
}
