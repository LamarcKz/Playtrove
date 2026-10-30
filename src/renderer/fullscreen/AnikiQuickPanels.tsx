import { ANIKI_COLOR_PRESETS } from "@shared/anikiColors"
import { DETAILS_LAYOUTS, FULLSCREEN_EFFECTS, LIBRARY_LAYOUTS } from "@shared/fullscreen"
import { useI18n } from "@/hooks/useI18n"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { AnikiIcon } from "./AnikiGlyph"
import { AnikiAvatar } from "./AnikiAvatar"

interface QuickAccessProps { canRandom: boolean; updating: boolean; onProfile: () => void; onTrophies: () => void; onSettings: () => void; onRandom: () => void; onUpdate: () => void; onPower: () => void; onAudio: () => void; onMusic: () => void; onNotices: () => void; onHelp: () => void; onMaintenance: () => void; onNews: () => void }

/** Quick Access do Aniki (Options): painel à esquerda com o perfil e os atalhos do app. */
export function AnikiQuickAccess({ canRandom, updating, onProfile, onTrophies, onSettings, onRandom, onUpdate, onPower, onAudio, onMusic, onNotices, onHelp, onMaintenance, onNews }: QuickAccessProps) {
  const { t } = useI18n()
  const { config } = useFullscreenConfig()
  return <div className="aniki-main-menu aniki-quick-access" data-testid="aniki-quick-access">
    {config && <div className="aniki-quick-profile"><AnikiAvatar avatar={config.profileAvatar} size={72} /><strong>{config.profileName || t.fullscreen.defaultProfileName}</strong></div>}
    <div className="aniki-menu-items">
      <button type="button" data-fs-default onClick={onProfile}><AnikiIcon icon="contact" /><span>{t.fullscreen.profile}</span></button>
      <button type="button" onClick={onTrophies}><AnikiIcon icon="trophy" /><span>{t.fullscreen.trophiesTitle}</span></button>
      <button type="button" onClick={onSettings}><AnikiIcon icon="settings" /><span>{t.fullscreen.settings}</span></button>
      <button type="button" onClick={onAudio}><AnikiIcon icon="audio" /><span>{t.audioOutput.title}</span></button>
      <button type="button" onClick={onMusic}><AnikiIcon icon="music" /><span>{t.musicPlayer.title}</span></button>
      <button type="button" onClick={onNews}><AnikiIcon icon="notices" /><span>{t.anikiNews.title}</span></button>
      <button type="button" onClick={onNotices}><AnikiIcon icon="notices" /><span>{t.fullscreen.notices}</span></button>
      <button type="button" onClick={onHelp}><AnikiIcon icon="help" /><span>{t.fullscreen.help}</span></button>
      <button type="button" onClick={onMaintenance}><AnikiIcon icon="settings" /><span>{t.fullscreenProfiles.title}</span></button>
      <button type="button" disabled={!canRandom} onClick={onRandom}><AnikiIcon icon="random" /><span>{t.fullscreen.randomGame}</span></button>
      <button type="button" disabled={updating} onClick={onUpdate}><AnikiIcon icon="refresh" /><span>{updating ? t.fullscreen.updatingLibrary : t.fullscreen.updateLibrary}</span></button>
      <button type="button" onClick={onPower}><AnikiIcon icon="power" /><span>{t.fullscreen.power}</span></button>
    </div>
  </div>
}

/** Quick Options do Aniki (segurar Create): painel à direita com as mudanças rápidas de mídia, layouts e início. */
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
      <button type="button" onClick={() => void save({ libraryLayout: LIBRARY_LAYOUTS[(LIBRARY_LAYOUTS.indexOf(config.libraryLayout) + 1) % LIBRARY_LAYOUTS.length] })}><AnikiIcon icon="layout" /><span>{t.fullscreen.libraryLayout}: {t.fullscreen.libraryLayouts[config.libraryLayout]}</span></button>
      <button type="button" onClick={() => void save({ detailsLayout: DETAILS_LAYOUTS[(DETAILS_LAYOUTS.indexOf(config.detailsLayout) + 1) % DETAILS_LAYOUTS.length] })}><AnikiIcon icon="layout" /><span>{t.fullscreen.detailsLayout}: {t.fullscreen.detailsLayouts[config.detailsLayout]}</span></button>
      <button type="button" onClick={() => void save({ colorPreset: ANIKI_COLOR_PRESETS[(ANIKI_COLOR_PRESETS.findIndex((preset) => preset.id === config.colorPreset) + 1) % ANIKI_COLOR_PRESETS.length].id })}><span className="aniki-swatch aniki-swatch-small" data-aniki-color={config.colorPreset} /><span>{t.fullscreen.colorPreset}: {ANIKI_COLOR_PRESETS.find((preset) => preset.id === config.colorPreset)?.name}</span></button>
      <button type="button" aria-pressed={config.dynamicColors} onClick={() => void save({ dynamicColors: !config.dynamicColors })}><AnikiIcon icon="color" /><span>{t.fullscreen.dynamicColors}</span></button>
      <button type="button" onClick={() => void save({ effects: FULLSCREEN_EFFECTS[(FULLSCREEN_EFFECTS.indexOf(config.effects) + 1) % FULLSCREEN_EFFECTS.length] })}><AnikiIcon icon="effects" /><span>{t.fullscreen.effects}: {t.fullscreen.effectsNames[config.effects]}</span></button>
      <button type="button" aria-pressed={config.startDestination === "hub"} onClick={() => void save({ startDestination: config.startDestination === "hub" ? "library" : "hub" })}><AnikiIcon icon="home" /><span>{t.fullscreen.startIn}: {config.startDestination === "hub" ? t.fullscreen.hub : t.fullscreen.library}</span></button>
    </div>}
    {error && config && <p role="alert">{error}</p>}
  </div>
}
