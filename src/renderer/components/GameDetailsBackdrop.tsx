import { useEffect, useRef, useState } from "react"
import { Pause, Play } from "lucide-react"
import type { Game } from "@shared/types"
import { GameBackdrop } from "@/components/GameBackdrop"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/useI18n"
import { cn } from "@/lib/utils"

/** Fundo exclusivo dos Detalhes: a imagem permanece enquanto o vídeo local carrega ou falha. */
export function GameDetailsBackdrop({ game }: { game: Game }) {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [paused, setPaused] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const src = game.backgroundVideoUrl

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)")
    const change = () => setPaused(preference.matches)
    preference.addEventListener("change", change)
    return () => preference.removeEventListener("change", change)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let active = true
    const update = () => {
      if (paused || document.hidden) video.pause()
      else void video.play().catch(() => { if (active) setPaused(true) })
    }
    update()
    document.addEventListener("visibilitychange", update)
    return () => {
      active = false
      document.removeEventListener("visibilitychange", update)
      video.pause()
    }
  }, [src, paused, failed])

  useEffect(() => {
    const video = videoRef.current
    return () => {
      if (!video) return
      video.pause()
      video.removeAttribute("src")
      video.load()
    }
  }, [src, failed])

  return (
    <>
      <GameBackdrop src={game.backgroundUrl} fadeTo="background" placeholderIcon className="h-[max(34rem,72vh)]">
        {src && !failed && (
          <video
            ref={videoRef}
            data-slot="game-background-video"
            src={src}
            muted
            loop
            playsInline
            preload="metadata"
            onLoadedData={() => setReady(true)}
            onError={() => setFailed(true)}
            className={cn("absolute inset-0 size-full object-cover", !ready && "opacity-0")}
          />
        )}
      </GameBackdrop>
      {src && !failed && (
        <Button
          variant="secondary"
          size="sm"
          className="absolute top-6 right-6 z-10"
          onClick={() => setPaused((value) => !value)}
          aria-label={paused ? t.details.playBackgroundVideo : t.details.pauseBackgroundVideo}
        >
          {paused ? <Play /> : <Pause />}
          {paused ? t.details.playBackgroundVideo : t.details.pauseBackgroundVideo}
        </Button>
      )}
    </>
  )
}
