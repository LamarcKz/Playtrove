import { useState, type ReactNode } from "react"
import { ANIKI_COLOR_PRESETS } from "@shared/anikiColors"
import { DETAILS_LAYOUTS, FULLSCREEN_EFFECTS, FULLSCREEN_INTERFACES, FULLSCREEN_TRAILERS, LIBRARY_LAYOUTS, PROFILE_AVATARS } from "@shared/fullscreen"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { useI18n } from "@/hooks/useI18n"
import { AnikiAvatar } from "./AnikiAvatar"

export const SETTINGS_CATEGORIES = ["general", "interface", "library", "details", "media"] as const
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]

interface Props { category: SettingsCategory; onCategory: (category: SettingsCategory) => void; onEditName: () => void; onRunSetup: () => void }

/** O próximo valor de uma lista, em ciclo (cada ✕ numa opção de escolha avança um). */
function next<T>(list: readonly T[], value: T): T {
  return list[(list.indexOf(value) + 1) % list.length]
}

/**
 * Configurações da tela cheia no estilo do Aniki: categorias à esquerda (L1/R1 trocam), as opções da
 * categoria no meio e, embaixo, a descrição da opção com o foco.
 */
export function AnikiSettings({ category, onCategory, onEditName, onRunSetup }: Props) {
  const { t } = useI18n()
  const { config, save, error, pending } = useFullscreenConfig()
  const [focused, setFocused] = useState<keyof typeof t.fullscreen.settingsDescriptions | null>(null)
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
      {choice("theme", t.fullscreen.theme, t.fullscreen.themeNames[config.theme], () => void save({ theme: "playtrove" }))}
      {toggle("startOnLaunch", t.fullscreen.startup, config.startOnLaunch, (value) => void save({ startOnLaunch: value }))}
      {choice("startDestination", t.fullscreen.startIn, config.startDestination === "hub" ? t.fullscreen.hub : t.fullscreen.library, () => void save({ startDestination: config.startDestination === "hub" ? "library" : "hub" }))}
      {toggle("loginScreen", t.fullscreen.loginScreen, config.loginScreen, (value) => void save({ loginScreen: value }))}
      {choice("profileName", t.fullscreen.profileName, config.profileName || t.fullscreen.defaultProfileName, onEditName)}
      <div className="aniki-setting-grid" role="group" aria-label={t.fullscreen.avatar}>
        {PROFILE_AVATARS.map((avatar) => <button type="button" key={avatar} aria-label={t.fullscreen.avatars[avatar]} aria-pressed={config.profileAvatar === avatar} {...describe("avatar")} onClick={() => void save({ profileAvatar: avatar })}><AnikiAvatar avatar={avatar} size={56} /></button>)}
      </div>
      <button type="button" className="aniki-setting" {...describe("runSetup")} onClick={onRunSetup}><span>{t.fullscreen.runSetup}</span></button>
    </>,
    interface: <>
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
      {toggle("music", t.fullscreen.music, config.musicPlayback, (value) => void save({ musicPlayback: value }))}
      <div className="aniki-setting aniki-setting-volume"><span>{t.fullscreen.volume}</span>
        <button type="button" aria-label={t.fullscreen.volume + " −"} {...describe("volume")} onClick={() => void save({ musicVolume: Math.max(0, config.musicVolume - 5) })}>{"−"}</button>
        <output>{config.musicVolume}%</output>
        <button type="button" aria-label={t.fullscreen.volume + " +"} {...describe("volume")} onClick={() => void save({ musicVolume: Math.min(100, config.musicVolume + 5) })}>{"+"}</button>
      </div>
      {choice("trailers", t.fullscreen.trailers, t.fullscreen.trailerNames[config.trailers], () => void save({ trailers: next(FULLSCREEN_TRAILERS, config.trailers) }))}
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
