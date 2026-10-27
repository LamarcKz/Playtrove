import { useEffect, useRef, useState } from "react"

/**
 * Trailer em miniatura do Signature (o "mini trailer" do Aniki): começa sem som depois de 600 ms de
 * seleção estável, respeita o movimento reduzido e some se o vídeo falhar.
 */
export function AnikiTrailerCard({ url, play }: { url: string; play: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const [show, setShow] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(media.matches)
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  useEffect(() => {
    if (!play || reduced || failed) return
    const timer = setTimeout(() => setShow(true), 600)
    return () => clearTimeout(timer)
  }, [play, reduced, failed])
  useEffect(() => {
    const node = video.current
    if (!node) return
    let active = true
    if (play && !reduced && show) void node.play().catch((reason: unknown) => { if (active && !(reason instanceof DOMException && reason.name === "AbortError")) setFailed(true) })
    else node.pause()
    return () => { active = false; node.pause() }
  }, [play, reduced, show])
  useEffect(() => () => { const node = video.current; if (node) { node.pause(); node.removeAttribute("src"); node.load() } }, [])
  if (!show || failed) return null
  return <div className={ready ? "aniki-trailer aniki-trailer-ready" : "aniki-trailer"} aria-hidden="true">
    <video ref={video} data-fullscreen-video src={url} muted loop playsInline preload="metadata" onLoadedData={() => setReady(true)} onError={() => setFailed(true)} />
  </div>
}
