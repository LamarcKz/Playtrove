import { useEffect, useRef, useState } from "react"
import type { Game } from "@shared/types"
import { MusicReviewPanel } from "@/components/MusicReviewPanel"
import { useMusicConfig } from "@/hooks/useMusicConfig"
import { useRunningGamesState } from "@/hooks/useRunningGames"
import { ThemeMusicPlayer, type ThemeMusicPlayback } from "@/lib/themeMusicPlayer"
import { onMusicPreviewChange } from "@/lib/musicPreviewPlayer"

/** Um player da Biblioteca, independente do vídeo e preservado entre os quatro modos. */
export function LibraryThemeMusic({ game }: { game: Game | undefined }) {
  const { config } = useMusicConfig()
  const { running, loading: loadingRunning } = useRunningGamesState()
  const windowActive = useAudioWindowActive()
  const audio = useRef<HTMLAudioElement>(null)
  const player = useRef<ThemeMusicPlayer | null>(null)
  const playback = useRef<ThemeMusicPlayback>({ playing: false, blocked: false, failed: false })
  const url = game?.themeMusicMode === "disabled" ? null : game?.themeMusicUrl ?? null
  const suspended = !windowActive || loadingRunning || running.length > 0
  const enabled = config?.enabled ?? false
  const volume = config?.volume ?? 20
  const previewActive = useRef(false)
  const options = useRef({ url, enabled, suspended, volume })
  options.current = { url, enabled, suspended, volume }

  useEffect(() => {
    const instance = new ThemeMusicPlayer(audio.current!, (state) => { playback.current = state })
    player.current = instance
    // Uma interação normal libera o autoplay bloqueado sem acrescentar controles à Biblioteca.
    const retryPlayback = () => {
      if (playback.current.blocked) instance.toggle()
    }
    document.addEventListener("pointerdown", retryPlayback)
    document.addEventListener("keydown", retryPlayback)
    const stopPreview = onMusicPreviewChange((active) => {
      previewActive.current = active
      instance.update({ ...options.current, suspended: options.current.suspended || active })
    })
    return () => {
      stopPreview()
      document.removeEventListener("pointerdown", retryPlayback)
      document.removeEventListener("keydown", retryPlayback)
      player.current = null
      instance.dispose()
    }
  }, [])

  useEffect(() => {
    player.current?.update({ url, enabled, suspended: suspended || previewActive.current, volume })
  }, [url, enabled, suspended, volume])

  return (
    <>
      <audio ref={audio} data-theme-music loop preload="none" onError={() => player.current?.reportError()} />
      <MusicReviewPanel compact />
    </>
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
