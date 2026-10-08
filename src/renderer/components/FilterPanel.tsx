import { useId } from "react"
import { History, Star, X, type LucideIcon } from "lucide-react"
import { genreLabel, type Messages } from "@shared/i18n"
import type { Game } from "@shared/types"
import { FilterSelect } from "@/components/FilterSelect"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useI18n } from "@/hooks/useI18n"
import { useStatuses } from "@/hooks/useStatuses"
import {
  countValues,
  EMPTY_FILTERS,
  hasActiveFilters,
  isRecent,
  matchesPlaytime,
  matchesScore,
  PLAYTIME_RANGES,
  RECENT_DAYS,
  releaseYear,
  SCORE_RANGES,
  type LibraryFilters,
} from "@/lib/filters"
import type { ScoreKind } from "@/lib/score"

/**
 * Os filtros de texto que vêm dos dados dos jogos (os valores e as quantidades são contados na hora).
 * Os de metadados ficam desativados até algum jogo ter o dado. Os gêneros aparecem no idioma do app.
 */
const VALUE_FILTERS: {
  field: keyof Messages["fields"]
  key: "libraries" | "platforms" | "genres" | "developers" | "publishers" | "years"
  pick: (game: Game) => string | string[] | null
  label?: (value: string, t: Messages) => string
}[] = [
  { field: "library", key: "libraries", pick: (game) => game.library },
  { field: "platform", key: "platforms", pick: (game) => game.platform },
  { field: "genre", key: "genres", pick: (game) => game.genres, label: genreLabel },
  { field: "developer", key: "developers", pick: (game) => game.developers },
  { field: "publisher", key: "publishers", pick: (game) => game.publishers },
  { field: "releaseYear", key: "years", pick: releaseYear },
]

/** Os filtros da avaliação do usuário (ficam desativados até algum jogo ser avaliado). */
const SCORE_FILTERS: {
  key: "ratings" | "difficulties"
  kind: ScoreKind
  pick: (game: Game) => number | null
}[] = [
  { key: "ratings", kind: "rating", pick: (game) => game.rating },
  { key: "difficulties", kind: "difficulty", pick: (game) => game.difficulty },
]

interface FilterPanelProps {
  /** Todos os jogos, para montar as opções e mostrar quantos há em cada uma. */
  games: Game[]
  filters: LibraryFilters
  onFiltersChange: (filters: LibraryFilters) => void
  onClose: () => void
}

/**
 * Painel de filtros, na direita da Biblioteca, como o do Playnite: Favoritos e Recentes em
 * caixinhas no topo e, embaixo, um seletor para cada filtro (Status, Tempo jogado...). Cada opção
 * mostra quantos jogos ela tem.
 */
export function FilterPanel({ games, filters, onFiltersChange, onClose }: FilterPanelProps) {
  const { t } = useI18n()
  const statuses = useStatuses()
  const update = (changes: Partial<LibraryFilters>) => onFiltersChange({ ...filters, ...changes })

  return (
    <aside
      aria-label={t.filters.title}
      className="flex w-64 shrink-0 animate-in flex-col border-l bg-card duration-200 fade-in-0 slide-in-from-right-8"
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b pr-2 pl-4">
        <span className="flex-1 text-sm font-medium text-muted-foreground">{t.filters.title}</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!hasActiveFilters(filters)}
          onClick={() => onFiltersChange(EMPTY_FILTERS)}
        >
          {t.common.clear}
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t.filters.close} onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <div className="-mx-1 space-y-0.5">
          <FilterCheckbox
            icon={Star}
            label={t.filters.favorites}
            count={games.filter((game) => game.favorite).length}
            checked={filters.favorites}
            onCheckedChange={(checked) => update({ favorites: checked })}
          />
          <FilterCheckbox
            icon={History}
            label={t.filters.recent}
            hint={t.filters.recentHint(RECENT_DAYS)}
            count={games.filter(isRecent).length}
            checked={filters.recent}
            onCheckedChange={(checked) => update({ recent: checked })}
          />
        </div>

        <FilterSelect
          label={t.fields.status}
          options={statuses.map((status) => ({
            value: status.id,
            label: status.name,
            count: games.filter((game) => game.statusId === status.id).length,
          }))}
          selected={filters.statuses}
          onChange={(selected) => update({ statuses: selected })}
        />
        <FilterSelect
          label={t.fields.playtime}
          options={PLAYTIME_RANGES.map((range) => ({
            value: range.id,
            label: t.filters.playtimeRanges[range.id],
            count: games.filter((game) => matchesPlaytime(game, range.id)).length,
          }))}
          selected={filters.playtime}
          onChange={(playtime) => update({ playtime })}
        />
        {SCORE_FILTERS.map(({ key, kind, pick }) => (
          <FilterSelect
            key={key}
            label={t.fields[kind]}
            options={SCORE_RANGES.map((range) => ({
              value: range.id,
              label: t.filters.scoreRange(kind, range.id),
              count: games.filter((game) => matchesScore(pick(game), range.id)).length,
            }))}
            selected={filters[key]}
            onChange={(selected) => update({ [key]: selected })}
            disabled={!games.some((game) => pick(game) !== null)}
          />
        ))}
        {VALUE_FILTERS.map(({ field, key, pick, label }) => {
          const values = countValues(games, pick, label && ((value) => label(value, t)))
          return (
            <FilterSelect
              key={key}
              label={t.fields[field]}
              options={values}
              selected={filters[key]}
              onChange={(selected) => update({ [key]: selected })}
              disabled={values.length === 0}
            />
          )
        })}
      </div>
    </aside>
  )
}

interface FilterCheckboxProps {
  label: string
  count: number
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  icon: LucideIcon
  /** Explicação curta embaixo do nome. */
  hint?: string
}

/** Filtro de ligar e desligar (Favoritos, Recentes): caixinha, nome e quantos jogos ele tem. */
function FilterCheckbox({ label, count, checked, onCheckedChange, icon: Icon, hint }: FilterCheckboxProps) {
  const id = useId()

  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
    </label>
  )
}
