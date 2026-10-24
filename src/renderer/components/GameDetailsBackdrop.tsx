import { useEffect, useRef, useState } from "react"
import type { Game } from "@shared/types"
import { GameBackdrop } from "@/components/GameBackdrop"
import { cn } from "@/lib/utils"

/** Fundo exclusivo dos Detalhes: a imagem permanece enquanto o vídeo local carrega ou falha. */
export function GameDetailsBackdrop({ game }: { game: Game }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const src = game.backgroundVideoUrl

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)")
    const change = () => setReducedMotion(preference.matches)
    change()
    preference.addEventListener("change", change)
    return () => preference.removeEventListener("change", change)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return
    // O StrictMode do DEV repete setup/cleanup sem recriar o elemento.
    // Cada setup restaura a fonte que o cleanup anterior liberou.
    if (video.getAttribute("src") !== src) video.setAttribute("src", src)
    return () => {
      video.pause()
      video.removeAttribute("src")
      video.load()
    }
  }, [src, failed])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let active = true
    const update = () => {
      if (reducedMotion || document.hidden) video.pause()
      else void video.play().catch((error: unknown) => {
        // Pausar ou liberar a mídia pode cancelar um play ainda pendente.
        if (active && !(error instanceof DOMException && error.name === "AbortError")) setFailed(true)
      })
    }
    update()
    document.addEventListener("visibilitychange", update)
    return () => {
      active = false
      document.removeEventListener("visibilitychange", update)
      video.pause()
    }
  }, [src, reducedMotion, failed])

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
    </>
  )
}
