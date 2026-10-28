import { useCallback, useEffect, useRef, useState } from "react"
import type { AudioOutputState } from "@shared/audioOutput"
import { useI18n } from "@/hooks/useI18n"
import { AnikiIcon } from "./AnikiGlyph"

/** Troca a saída e controla o volume geral do Windows, como o Audio Switcher do Aniki. */
export function AnikiAudioPanel() {
  const { t } = useI18n()
  const [audio, setAudio] = useState<AudioOutputState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const mounted = useRef(false)
  const generation = useRef(0)

  const run = useCallback(async (action: () => Promise<AudioOutputState>, mutation = false) => {
    if (busy.current) return
    busy.current = true
    const request = ++generation.current
    if (mutation) setPending(true)
    try {
      const state = await action()
      if (mounted.current && request === generation.current) {
        setAudio(state)
        setError(null)
      }
    } catch (reason) {
      if (mounted.current && request === generation.current) setError(String(reason))
    } finally {
      if (request === generation.current) {
        busy.current = false
        if (mounted.current) setPending(false)
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    const refresh = () => void run(() => window.api.audioOutput.get())
    refresh()
    const timer = window.setInterval(refresh, 2000)
    window.addEventListener("focus", refresh)
    return () => {
      mounted.current = false
      generation.current++
      busy.current = false
      window.clearInterval(timer)
      window.removeEventListener("focus", refresh)
    }
  }, [run])

  const hasOutput = audio?.devices.some((device) => device.isDefault) ?? false
  return <div className="aniki-quick-options overflow-y-auto" data-testid="aniki-audio-output" aria-busy={pending}>
    <h2>{t.audioOutput.title}</h2>
    <p>{t.audioOutput.description}</p>
    <div className="aniki-menu-items">
      <button type="button" data-fs-default aria-disabled={pending} onClick={() => void run(() => window.api.audioOutput.get())}>
        <AnikiIcon icon="refresh" /><span>{t.audioOutput.refresh}</span>
      </button>
      {!audio && !error && <p>{t.common.loading}</p>}
      {audio && <>
        <div className="aniki-quick-volume">
          <span>{t.audioOutput.volume}</span>
          <button type="button" aria-label={t.audioOutput.decreaseVolume} disabled={!hasOutput || audio.volume <= 0} aria-disabled={pending}
            onClick={() => void run(() => window.api.audioOutput.setVolume(Math.max(0, audio.volume - 5)), true)}>{"−"}</button>
          <output aria-live="polite">{Math.round(audio.volume)}%</output>
          <button type="button" aria-label={t.audioOutput.increaseVolume} disabled={!hasOutput || audio.volume >= 100} aria-disabled={pending}
            onClick={() => void run(() => window.api.audioOutput.setVolume(Math.min(100, audio.volume + 5)), true)}>{"+"}</button>
        </div>
        <button type="button" aria-pressed={audio.muted} disabled={!hasOutput} aria-disabled={pending}
          onClick={() => void run(() => window.api.audioOutput.setMuted(!audio.muted), true)}>
          <AnikiIcon icon="music" /><span>{audio.muted ? t.audioOutput.unmute : t.audioOutput.mute}</span>
        </button>
        <h3>{t.audioOutput.devices}</h3>
        {audio.devices.length === 0 && <p>{t.audioOutput.noDevices}</p>}
        {audio.devices.map((device) => <button type="button" key={device.id} aria-pressed={device.isDefault} aria-disabled={pending}
          onClick={() => { if (!device.isDefault) void run(() => window.api.audioOutput.setDevice(device.id), true) }}>
          <span className="min-w-0 break-words">{device.name}</span>{device.isDefault && <strong className="ml-auto shrink-0 text-sm">{t.audioOutput.defaultDevice}</strong>}
        </button>)}
      </>}
    </div>
    {error && <p role="alert">{error}</p>}
  </div>
}
