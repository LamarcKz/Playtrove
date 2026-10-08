import { useId } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useI18n } from "@/hooks/useI18n"
import { useUpdates } from "@/hooks/useUpdates"

/**
 * Configurações → Sobre: a atualização do app. Procurar agora (ou instalar a versão encontrada), a
 * situação e a opção de procurar sempre que o app abre. Rodando pelo código-fonte, só avisa que a
 * atualização automática é do app instalado.
 */
export function UpdateSettings() {
  const { t } = useI18n()
  const status = useUpdates()
  const autoCheckId = useId()

  if (!status) return null
  if (status.state === "unsupported") return <p className="border-t pt-4 text-sm text-muted-foreground">{t.updates.unsupported}</p>

  const messages = {
    idle: "",
    checking: t.updates.checking,
    latest: t.updates.latest,
    available: t.updates.available(status.version ?? ""),
    downloading: t.updates.downloading(status.percent),
    ready: t.updates.ready,
    error: t.updates.error,
  }
  const busy = status.state === "checking" || status.state === "downloading" || status.state === "ready"

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-muted-foreground">
          {messages[status.state]}
        </p>
        {status.state === "available" ? (
          <Button onClick={() => void window.api.updates.install()}>
            {status.portable ? t.updates.download : t.updates.install}
          </Button>
        ) : (
          <Button variant="outline" disabled={busy} onClick={() => void window.api.updates.check()}>
            {t.updates.checkNow}
          </Button>
        )}
      </div>
      <label htmlFor={autoCheckId} className="flex cursor-pointer items-center gap-3 text-sm">
        <Checkbox
          id={autoCheckId}
          checked={status.autoCheck}
          onCheckedChange={(checked) => void window.api.updates.setAutoCheck(checked === true)}
        />
        {t.updates.autoCheck}
      </label>
    </div>
  )
}
