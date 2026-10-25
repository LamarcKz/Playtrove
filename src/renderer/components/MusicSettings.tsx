import { useId, useState } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useI18n } from "@/hooks/useI18n"
import { useMusicConfig } from "@/hooks/useMusicConfig"
import { useToast } from "@/hooks/useToast"
import { errorMessage } from "@/lib/errors"

/** Configurações → Geral: reprodução, volume e busca das músicas tema. */
export function MusicSettings() {
  const { t } = useI18n()
  const { config, changeConfig } = useMusicConfig()
  const [searching, setSearching] = useState(false)
  const enabledId = useId()
  const automaticId = useId()
  const volumeId = useId()
  const toast = useToast()

  if (!config) return null

  async function download() {
    setSearching(true)
    try {
      const queued = await window.api.music.download()
      toast({ title: queued ? t.music.queued(queued) : t.music.nothingToDownload })
    } catch (error) {
      toast({ kind: "error", title: t.music.downloadError, description: errorMessage(error) })
    } finally {
      setSearching(false)
    }
  }

  return (
    <div role="group" aria-label={t.music.title} className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4">
      <p className="text-sm font-medium">{t.music.title}</p>
      <label htmlFor={enabledId} className="flex cursor-pointer items-start gap-3 text-sm">
        <Checkbox id={enabledId} checked={config.enabled} onCheckedChange={(value) => changeConfig({ enabled: value === true })} />
        {t.music.enabled}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={volumeId} className="text-sm">{t.music.volume}</label>
        <input
          id={volumeId}
          type="range"
          min={0}
          max={100}
          value={config.volume}
          onChange={(event) => changeConfig({ volume: Number(event.target.value) })}
          className="h-5 w-32 cursor-pointer accent-primary"
        />
        <span className="text-sm tabular-nums text-muted-foreground">{config.volume}%</span>
      </div>
      <label htmlFor={automaticId} className="flex cursor-pointer items-start gap-3 text-sm">
        <Checkbox id={automaticId} checked={config.autoDownload} onCheckedChange={(value) => changeConfig({ autoDownload: value === true })} />
        {t.music.autoDownload}
      </label>
      <p className="text-xs leading-relaxed text-muted-foreground">{t.music.toolsHint}</p>
      <Button variant="outline" disabled={searching} onClick={() => void download()} className="self-start">
        <Download />
        {t.music.download}
      </Button>
    </div>
  )
}
