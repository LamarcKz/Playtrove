import { useState } from "react"
import { ANIKI_COLOR_PRESETS } from "@shared/anikiColors"
import { FULLSCREEN_EFFECTS, PROFILE_AVATARS } from "@shared/fullscreen"
import { useI18n } from "@/hooks/useI18n"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { AnikiAvatar } from "./AnikiAvatar"
import { FullscreenThemePicker } from "./FullscreenThemePicker"

/**
 * Preferências da tela cheia: em Configurações → Geral do modo janela e no painel do tema Playtrove. As do
 * Aniki só aparecem com ele escolhido; dentro do tema Aniki, elas ficam nas configurações pelo controle
 * (AnikiSettings).
 */
export function FullscreenPreferences() {
  const { t } = useI18n()
  const { config, save, error, pending } = useFullscreenConfig()
  const [draft, setDraft] = useState<string | null>(null)
  if (!config) return <p>{error ?? t.common.loading}</p>
  return (
    <div className="fs-preferences" aria-busy={pending}>
      <FullscreenThemePicker />
      <label><input type="checkbox" checked={config.startOnLaunch} onChange={(event) => void save({ startOnLaunch: event.target.checked })} />{t.fullscreen.startup}</label>
      <label><input type="checkbox" checked={config.musicPlayback} onChange={(event) => void save({ musicPlayback: event.target.checked })} />{t.fullscreen.music}</label>
      <div className="fs-volume"><span>{t.fullscreen.volume}</span><button type="button" aria-label={t.fullscreen.volume + " −"} onClick={() => void save({ musicVolume: Math.max(0, config.musicVolume - 5) })}>{"−"}</button><output>{config.musicVolume}%</output><button type="button" aria-label={t.fullscreen.volume + " +"} onClick={() => void save({ musicVolume: Math.min(100, config.musicVolume + 5) })}>{"+"}</button></div>
      {config.theme === "aniki" && <>
      <div className="fs-choice" role="radiogroup" aria-label={t.fullscreen.startIn}><span>{t.fullscreen.startIn}</span>
        {(["hub", "library"] as const).map((destination) => <label key={destination}><input type="radio" name="fullscreen-start" checked={config.startDestination === destination} onChange={() => void save({ startDestination: destination })} />{destination === "hub" ? t.fullscreen.hub : t.fullscreen.library}</label>)}
      </div>
      <label className="fs-profile-name">{t.fullscreen.profileName}<input type="text" maxLength={32} value={draft ?? config.profileName} placeholder={t.fullscreen.defaultProfileName} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== null) void save({ profileName: draft.trim() }).finally(() => setDraft(null)) }} /></label>
      <div className="fs-avatars" role="group" aria-label={t.fullscreen.avatar}>
        {PROFILE_AVATARS.map((avatar) => <button type="button" key={avatar} aria-label={t.fullscreen.avatars[avatar]} aria-pressed={config.profileAvatar === avatar} onClick={() => void save({ profileAvatar: avatar })}><AnikiAvatar avatar={avatar} size={40} /></button>)}
      </div>
      <div className="fs-choice" role="radiogroup" aria-label={t.fullscreen.effects}><span>{t.fullscreen.effects}</span>
        {FULLSCREEN_EFFECTS.map((effects) => <label key={effects}><input type="radio" name="fullscreen-effects" checked={config.effects === effects} onChange={() => void save({ effects })} />{t.fullscreen.effectsNames[effects]}</label>)}
      </div>
      <label><input type="checkbox" checked={config.dynamicColors} onChange={(event) => void save({ dynamicColors: event.target.checked })} />{t.fullscreen.dynamicColors}</label>
      <div className="fs-swatches" role="group" aria-label={t.fullscreen.colorPreset}>
        {ANIKI_COLOR_PRESETS.map((preset) => <button type="button" key={preset.id} title={preset.name} aria-label={preset.name} aria-pressed={config.colorPreset === preset.id} onClick={() => void save({ colorPreset: preset.id })}><span className="aniki-swatch" data-aniki-color={preset.id} /></button>)}
      </div>
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
