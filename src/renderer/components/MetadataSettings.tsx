import { useEffect, useId, useState } from "react"
import { CircleCheck, Download, LoaderCircle } from "lucide-react"
import type { Game, MetadataConfig } from "@shared/types"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ServiceCard } from "@/components/ServiceCard"
import { useI18n } from "@/hooks/useI18n"
import { useMetadataProgress } from "@/hooks/useMetadataProgress"
import { useToast } from "@/hooks/useToast"
import { errorMessage } from "@/lib/errors"

interface MetadataSettingsProps {
  /** Os jogos, para contar quantos ainda não têm metadados. */
  games: Game[]
}

/**
 * Configurações → Metadados: as chaves do IGDB e do SteamGridDB (com o passo a passo para criar
 * cada uma), baixar sozinho para os jogos novos e o botão para baixar os que faltam.
 */
export function MetadataSettings({ games }: MetadataSettingsProps) {
  const { t } = useI18n()
  const [config, setConfig] = useState<MetadataConfig | null>(null)
  const progress = useMetadataProgress()
  const toast = useToast()
  const autoDownloadId = useId()

  useEffect(() => {
    let active = true
    window.api.metadata.getConfig().then((current) => {
      if (active) setConfig(current)
    })
    return () => {
      active = false
    }
  }, [])

  if (!config) return null
  const missing = games.filter((game) => game.metadataUpdatedAt === null).length
  const running = progress?.running ?? false

  /** Baixa para os jogos sem metadados ou, com `all`, de novo para todos (ex.: para pegar capas novas). */
  async function download(all = false) {
    try {
      const queued = await window.api.metadata.download(all ? games.map((game) => game.id) : undefined)
      if (queued === 0) toast({ title: t.metadata.nothingToDownload, description: t.metadata.allHaveMetadata })
    } catch (error) {
      toast({ kind: "error", title: t.metadata.downloadError, description: errorMessage(error) })
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t.metadata.intro}</p>

      <section aria-label="libretro-thumbnails" className="flex items-start gap-3 rounded-xl border bg-card p-4">
        <CircleCheck aria-label={t.metadata.alwaysOn} className="mt-0.5 size-5 shrink-0 text-charging" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">libretro-thumbnails</p>
          <p className="text-xs text-muted-foreground">{t.metadata.libretroDescription}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.metadata.noKeyNeeded}</p>
        </div>
      </section>

      <ServiceCard
        name="IGDB"
        description={t.metadata.igdbDescription}
        configured={config.igdb}
        savedText={`Client ID: ${config.igdbClientId ?? ""}`}
        fields={[
          { id: "clientId", label: "Client ID", secret: false },
          { id: "clientSecret", label: "Client Secret", secret: true },
        ]}
        steps={t.metadata.igdbSteps}
        link={{ label: t.metadata.igdbLink, target: "twitchConsole" }}
        onSave={(values) => window.api.metadata.setIgdb({ clientId: values.clientId, clientSecret: values.clientSecret })}
        onRemove={() => window.api.metadata.setIgdb(null)}
        onChange={setConfig}
      />

      <ServiceCard
        name="SteamGridDB"
        description={t.metadata.sgdbDescription}
        configured={config.steamGridDb}
        savedText={t.metadata.keySaved}
        fields={[{ id: "key", label: t.metadata.apiKey, secret: true }]}
        steps={t.metadata.sgdbSteps}
        link={{ label: t.metadata.sgdbLink, target: "steamGridDbApi" }}
        onSave={(values) => window.api.metadata.setSteamGridDb(values.key)}
        onRemove={() => window.api.metadata.setSteamGridDb(null)}
        onChange={setConfig}
      />

      <div className="space-y-4 rounded-xl border bg-card p-4">
        <label htmlFor={autoDownloadId} className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox
            id={autoDownloadId}
            checked={config.autoDownload}
            onCheckedChange={(checked) => void window.api.metadata.setAutoDownload(checked === true).then(setConfig)}
            className="mt-0.5"
          />
          <span>
            <span className="block">{t.metadata.autoDownload}</span>
            <span className="block text-xs text-muted-foreground">{t.metadata.autoDownloadHint}</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            {missing === 0 ? t.metadata.allHaveMetadata : t.metadata.missing(t.common.games(missing))}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={games.length === 0 || running}
              onClick={() => void download(true)}
              title={t.metadata.redownloadHint}
            >
              {t.metadata.redownload}
            </Button>
            <Button disabled={missing === 0 || running} onClick={() => void download()}>
              {running ? <LoaderCircle className="animate-spin" /> : <Download />}
              {running && progress
                ? t.metadata.downloading(Math.min(progress.done + 1, progress.total), progress.total)
                : t.metadata.download}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
