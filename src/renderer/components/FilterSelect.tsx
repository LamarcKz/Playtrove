import { useId } from "react"
import { Check, ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useI18n } from "@/hooks/useI18n"
import { cn } from "@/lib/utils"

export interface FilterSelectOption<T extends string | number> {
  value: T
  label: string
  /** Quantos jogos têm esta opção. */
  count: number
}

interface FilterSelectProps<T extends string | number> {
  /** Nome do filtro, em cima do campo (ex.: "Status"). */
  label: string
  options: FilterSelectOption<T>[]
  selected: T[]
  onChange: (selected: T[]) => void
  /** Filtro que ainda não funciona, porque os jogos não têm esse dado: aparece desativado. */
  disabled?: boolean
}

/**
 * Um filtro do painel, como os do Playnite: um campo que abre a lista de opções com caixinhas.
 * Dá para marcar várias; o campo mostra as marcadas, ou "Todos" quando nenhuma está marcada.
 */
export function FilterSelect<T extends string | number>({ label, options, selected, onChange, disabled }: FilterSelectProps<T>) {
  const { t } = useI18n()
  const labelId = useId()
  const valueId = useId()

  let summary = t.filters.all
  if (disabled) summary = t.filters.noData
  else if (selected.length > 0) {
    summary = options
      .filter((option) => selected.includes(option.value))
      .map((option) => option.label)
      .join(", ")
  }

  function toggle(value: T, checked: boolean) {
    onChange(checked ? [...selected, value] : selected.filter((item) => item !== value))
  }

  return (
    <div className="space-y-1.5">
      <span id={labelId} className="block px-0.5 text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            aria-labelledby={`${labelId} ${valueId}`}
            className="flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm transition-colors outline-none hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent data-[state=open]:border-ring dark:bg-input/30"
          >
            <span id={valueId} className={cn("min-w-0 flex-1 truncate", selected.length === 0 && "text-muted-foreground")}>
              {summary}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent>
          {options.map((option) => {
            const checked = selected.includes(option.value)
            return (
              <DropdownMenuCheckboxItem
                key={String(option.value)}
                checked={checked}
                onCheckedChange={(value) => toggle(option.value, value === true)}
                // Mantém a lista aberta, para dar para marcar várias opções de uma vez.
                onSelect={(event) => event.preventDefault()}
                // A caixinha fica à esquerda (como no Playnite), no lugar do visto padrão da direita.
                className="gap-2 pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden"
              >
                <CheckboxLook checked={checked} />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{option.count}</span>
              </DropdownMenuCheckboxItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** Desenho de uma caixinha (só visual: quem marca e desmarca é o item da lista). */
function CheckboxLook({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input dark:bg-input/30",
        checked && "border-primary bg-primary text-primary-foreground dark:bg-primary"
      )}
    >
      {checked && <Check className="size-3.5" />}
    </span>
  )
}
