import { FULLSCREEN_TRAILERS } from "@shared/fullscreen"
import { useI18n } from "@/hooks/useI18n"
import { useFullscreenConfig } from "@/hooks/useFullscreen"

/** Preferências da tela cheia: em Configurações → Geral do modo janela e no painel da própria tela cheia. */
export function FullscreenPreferences() {
  const { t } = useI18n()
  const { config, save, error, pending } = useFullscreenConfig()
  if (!config) return <p>{error ?? t.common.loading}</p>
  return (
    <div className="fs-preferences" aria-busy={pending}>
      <label><input type="checkbox" checked={config.startOnLaunch} onChange={(event) => void save({ startOnLaunch: event.target.checked })} />{t.fullscreen.startup}</label>
      <label><input type="checkbox" checked={config.musicPlayback} onChange={(event) => void save({ musicPlayback: event.target.checked })} />{t.fullscreen.music}</label>
      <div className="fs-volume"><span>{t.fullscreen.volume}</span><button type="button" aria-label={t.fullscreen.volume + " −"} onClick={() => void save({ musicVolume: Math.max(0, config.musicVolume - 5) })}>{"−"}</button><output>{config.musicVolume}%</output><button type="button" aria-label={t.fullscreen.volume + " +"} onClick={() => void save({ musicVolume: Math.min(100, config.musicVolume + 5) })}>{"+"}</button></div>
      <div className="fs-choice" role="radiogroup" aria-label={t.fullscreen.coverRows}><span>{t.fullscreen.coverRows}</span>
        {[1, 2, 3].map((rows) => <label key={rows}><input type="radio" name="fullscreen-rows" checked={config.coverRows === rows} onChange={() => void save({ coverRows: rows })} />{rows}</label>)}
      </div>
      <div className="fs-choice" role="radiogroup" aria-label={t.fullscreen.trailers}><span>{t.fullscreen.trailers}</span>
        {FULLSCREEN_TRAILERS.map((trailers) => <label key={trailers}><input type="radio" name="fullscreen-playtrove-trailers" checked={config.playtroveTrailers === trailers} onChange={() => void save({ playtroveTrailers: trailers })} />{t.fullscreen.trailerNames[trailers]}</label>)}
      </div>
      <label><input type="checkbox" checked={config.showClock} onChange={(event) => void save({ showClock: event.target.checked })} />{t.fullscreen.showClock}</label>
      <label><input type="checkbox" checked={config.uiSounds} onChange={(event) => void save({ uiSounds: event.target.checked })} />{t.fullscreen.uiSounds}</label>
      <div className="fs-volume"><span>{t.fullscreen.uiSoundsVolume}</span><button type="button" aria-label={t.fullscreen.uiSoundsVolume + " −"} onClick={() => void save({ uiSoundsVolume: Math.max(0, config.uiSoundsVolume - 10) })}>{"−"}</button><output>{config.uiSoundsVolume}%</output><button type="button" aria-label={t.fullscreen.uiSoundsVolume + " +"} onClick={() => void save({ uiSoundsVolume: Math.min(100, config.uiSoundsVolume + 10) })}>{"+"}</button></div>
      <label><input type="checkbox" checked={config.swapConfirm} onChange={(event) => void save({ swapConfirm: event.target.checked })} />{t.fullscreen.swapConfirm}</label>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
