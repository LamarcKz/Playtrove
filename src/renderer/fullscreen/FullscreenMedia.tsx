import { useEffect, useRef, useState } from "react"
import type { Game } from "@shared/types"
import { ThemeMusicPlayer, type ThemeMusicPlayback } from "@/lib/themeMusicPlayer"
import { useFullscreenConfig } from "@/hooks/useFullscreen"

export function FullscreenMedia({ game, details, suspended }: { game: Game | undefined; details: boolean; suspended: boolean }) {
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
  return <><audio ref={audio} data-fullscreen-music loop preload="none" onError={() => player.current?.reportError()} />{game && <FullscreenBackground key={`${game.id}:${game.backgroundUrl}:${game.backgroundVideoUrl}`} game={game} playVideo={details && !suspended} />}</>
}

function FullscreenBackground({ game, playVideo }: { game: Game; playVideo: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const [showVideo, setShowVideo] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(media.matches)
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  useEffect(() => {
    if (!playVideo || reduced || !game.backgroundVideoUrl || failed) return
    const timer = setTimeout(() => setShowVideo(true), 600)
    return () => clearTimeout(timer)
  }, [playVideo, reduced, game.backgroundVideoUrl, failed])
  useEffect(() => {
    const node = video.current
    if (!node) return
    let active = true
    if (playVideo && !reduced && showVideo) void node.play().catch((reason: unknown) => { if (active && !(reason instanceof DOMException && reason.name === "AbortError")) setFailed(true) })
    else node.pause()
    return () => { active = false; node.pause() }
  }, [playVideo, reduced, showVideo])
  useEffect(() => () => { const node = video.current; if (node) { node.pause(); node.removeAttribute("src"); node.load() } }, [])
  return <div className="fs-background" aria-hidden="true">
    {game.backgroundUrl && !imageFailed && <img src={game.backgroundUrl} alt="" onError={() => setImageFailed(true)} />}
    {showVideo && !failed && game.backgroundVideoUrl && <video ref={video} data-fullscreen-video src={game.backgroundVideoUrl} muted loop playsInline preload="metadata" onLoadedData={() => setReady(true)} onError={() => setFailed(true)} className={ready ? "fs-video-ready" : ""} />}
  </div>
}
