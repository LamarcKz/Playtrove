import { LoaderCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/hooks/useI18n"
import { useMetadataProgress } from "@/hooks/useMetadataProgress"
import { useToast } from "@/hooks/useToast"
import { describeMetadataResult } from "@/lib/metadata"

/**
 * Na barra do topo, enquanto os metadados estão sendo baixados: "Metadados 3/7" girando (o jogo
 * da vez aparece ao passar o mouse). Quando a leva acaba, mostra um aviso com o resumo.
 */
export function MetadataStatus() {
  const { t } = useI18n()
  const toast = useToast()
  const progress = useMetadataProgress((finished) => {
    for (const message of describeMetadataResult(finished, t)) toast(message)
  })

  if (!progress?.running) return null
  const position = Math.min(progress.done + 1, progress.total)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="status"
          aria-label={t.metadata.progressLabel(position, progress.total)}
          className="app-no-drag mr-2 flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground"
        >
          <LoaderCircle className="size-3.5 animate-spin" />
          <span className="tabular-nums">
            {t.metadata.badge} {position}/{progress.total}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{progress.current ? t.metadata.downloadingGame(progress.current) : t.metadata.downloadingAll}</TooltipContent>
    </Tooltip>
  )
}
