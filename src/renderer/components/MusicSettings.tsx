import { useId } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { useI18n } from "@/hooks/useI18n"
import { useMusicConfig } from "@/hooks/useMusicConfig"

/** Configurações → Geral: reprodução e volume das músicas tema. */
export function MusicSettings() {
  const { t } = useI18n()
  const { config, changeConfig } = useMusicConfig()
  const enabledId = useId()
  const volumeId = useId()

  if (!config) return null


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
    </div>
  )
}
