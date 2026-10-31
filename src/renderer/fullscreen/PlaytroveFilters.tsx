import { History, Star } from "lucide-react"
import type { Game } from "@shared/types"
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
  SCORE_FILTERS,
  SCORE_RANGES,
  VALUE_FILTERS,
  type LibraryFilters,
} from "@/lib/filters"
import { FULLSCREEN_SORTS, type FullscreenSort } from "@/lib/fullscreenNavigation"

interface Props {
  /** Todos os jogos, para montar as opções e contar quantos há em cada uma (como no modo janela). */
  games: Game[]
  filters: LibraryFilters
  sort: FullscreenSort
  onFilters: (filters: LibraryFilters) => void
  onSort: (sort: FullscreenSort) => void
}

type ListKey = Exclude<keyof LibraryFilters, "favorites" | "recent">
interface Section { key: ListKey; label: string; options: { value: string | number; label: string; count: number }[]; disabled: boolean }

/**
 * Filtros e ordem do tema Playtrove, como o FiltersView do Playnite: os mesmos filtros do painel da
 * Biblioteca do modo janela, cada opção um botão de ligar e desligar (feito para o controle).
 */
export function PlaytroveFilters({ games, filters, sort, onFilters, onSort }: Props) {
  const { t } = useI18n()
  const statuses = useStatuses()
  const update = (changes: Partial<LibraryFilters>) => onFilters({ ...filters, ...changes })
  const toggle = (key: ListKey, value: string | number) => {
    const current = filters[key] as (string | number)[]
    update({ [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] } as Partial<LibraryFilters>)
  }
  const sections: Section[] = [
    { key: "statuses", label: t.fields.status, disabled: false, options: statuses.map((status) => ({ value: status.id, label: status.name, count: games.filter((game) => game.statusId === status.id).length })) },
    { key: "playtime", label: t.fields.playtime, disabled: false, options: PLAYTIME_RANGES.map((range) => ({ value: range.id, label: t.filters.playtimeRanges[range.id], count: games.filter((game) => matchesPlaytime(game, range.id)).length })) },
    ...SCORE_FILTERS.map(({ key, kind, pick }): Section => ({
      key,
      label: t.fields[kind],
      disabled: !games.some((game) => pick(game) !== null),
      options: SCORE_RANGES.map((range) => ({ value: range.id, label: t.filters.scoreRange(kind, range.id), count: games.filter((game) => matchesScore(pick(game), range.id)).length })),
    })),
    ...VALUE_FILTERS.map(({ field, key, pick, label }): Section => {
      const options = countValues(games, pick, label && ((value) => label(value, t)))
      return { key, label: t.fields[field], disabled: options.length === 0, options }
    }),
  ]
  return <div className="fs-filters" data-testid="playtrove-filters">
    <div className="fs-filters-head">
      <h2>{t.filters.title}</h2>
      <button type="button" disabled={!hasActiveFilters(filters)} onClick={() => onFilters(EMPTY_FILTERS)}>{t.common.clear}</button>
    </div>
    <section aria-label={t.fullscreen.sortBy}>
      <h3>{t.fullscreen.sortBy}</h3>
      <div className="fs-chips">{FULLSCREEN_SORTS.map((value) => <button type="button" key={value} aria-pressed={sort === value} data-fs-default={sort === value ? "" : undefined} onClick={() => onSort(value)}>{t.fullscreen.sortNames[value]}</button>)}</div>
    </section>
    <section aria-label={t.filters.title}>
      <div className="fs-chips">
        <button type="button" aria-pressed={filters.favorites} onClick={() => update({ favorites: !filters.favorites })}><Star />{t.filters.favorites}{" "}<small>{games.filter((game) => game.favorite).length}</small></button>
        <button type="button" aria-pressed={filters.recent} onClick={() => update({ recent: !filters.recent })}><History />{t.filters.recent}{" "}<small>{games.filter(isRecent).length}</small></button>
      </div>
    </section>
    {sections.map((section) => <section key={section.key} aria-label={section.label}>
      <h3>{section.label}</h3>
      {section.disabled ? <p className="fs-filters-empty">{t.filters.noData}</p> : <div className="fs-chips">
        {section.options.map((option) => <button type="button" key={option.value} aria-pressed={(filters[section.key] as (string | number)[]).includes(option.value)} onClick={() => toggle(section.key, option.value)}>{option.label}{" "}<small>{option.count}</small></button>)}
      </div>}
    </section>)}
  </div>
}
