import { useEffect, useRef, useState } from "react"
import { Music2, Pause, Play, Volume2 } from "lucide-react"
import type { Game } from "@shared/types"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/useI18n"
import { useMusicConfig } from "@/hooks/useMusicConfig"
import { useRunningGamesState } from "@/hooks/useRunningGames"
import { ThemeMusicPlayer, type ThemeMusicPlayback } from "@/lib/themeMusicPlayer"

/** Um player da Biblioteca, independente do vídeo e preservado entre os quatro modos. */
export function ThemeMusicControls({ game }: { game: Game | undefined }) {
  const { t } = useI18n()
  const { config, changeConfig } = useMusicConfig()
  const { running, loading: loadingRunning } = useRunningGamesState()
  const windowActive = useAudioWindowActive()
  const audio = useRef<HTMLAudioElement>(null)
  const player = useRef<ThemeMusicPlayer | null>(null)
  const [playback, setPlayback] = useState<ThemeMusicPlayback>({ playing: false, blocked: false, failed: false })
  const url = game?.themeMusicMode === "disabled" ? null : game?.themeMusicUrl ?? null
  const suspended = !windowActive || loadingRunning || running.length > 0
  const enabled = config?.enabled ?? false
  const volume = config?.volume ?? 20

  useEffect(() => {
    const instance = new ThemeMusicPlayer(audio.current!, setPlayback)
    player.current = instance
    return () => {
      player.current = null
      instance.dispose()
    }
  }, [])

  useEffect(() => {
    player.current?.update({ url, enabled, suspended, volume })
  }, [url, enabled, suspended, volume])

  return (
    <div role="group" aria-label={t.music.title} className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5">
      <audio ref={audio} data-theme-music loop preload="none" onError={() => player.current?.reportError()} />
      <Music2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{t.music.title}</span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={playback.playing ? t.music.pause : t.music.play}
        title={playback.playing ? t.music.pause : t.music.play}
        disabled={!url || !enabled || suspended}
        onClick={() => player.current?.toggle()}
      >
        {playback.playing ? <Pause /> : <Play />}
      </Button>
      <Volume2 aria-hidden="true" className="size-4 text-muted-foreground" />
      <input
        type="range"
        min={0}
        max={100}
        value={volume}
        aria-label={t.music.volume}
        disabled={!config}
        onChange={(event) => changeConfig({ volume: Number(event.target.value) })}
        className="h-5 w-24 cursor-pointer accent-primary"
      />
      <span className="w-8 text-xs tabular-nums text-muted-foreground">{volume}%</span>
      <span role="status" className="text-xs text-muted-foreground">
        {!url ? t.music.noTrack : !enabled ? "" : playback.blocked ? t.music.autoplayBlocked : playback.failed ? t.music.unavailable : ""}
      </span>
    </div>
  )
}

/** Visibilidade e foco são independentes; retomar exige que os dois estejam liberados. */
function useAudioWindowActive() {
  const [active, setActive] = useState(() => !document.hidden && document.hasFocus())
  useEffect(() => {
    let focused = document.hasFocus()
    const update = () => setActive(focused && !document.hidden)
    const focus = () => { focused = true; update() }
    const blur = () => { focused = false; update() }
    window.addEventListener("focus", focus)
    window.addEventListener("blur", blur)
    document.addEventListener("visibilitychange", update)
    update()
    return () => {
      window.removeEventListener("focus", focus)
      window.removeEventListener("blur", blur)
      document.removeEventListener("visibilitychange", update)
    }
  }, [])
  return active
}
