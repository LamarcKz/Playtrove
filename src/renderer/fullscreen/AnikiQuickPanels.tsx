import { useI18n } from "@/hooks/useI18n"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { AnikiIcon } from "./AnikiGlyph"
import { AnikiAvatar } from "./AnikiAvatar"

interface QuickAccessProps { canRandom: boolean; updating: boolean; onSettings: () => void; onRandom: () => void; onUpdate: () => void; onPower: () => void }

/** Quick Access do Aniki (Options): painel à esquerda com o perfil e os atalhos do app. */
export function AnikiQuickAccess({ canRandom, updating, onSettings, onRandom, onUpdate, onPower }: QuickAccessProps) {
  const { t } = useI18n()
  const { config } = useFullscreenConfig()
  return <div className="aniki-main-menu aniki-quick-access" data-testid="aniki-quick-access">
    {config && <div className="aniki-quick-profile"><AnikiAvatar avatar={config.profileAvatar} size={72} /><strong>{config.profileName || t.fullscreen.defaultProfileName}</strong></div>}
    <div className="aniki-menu-items">
      <button type="button" data-fs-default onClick={onSettings}><AnikiIcon icon="settings" /><span>{t.fullscreen.settings}</span></button>
      <button type="button" disabled={!canRandom} onClick={onRandom}><AnikiIcon icon="random" /><span>{t.fullscreen.randomGame}</span></button>
      <button type="button" disabled={updating} onClick={onUpdate}><AnikiIcon icon="refresh" /><span>{updating ? t.fullscreen.updatingLibrary : t.fullscreen.updateLibrary}</span></button>
      <button type="button" onClick={onPower}><AnikiIcon icon="power" /><span>{t.fullscreen.power}</span></button>
    </div>
  </div>
}

/** Quick Options do Aniki (segurar Create): painel à direita com as mudanças rápidas de mídia e de início. */
export function AnikiQuickOptions() {
  const { t } = useI18n()
  const { config, save, error, pending } = useFullscreenConfig()
  return <div className="aniki-quick-options" data-testid="aniki-quick-options" aria-busy={pending}>
    <h2>{t.fullscreen.quickOptions}</h2>
    {!config ? <p>{error ?? t.common.loading}</p> : <div className="aniki-menu-items">
      <button type="button" data-fs-default aria-pressed={config.musicPlayback} onClick={() => void save({ musicPlayback: !config.musicPlayback })}><AnikiIcon icon="music" /><span>{t.fullscreen.music}</span></button>
      <div className="aniki-quick-volume"><span>{t.fullscreen.volume}</span>
        <button type="button" aria-label={t.fullscreen.volume + " −"} onClick={() => void save({ musicVolume: Math.max(0, config.musicVolume - 5) })}>{"−"}</button>
        <output>{config.musicVolume}%</output>
        <button type="button" aria-label={t.fullscreen.volume + " +"} onClick={() => void save({ musicVolume: Math.min(100, config.musicVolume + 5) })}>{"+"}</button>
      </div>
      <button type="button" aria-pressed={config.startDestination === "hub"} onClick={() => void save({ startDestination: config.startDestination === "hub" ? "library" : "hub" })}><AnikiIcon icon="home" /><span>{t.fullscreen.startIn}: {config.startDestination === "hub" ? t.fullscreen.hub : t.fullscreen.library}</span></button>
    </div>}
    {error && config && <p role="alert">{error}</p>}
  </div>
}
