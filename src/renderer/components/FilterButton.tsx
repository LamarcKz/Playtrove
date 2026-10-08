import { Funnel } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/hooks/useI18n"

interface FilterButtonProps {
  /** O painel de filtros está aberto? */
  open: boolean
  /** Há algum filtro ligado? */
  active: boolean
  onToggle: () => void
}

/** Botão de filtros (ao lado da busca): abre e fecha o painel de filtros, na direita. */
export function FilterButton({ open, active, onToggle }: FilterButtonProps) {
  const { t } = useI18n()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t.library.filters}
          aria-pressed={open}
          onClick={onToggle}
          className="relative aria-pressed:bg-muted aria-pressed:text-foreground"
        >
          <Funnel />
          {/* Pontinho azul: avisa que há algum filtro ligado, mesmo com o painel fechado. */}
          {active && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{open ? t.library.closeFilters : t.library.filters}</TooltipContent>
    </Tooltip>
  )
}
