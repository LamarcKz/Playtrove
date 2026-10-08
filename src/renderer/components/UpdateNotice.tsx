import { useState } from "react"
import { CircleArrowDown } from "lucide-react"
import { ProgressBar } from "@/components/AchievementParts"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/useI18n"
import { useUpdates } from "@/hooks/useUpdates"

/**
 * O aviso de versão nova, no canto dos avisos rápidos (fica até a pessoa responder): "Atualizar" baixa,
 * instala e abre o app de novo; na versão portátil, "Baixar" abre a página de download. Depois do
 * clique, mostra o andamento do download.
 */
export function UpdateNotice() {
  const { t } = useI18n()
  const status = useUpdates()
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)

  if (!status?.version) return null
  const { state, version, percent, portable } = status
  if (state === "available" && dismissedVersion === version) return null
  if (state !== "available" && state !== "downloading" && state !== "ready") return null

  return (
    <div
      role="status"
      className="pointer-events-auto flex animate-in gap-3 rounded-xl border bg-popover p-3.5 text-popover-foreground shadow-xl shadow-black/30 duration-200 fade-in-0 slide-in-from-bottom-4"
    >
      <CircleArrowDown className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        {state === "available" ? (
          <>
            <p className="text-sm font-medium">{t.updates.available(version)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{portable ? t.updates.portableHint : t.updates.installHint}</p>
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" onClick={() => void window.api.updates.install()}>
                {portable ? t.updates.download : t.updates.install}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDismissedVersion(version)}>
                {t.updates.later}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">{state === "ready" ? t.updates.ready : t.updates.downloading(percent)}</p>
            <ProgressBar value={percent} label={t.updates.downloading(percent)} className="mt-2" />
          </>
        )}
      </div>
    </div>
  )
}
