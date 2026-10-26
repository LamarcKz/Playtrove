import { useI18n } from "@/hooks/useI18n"
import { useFullscreenConfig } from "@/hooks/useFullscreen"

export function FullscreenPreferences() {
  const { t } = useI18n()
  const { config, save, error, pending } = useFullscreenConfig()
  if (!config) return <p>{error ?? t.common.loading}</p>
  return (
    <div className="fs-preferences" aria-busy={pending}>
      <label><input type="checkbox" checked={config.startOnLaunch} onChange={(event) => void save({ startOnLaunch: event.target.checked })} />{t.fullscreen.startup}</label>
      <label><input type="checkbox" checked={config.musicPlayback} onChange={(event) => void save({ musicPlayback: event.target.checked })} />{t.fullscreen.music}</label>
      <div className="fs-volume"><span>{t.fullscreen.volume}</span><button type="button" aria-label={t.fullscreen.volume + " −"} onClick={() => void save({ musicVolume: Math.max(0, config.musicVolume - 5) })}>{"−"}</button><output>{config.musicVolume}%</output><button type="button" aria-label={t.fullscreen.volume + " +"} onClick={() => void save({ musicVolume: Math.min(100, config.musicVolume + 5) })}>{"+"}</button></div>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
