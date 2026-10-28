import { useSyncExternalStore } from "react"
import { useI18n } from "@/hooks/useI18n"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { fullscreenMusicControls } from "@/lib/fullscreenMusicControls"
import { AnikiIcon } from "./AnikiGlyph"

function elapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const remainder = String(total % 60).padStart(2, "0")
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`
}

/** Controles do mesmo player ambiente; não monta outro áudio nem consulta players externos. */
export function AnikiMusicPlayer() {
  const { t } = useI18n()
  const { config, save, pending, error } = useFullscreenConfig()
  const music = useSyncExternalStore(fullscreenMusicControls.subscribe, fullscreenMusicControls.getSnapshot)
  const title = music.available && music.context
    ? music.context === "library" ? music.gameTitle || t.musicPlayer.contexts.library : t.musicPlayer.contexts[music.context]
    : t.musicPlayer.noTrack
  const canToggle = music.available && music.enabled && !music.suspended
  const status = !music.available ? t.musicPlayer.noTrack : music.failed ? t.musicPlayer.failed : music.blocked ? t.musicPlayer.blocked
    : !music.enabled ? t.musicPlayer.disabled : music.suspended ? t.musicPlayer.suspended : music.playing ? t.musicPlayer.playing : t.musicPlayer.paused

  return <div className="aniki-quick-options overflow-y-auto" data-testid="aniki-music-player" data-music-transport aria-busy={pending}>
    <h2>{t.musicPlayer.title}</h2>
    <div className="flex flex-col items-center gap-5 py-8 text-center">
      <span className="text-[72px]" aria-hidden="true"><AnikiIcon icon="music" /></span>
      <h3 className="w-full break-words text-[30px]">{title}</h3>
      <p role="status" className="text-[21px]">{status}</p>
      {music.available && <div className="w-full">
        <progress aria-label={t.musicPlayer.progress} value={music.duration ? music.position : 0} max={music.duration || 1} className="h-3 w-full accent-[var(--aniki-light)]" />
        <div className="mt-2 flex justify-between text-[20px]"><span>{elapsed(music.position)}</span><span>{music.duration ? elapsed(music.duration) : t.musicPlayer.durationUnknown}</span></div>
      </div>}
    </div>
    <div className="aniki-menu-items">
      {config && !config.musicPlayback && <button type="button" data-fs-default aria-disabled={pending} onClick={() => { if (!pending) void save({ musicPlayback: true }) }}>{t.musicPlayer.enable}</button>}
      <button type="button" data-fs-default={config?.musicPlayback ? true : undefined} disabled={!canToggle} onClick={() => fullscreenMusicControls.toggle()}>{music.playing ? t.musicPlayer.pause : t.musicPlayer.play}</button>
      <button type="button" disabled={!music.available} aria-pressed={music.muted} onClick={() => fullscreenMusicControls.toggleMute()}>{music.muted ? t.musicPlayer.unmute : t.musicPlayer.mute}</button>
      <div className="aniki-quick-volume">
        <span>{t.musicPlayer.volume}</span>
        <button type="button" aria-label={t.musicPlayer.decreaseVolume} disabled={!config || config.musicVolume <= 0} aria-disabled={pending}
          onClick={() => { if (config && !pending) void save({ musicVolume: Math.max(0, config.musicVolume - 5) }) }}>{"−"}</button>
        <output>{config?.musicVolume ?? music.volume}%</output>
        <button type="button" aria-label={t.musicPlayer.increaseVolume} disabled={!config || config.musicVolume >= 100} aria-disabled={pending}
          onClick={() => { if (config && !pending) void save({ musicVolume: Math.min(100, config.musicVolume + 5) }) }}>{"+"}</button>
      </div>
    </div>
    {error && <p role="alert" className="mt-5 text-[22px]">{error}</p>}
  </div>
}
