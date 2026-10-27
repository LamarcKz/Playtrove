import { useState } from "react"
import { PROFILE_AVATARS } from "@shared/fullscreen"
import { useI18n } from "@/hooks/useI18n"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { AnikiAvatar } from "./AnikiAvatar"

/**
 * Preferências da tela cheia, no painel dela e em Configurações → Geral. Na tela cheia, o nome do perfil
 * abre o teclado virtual (`onEditName`); no desktop, é um campo de texto.
 */
export function FullscreenPreferences({ onEditName }: { onEditName?: () => void }) {
  const { t } = useI18n()
  const { config, save, error, pending } = useFullscreenConfig()
  const [draft, setDraft] = useState<string | null>(null)
  if (!config) return <p>{error ?? t.common.loading}</p>
  const name = config.profileName || t.fullscreen.defaultProfileName
  return (
    <div className="fs-preferences" aria-busy={pending}>
      <label><input type="checkbox" checked={config.startOnLaunch} onChange={(event) => void save({ startOnLaunch: event.target.checked })} />{t.fullscreen.startup}</label>
      <div className="fs-choice" role="radiogroup" aria-label={t.fullscreen.startIn}><span>{t.fullscreen.startIn}</span>
        {(["hub", "library"] as const).map((destination) => <label key={destination}><input type="radio" name="fullscreen-start" checked={config.startDestination === destination} onChange={() => void save({ startDestination: destination })} />{destination === "hub" ? t.fullscreen.hub : t.fullscreen.library}</label>)}
      </div>
      <label><input type="checkbox" checked={config.musicPlayback} onChange={(event) => void save({ musicPlayback: event.target.checked })} />{t.fullscreen.music}</label>
      <div className="fs-volume"><span>{t.fullscreen.volume}</span><button type="button" aria-label={t.fullscreen.volume + " −"} onClick={() => void save({ musicVolume: Math.max(0, config.musicVolume - 5) })}>{"−"}</button><output>{config.musicVolume}%</output><button type="button" aria-label={t.fullscreen.volume + " +"} onClick={() => void save({ musicVolume: Math.min(100, config.musicVolume + 5) })}>{"+"}</button></div>
      {onEditName
        ? <button type="button" className="fs-profile-name" onClick={onEditName}>{t.fullscreen.profileName}: {name}</button>
        : <label className="fs-profile-name">{t.fullscreen.profileName}<input type="text" maxLength={32} value={draft ?? config.profileName} placeholder={t.fullscreen.defaultProfileName} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== null) void save({ profileName: draft.trim() }).finally(() => setDraft(null)) }} /></label>}
      <div className="fs-avatars" role="group" aria-label={t.fullscreen.avatar}>
        {PROFILE_AVATARS.map((avatar) => <button type="button" key={avatar} aria-label={t.fullscreen.avatars[avatar]} aria-pressed={config.profileAvatar === avatar} onClick={() => void save({ profileAvatar: avatar })}><AnikiAvatar avatar={avatar} size={40} /></button>)}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
