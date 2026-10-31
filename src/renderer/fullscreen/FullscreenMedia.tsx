import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { Game } from "@shared/types"
import { ThemeMusicPlayer, type ThemeMusicPlayback } from "@/lib/themeMusicPlayer"
import { useFullscreenConfig } from "@/hooks/useFullscreen"

/**
 * A música tema e o fundo do jogo da tela cheia; o trailer toca sem som quando `playVideo`, depois de `videoDelay` ms.
 * Com `container`, o fundo vai para dentro desse elemento (o quadro do trailer do Mosaico) e, com `null`, não aparece;
 * a música continua no mesmo lugar, sem recomeçar.
 */
export function FullscreenMedia({ game, playVideo, videoDelay = 600, suspended, container }: { game: Game | undefined; playVideo: boolean; videoDelay?: number; suspended: boolean; container?: Element | null }) {
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
  const background = game && container !== null ? <FullscreenBackground key={`${game.id}:${game.backgroundUrl}:${game.backgroundVideoUrl}`} game={game} playVideo={playVideo} suspended={suspended} delay={videoDelay} /> : null
  return <><audio ref={audio} data-fullscreen-music loop preload="none" onError={() => player.current?.reportError()} />{container && background ? createPortal(background, container) : background}</>
}

function FullscreenBackground({ game, playVideo, suspended, delay }: { game: Game; playVideo: boolean; suspended: boolean; delay: number }) {
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
    // Sem trailer neste lugar (ex.: "só nos detalhes", de volta à biblioteca), volta a imagem, e não um quadro
    // parado do vídeo. Suspender (janela sem foco, jogo aberto) só pausa.
    if (!playVideo) { setShowVideo(false); setReady(false); return }
    if (suspended || reduced || !game.backgroundVideoUrl || failed) return
    const timer = setTimeout(() => setShowVideo(true), delay)
    return () => clearTimeout(timer)
  }, [playVideo, suspended, reduced, game.backgroundVideoUrl, failed, delay])
  useEffect(() => {
    const node = video.current
    if (!node) return
    let active = true
    if (playVideo && !suspended && !reduced && showVideo) void node.play().catch((reason: unknown) => { if (active && !(reason instanceof DOMException && reason.name === "AbortError")) setFailed(true) })
    else node.pause()
    return () => { active = false; node.pause() }
  }, [playVideo, suspended, reduced, showVideo])
  useEffect(() => () => { const node = video.current; if (node) { node.pause(); node.removeAttribute("src"); node.load() } }, [])
  return <div className="fs-background" aria-hidden="true">
    {game.backgroundUrl && !imageFailed && <img src={game.backgroundUrl} alt="" onError={() => setImageFailed(true)} />}
    {showVideo && !failed && game.backgroundVideoUrl && <video ref={video} data-fullscreen-video src={game.backgroundVideoUrl} muted loop playsInline preload="metadata" onLoadedData={() => setReady(true)} onError={() => setFailed(true)} className={ready ? "fs-video-ready" : ""} />}
  </div>
}
