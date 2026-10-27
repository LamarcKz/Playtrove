import { useEffect, useRef, useState } from "react"
import type { Game } from "@shared/types"
import { ThemeMusicPlayer, type ThemeMusicPlayback } from "@/lib/themeMusicPlayer"
import { useFullscreenConfig } from "@/hooks/useFullscreen"

export function FullscreenMedia({ game, suspended }: { game: Game | undefined; suspended: boolean }) {
  const audio = useRef<HTMLAudioElement>(null)
  const player = useRef<ThemeMusicPlayer | null>(null)
  const playback = useRef<ThemeMusicPlayback>({ playing: false, blocked: false, failed: false })
  const { config } = useFullscreenConfig()
  const url = game?.themeMusicMode === "disabled" ? null : game?.themeMusicUrl ?? null
  useEffect(() => {
    const instance = new ThemeMusicPlayer(audio.current!, (state) => { playback.current = state })
    player.current = instance
    const retry = () => { if (playback.current.blocked) instance.toggle() }
    document.addEventListener("keydown", retry)
    document.addEventListener("pointerdown", retry)
    return () => { document.removeEventListener("keydown", retry); document.removeEventListener("pointerdown", retry); player.current = null; instance.dispose() }
  }, [])
  useEffect(() => { player.current?.update({ url, enabled: config?.musicPlayback ?? false, volume: config?.musicVolume ?? 20, suspended }) }, [url, config?.musicPlayback, config?.musicVolume, suspended])
  return <><audio ref={audio} data-fullscreen-music loop preload="none" onError={() => player.current?.reportError()} />{game && <FullscreenBackground key={`${game.id}:${game.backgroundUrl}`} game={game} />}</>
}

/** A arte de fundo do jogo selecionado; o trailer fica no cartão do Signature (AnikiTrailerCard). */
function FullscreenBackground({ game }: { game: Game }) {
  const [imageFailed, setImageFailed] = useState(false)
  return <div className="fs-background" aria-hidden="true">
    {game.backgroundUrl && !imageFailed && <img src={game.backgroundUrl} alt="" onError={() => setImageFailed(true)} />}
  </div>
}
