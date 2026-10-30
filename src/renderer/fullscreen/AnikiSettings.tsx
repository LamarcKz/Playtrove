import { useEffect, useState, type ReactNode } from "react"
import { ANIKI_COLOR_PRESETS } from "@shared/anikiColors"
import { ANIKI_AVATAR_INDICES, CONTROLLER_ICON_STYLES } from "@shared/anikiAppearance"
import { IN_GAME_OVERLAY_HOTKEYS, type GameOverlayState } from "@shared/gameOverlay"
import { ANIKI_SCREENSAVER_IDLE_PRESETS, ANIKI_SCREENSAVER_INTERVAL_PRESETS, ANIKI_SCREENSAVER_SOURCES } from "@shared/anikiPresentation"
import { DETAILS_LAYOUTS, FULLSCREEN_EFFECTS, FULLSCREEN_INTERFACES, FULLSCREEN_TRAILERS, LIBRARY_LAYOUTS, PROFILE_AVATARS } from "@shared/fullscreen"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { useI18n } from "@/hooks/useI18n"
import { AnikiAvatar } from "./AnikiAvatar"
import { GAME_LAUNCH_SPLASH_LOGO_POSITIONS, GAME_LAUNCH_SPLASH_SELECTION_MODES } from "@shared/gameLaunchSplash"

export const SETTINGS_CATEGORIES = ["general", "interface", "library", "details", "media", "screenSaver", "gameLaunchSplash"] as const
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]
export type SplashDurationField = "gameLaunchSplashMinimumDurationMs" | "gameLaunchSplashMaximumWaitMs"

interface Props { category: SettingsCategory; onCategory: (category: SettingsCategory) => void; onEditName: () => void; onRunSetup: () => void; onPreviewScreenSaver: () => void; canPreviewScreenSaver: boolean; onCustomAvatar: () => void; onGlobalSplash: () => void; onEditSplashDuration: (field: SplashDurationField) => void }

/** O próximo valor de uma lista, em ciclo (cada ✕ numa opção de escolha avança um). */
function next<T>(list: readonly T[], value: T): T {
  return list[(list.indexOf(value) + 1) % list.length]
}

/** Só informa disponibilidade confirmada pelo serviço; ausência de relatório do controle é normal. */
export function AnikiOverlayShortcutStatus({ state }: { state: GameOverlayState | null }) {
  const { t } = useI18n()
  if (!state?.enabled) return null
  return <div className="aniki-settings-description">
    {state.keyboardShortcutAvailable
      ? <p role="status">{t.fullscreen.inGameOverlayKeyboardAvailable}</p>
      : <p role="alert">{t.fullscreen.inGameOverlayKeyboardUnavailable}</p>}
    {state.controllerShortcutAvailable && <p role="status">{t.fullscreen.inGameOverlayControllerAvailable}</p>}
  </div>
}

/**
 * Configurações da tela cheia no estilo do Aniki: categorias à esquerda (L1/R1 trocam), as opções da
 * categoria no meio e, embaixo, a descrição da opção com o foco.
 */
export function AnikiSettings({ category, onCategory, onEditName, onRunSetup, onPreviewScreenSaver, canPreviewScreenSaver, onCustomAvatar, onGlobalSplash, onEditSplashDuration }: Props) {
  const { t } = useI18n()
  const { config, save, error, pending } = useFullscreenConfig()
  const [focused, setFocused] = useState<keyof typeof t.fullscreen.settingsDescriptions | null>(null)
  const [overlayState, setOverlayState] = useState<GameOverlayState | null>(null)
  useEffect(() => {
    setOverlayState(null)
    if (!config?.inGameOverlayEnabled) return
    let active = true
    let receivedState = false
    const stop = window.api.gameOverlay.onStateChange((state) => {
      receivedState = true
      if (active) setOverlayState(state)
    })
    window.api.gameOverlay.getState().then((state) => {
      if (active && !receivedState) setOverlayState(state)
    }).catch(() => {
      // Sem resposta não há evidência para afirmar que o atalho está indisponível.
    })
    return () => {
      active = false
      stop()
    }
  }, [config?.inGameOverlayEnabled, config?.inGameOverlayHotkey])
  if (!config) return <p>{error ?? t.common.loading}</p>
  const describe = (key: keyof typeof t.fullscreen.settingsDescriptions) => ({ onFocus: () => setFocused(key), onMouseEnter: () => setFocused(key) })
  const toggle = (key: keyof typeof t.fullscreen.settingsDescriptions, label: string, checked: boolean, change: (value: boolean) => void) =>
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="aniki-setting" {...describe(key)} onClick={() => change(!checked)}>
      <span>{label}</span><strong>{checked ? t.fullscreen.on : t.fullscreen.off}</strong>
    </button>
  const choice = (key: keyof typeof t.fullscreen.settingsDescriptions, label: string, value: string, change: () => void) =>
    <button type="button" className="aniki-setting" {...describe(key)} onClick={change}><span>{label}</span><strong>{value}</strong></button>
  const rows: Record<(typeof SETTINGS_CATEGORIES)[number], ReactNode> = {
    general: <>
      {toggle("startupIntroVideoEnabled", t.anikiPresentation.startup, config.startupIntroVideoEnabled, (value) => void save({ startupIntroVideoEnabled: value }))}
      {toggle("shutdownVideoEnabled", t.anikiPresentation.shutdown, config.shutdownVideoEnabled, (value) => void save({ shutdownVideoEnabled: value }))}
      {toggle("inGameOverlayEnabled", t.fullscreen.inGameOverlayEnabled, config.inGameOverlayEnabled, (value) => void save({ inGameOverlayEnabled: value }))}
      {choice("inGameOverlayHotkey", t.fullscreen.inGameOverlayHotkey, t.fullscreen.inGameOverlayHotkeyNames[config.inGameOverlayHotkey], () => void save({ inGameOverlayHotkey: next(IN_GAME_OVERLAY_HOTKEYS, config.inGameOverlayHotkey) }))}
      {config.inGameOverlayEnabled && <AnikiOverlayShortcutStatus state={overlayState} />}
      {choice("theme", t.fullscreen.theme, t.fullscreen.themeNames[config.theme], () => void save({ theme: "playtrove" }))}
      {toggle("startOnLaunch", t.fullscreen.startup, config.startOnLaunch, (value) => void save({ startOnLaunch: value }))}
      {choice("startDestination", t.fullscreen.startIn, config.startDestination === "hub" ? t.fullscreen.hub : t.fullscreen.library, () => void save({ startDestination: config.startDestination === "hub" ? "library" : "hub" }))}
      {toggle("loginScreen", t.fullscreen.loginScreen, config.loginScreen, (value) => void save({ loginScreen: value }))}
      {choice("profileName", t.fullscreen.profileName, config.profileName || t.fullscreen.defaultProfileName, onEditName)}
      <button type="button" className="aniki-setting" {...describe("avatar")} onClick={onCustomAvatar}><span>{t.anikiCustomMedia.avatarTitle}</span></button>
      <div className="aniki-setting-grid" role="group" aria-label={t.fullscreen.avatar}>
        {PROFILE_AVATARS.map((avatar) => <button type="button" key={avatar} aria-label={t.fullscreen.avatars[avatar]} aria-pressed={config.anikiAvatarIndex === null && config.profileAvatar === avatar} {...describe("avatar")} onClick={() => void save({ profileAvatar: avatar, anikiAvatarIndex: null })}><AnikiAvatar avatar={avatar} size={56} anikiAvatarIndex={null} /></button>)}
      </div>
      <div className="aniki-setting-grid" role="group" aria-label={t.fullscreen.packageAvatars}>
        {ANIKI_AVATAR_INDICES.map((index) => <button type="button" key={index} aria-label={t.fullscreen.packageAvatar(index)} aria-pressed={config.anikiAvatarIndex === index} {...describe("packageAvatar")} onClick={() => void save({ anikiAvatarIndex: index, ...(config.profileAvatar === "custom" ? { profileAvatar: "gamepad" as const } : {}) })}><AnikiAvatar avatar={config.profileAvatar} size={56} anikiAvatarIndex={index} /></button>)}
      </div>
      <button type="button" className="aniki-setting" {...describe("runSetup")} onClick={onRunSetup}><span>{t.fullscreen.runSetup}</span></button>
    </>,
    interface: <>
      {choice("controllerIconStyle", t.fullscreen.controllerIconStyle, t.fullscreen.controllerStyleNames[config.controllerIconStyle], () => void save({ controllerIconStyle: next(CONTROLLER_ICON_STYLES, config.controllerIconStyle) }))}
      {choice("interface", t.fullscreen.interfaceStyle, t.fullscreen.interfaceNames[config.interface], () => void save({ interface: next(FULLSCREEN_INTERFACES, config.interface) }))}
      {choice("effects", t.fullscreen.effects, t.fullscreen.effectsNames[config.effects], () => void save({ effects: next(FULLSCREEN_EFFECTS, config.effects) }))}
      {toggle("dynamicColors", t.fullscreen.dynamicColors, config.dynamicColors, (value) => void save({ dynamicColors: value }))}
      <div className="aniki-setting-grid" role="group" aria-label={t.fullscreen.colorPreset}>
        {ANIKI_COLOR_PRESETS.map((preset) => <button type="button" key={preset.id} title={preset.name} aria-label={preset.name} aria-pressed={config.colorPreset === preset.id} {...describe("colorPreset")} onClick={() => void save({ colorPreset: preset.id })}><span className="aniki-swatch" data-aniki-color={preset.id} /></button>)}
      </div>
    </>,
    library: choice("libraryLayout", t.fullscreen.libraryLayout, t.fullscreen.libraryLayouts[config.libraryLayout], () => void save({ libraryLayout: next(LIBRARY_LAYOUTS, config.libraryLayout) })),
    details: choice("detailsLayout", t.fullscreen.detailsLayout, t.fullscreen.detailsLayouts[config.detailsLayout], () => void save({ detailsLayout: next(DETAILS_LAYOUTS, config.detailsLayout) })),
    media: <>
      {toggle("uiSounds", t.fullscreen.uiSounds, config.uiSounds, (value) => void save({ uiSounds: value }))}
      <div className="aniki-setting aniki-setting-volume"><span>{t.fullscreen.uiSoundsVolume}</span>
        <button type="button" aria-label={t.fullscreen.uiSoundsVolume + " −"} {...describe("uiSoundsVolume")} onClick={() => void save({ uiSoundsVolume: Math.max(0, config.uiSoundsVolume - 5) })}>{"−"}</button>
        <output>{config.uiSoundsVolume}%</output>
        <button type="button" aria-label={t.fullscreen.uiSoundsVolume + " +"} {...describe("uiSoundsVolume")} onClick={() => void save({ uiSoundsVolume: Math.min(100, config.uiSoundsVolume + 5) })}>{"+"}</button>
      </div>
      {toggle("music", t.fullscreen.music, config.musicPlayback, (value) => void save({ musicPlayback: value }))}
      <div className="aniki-setting aniki-setting-volume"><span>{t.fullscreen.volume}</span>
        <button type="button" aria-label={t.fullscreen.volume + " −"} {...describe("volume")} onClick={() => void save({ musicVolume: Math.max(0, config.musicVolume - 5) })}>{"−"}</button>
        <output>{config.musicVolume}%</output>
        <button type="button" aria-label={t.fullscreen.volume + " +"} {...describe("volume")} onClick={() => void save({ musicVolume: Math.min(100, config.musicVolume + 5) })}>{"+"}</button>
      </div>
      {choice("trailers", t.fullscreen.trailers, t.fullscreen.trailerNames[config.trailers], () => void save({ trailers: next(FULLSCREEN_TRAILERS, config.trailers) }))}
    </>,
    gameLaunchSplash: <>
      {toggle("gameLaunchSplashEnabled", t.gameLaunchSplash.enabled, config.gameLaunchSplashEnabled, (value) => void save({ gameLaunchSplashEnabled: value }))}
      {choice("gameLaunchSplashMinimumDurationMs", t.gameLaunchSplash.minimum, t.gameLaunchSplash.seconds(config.gameLaunchSplashMinimumDurationMs / 1000), () => onEditSplashDuration("gameLaunchSplashMinimumDurationMs"))}
      {choice("gameLaunchSplashMaximumWaitMs", t.gameLaunchSplash.maximum, t.gameLaunchSplash.seconds(config.gameLaunchSplashMaximumWaitMs / 1000), () => onEditSplashDuration("gameLaunchSplashMaximumWaitMs"))}
      {choice("gameLaunchSplashSelectionMode", t.gameLaunchSplash.source, t.gameLaunchSplash.sources[config.gameLaunchSplashSelectionMode], () => void save({ gameLaunchSplashSelectionMode: next(GAME_LAUNCH_SPLASH_SELECTION_MODES, config.gameLaunchSplashSelectionMode) }))}
      <button type="button" className="aniki-setting" {...describe("gameLaunchSplashSelectionMode")} onClick={onGlobalSplash}><span>{t.anikiCustomMedia.globalSplashTitle}</span></button>
      {toggle("gameLaunchSplashShowLogo", t.gameLaunchSplash.logo, config.gameLaunchSplashShowLogo, (value) => void save({ gameLaunchSplashShowLogo: value }))}
      {choice("gameLaunchSplashLogoPosition", t.gameLaunchSplash.position, t.gameLaunchSplash.positions[config.gameLaunchSplashLogoPosition], () => void save({ gameLaunchSplashLogoPosition: next(GAME_LAUNCH_SPLASH_LOGO_POSITIONS, config.gameLaunchSplashLogoPosition) }))}
      <div className="aniki-setting aniki-setting-volume"><span>{t.gameLaunchSplash.dimming}</span>
        <button type="button" aria-label={t.gameLaunchSplash.dimming + " −"} {...describe("gameLaunchSplashBackgroundDimming")} onClick={() => void save({ gameLaunchSplashBackgroundDimming: Math.max(0, Math.round((config.gameLaunchSplashBackgroundDimming - .05) * 100) / 100) })}>{"−"}</button>
        <output>{Math.round(config.gameLaunchSplashBackgroundDimming * 100)}%</output>
        <button type="button" aria-label={t.gameLaunchSplash.dimming + " +"} {...describe("gameLaunchSplashBackgroundDimming")} onClick={() => void save({ gameLaunchSplashBackgroundDimming: Math.min(.8, Math.round((config.gameLaunchSplashBackgroundDimming + .05) * 100) / 100) })}>{"+"}</button>
      </div>
    </>,
    screenSaver: <>
      {toggle("screenSaverEnabled", t.anikiPresentation.enabled, config.screenSaverEnabled, (value) => void save({ screenSaverEnabled: value }))}
      {choice("screenSaverIdleDelayMinutes", t.anikiPresentation.idle, config.screenSaverIdleDelayMinutes < 0 ? t.anikiPresentation.seconds(-config.screenSaverIdleDelayMinutes) : t.anikiPresentation.minutes(config.screenSaverIdleDelayMinutes), () => void save({ screenSaverIdleDelayMinutes: next<number>(ANIKI_SCREENSAVER_IDLE_PRESETS, config.screenSaverIdleDelayMinutes) }))}
      {choice("screenSaverChangeIntervalSeconds", t.anikiPresentation.interval, t.anikiPresentation.seconds(config.screenSaverChangeIntervalSeconds), () => void save({ screenSaverChangeIntervalSeconds: next<number>(ANIKI_SCREENSAVER_INTERVAL_PRESETS, config.screenSaverChangeIntervalSeconds) }))}
      {choice("screenSaverSource", t.anikiPresentation.source, t.anikiPresentation.sources[config.screenSaverSource], () => void save({ screenSaverSource: next(ANIKI_SCREENSAVER_SOURCES, config.screenSaverSource) }))}
      {toggle("screenSaverAmbientMusicEnabled", t.anikiPresentation.ambient, config.screenSaverAmbientMusicEnabled, (value) => void save({ screenSaverAmbientMusicEnabled: value }))}
      {toggle("screenSaverShowLogo", t.anikiPresentation.logo, config.screenSaverShowLogo, (value) => void save({ screenSaverShowLogo: value }))}
      {toggle("screenSaverShowInfoCard", t.anikiPresentation.info, config.screenSaverShowInfoCard, (value) => void save({ screenSaverShowInfoCard: value }))}
      {toggle("screenSaverAnimateBackground", t.anikiPresentation.animate, config.screenSaverAnimateBackground, (value) => void save({ screenSaverAnimateBackground: value }))}
      {toggle("screenSaverUseFadeTransitions", t.anikiPresentation.fade, config.screenSaverUseFadeTransitions, (value) => void save({ screenSaverUseFadeTransitions: value }))}
      <button type="button" className="aniki-setting" disabled={!canPreviewScreenSaver} onClick={onPreviewScreenSaver}>{t.anikiPresentation.preview}</button>
    </>,
  }
  return <div className="aniki-settings" aria-busy={pending}>
    <h2>{t.fullscreen.settings}</h2>
    <nav className="aniki-settings-categories" aria-label={t.fullscreen.settings}>
      {SETTINGS_CATEGORIES.map((item) => <button type="button" key={item} aria-pressed={category === item} data-fs-default={category === item ? "" : undefined} onClick={() => onCategory(item)}>{t.fullscreen.settingsCategories[item]}</button>)}
    </nav>
    <section className="aniki-settings-options" aria-label={t.fullscreen.settingsCategories[category]}>{rows[category]}</section>
    <p className="aniki-settings-description" aria-live="polite">{focused ? t.fullscreen.settingsDescriptions[focused] : t.fullscreen.settingsHint}</p>
    {error && <p role="alert" className="fs-error">{error}</p>}
  </div>
}
