import { useEffect, useRef, useState } from "react"
import type { Game } from "@shared/types"
import { ThemeMusicPlayer, type ThemeMusicPlayback } from "@/lib/themeMusicPlayer"
import { fullscreenMusicControls, type FullscreenMusicConnection } from "@/lib/fullscreenMusicControls"
import type { AnikiMediaContext } from "@/lib/anikiMedia"
import { useFullscreenConfig } from "@/hooks/useFullscreen"

interface Props {
  game: Game | undefined
  playVideo: boolean
  videoDelay?: number
  suspended: boolean
  /** undefined usa a faixa do jogo; null conserva o silêncio. */
  musicUrl?: string | null
  musicTransitionMs?: number
  musicPositionKey?: string | null
  musicResetOnSuspend?: boolean
  musicContext?: AnikiMediaContext
}

/** A música tema e o fundo do jogo da tela cheia; o trailer toca sem som quando `playVideo`, depois de `videoDelay` ms. */
export function FullscreenMedia({ game, playVideo, videoDelay = 600, suspended, musicUrl, musicTransitionMs, musicPositionKey, musicResetOnSuspend, musicContext = "library" }: Props) {
  const audio = useRef<HTMLAudioElement>(null)
  const player = useRef<ThemeMusicPlayer | null>(null)
  const playback = useRef<ThemeMusicPlayback>({ playing: false, blocked: false, failed: false })
  const transport = useRef<FullscreenMusicConnection | null>(null)
  const { config } = useFullscreenConfig()
  const url = musicUrl === undefined ? game?.themeMusicMode === "disabled" ? null : game?.themeMusicUrl ?? null : musicUrl
  useEffect(() => {
    const instance = new ThemeMusicPlayer(audio.current!, (state) => { playback.current = state; transport.current?.playback(state) })
    player.current = instance
    const connection = fullscreenMusicControls.connect(instance, audio.current!)
    transport.current = connection
    const timer = window.setInterval(() => connection.refresh(), 250)
    const retry = (event: Event) => {
      // O clique de transporte já preserva a ativação do navegador e não pode alternar duas vezes.
      if (event.target instanceof Element && event.target.closest("[data-music-transport]")) return
      if (playback.current.blocked) instance.toggle()
    }
    document.addEventListener("keydown", retry)
    document.addEventListener("pointerdown", retry)
    return () => { document.removeEventListener("keydown", retry); document.removeEventListener("pointerdown", retry); window.clearInterval(timer); connection.dispose(); transport.current = null; player.current = null; instance.dispose() }
  }, [])
  useEffect(() => {
    const options = { url, enabled: config?.musicPlayback ?? false, volume: config?.musicVolume ?? 20, suspended }
    transport.current?.update({ ...options, context: musicContext, gameTitle: game?.title ?? null })
    player.current?.update({ ...options, transitionMs: musicTransitionMs, positionKey: musicPositionKey, resetOnSuspend: musicResetOnSuspend })
    transport.current?.refresh()
  }, [url, config?.musicPlayback, config?.musicVolume, suspended, musicTransitionMs, musicPositionKey, musicResetOnSuspend, musicContext, game?.title])
  return <><audio ref={audio} data-fullscreen-music loop preload="none" onError={() => player.current?.reportError()} />{game && <FullscreenBackground key={`${game.id}:${game.backgroundUrl}:${game.backgroundVideoUrl}`} game={game} playVideo={playVideo} suspended={suspended} delay={videoDelay} />}</>
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
