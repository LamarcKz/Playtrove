import { useEffect, useRef, useState } from "react"
import { AnikiLifecycleSequence, type AnikiLifecycleKind } from "@/lib/anikiPresentation"

/** Probe silencioso no próprio elemento; o overlay só aparece quando o pacote contém vídeo reproduzível. */
export function AnikiLifecycleVideo({ kind, onComplete }: { kind: AnikiLifecycleKind; onComplete: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const complete = useRef(onComplete)
  complete.current = onComplete
  const pending = useRef<((available: boolean) => void) | null>(null)
  const [visible, setVisible] = useState(false)
  const [ended, setEnded] = useState(false)
  const [sequence] = useState(() => new AnikiLifecycleSequence(() => complete.current()))
  useEffect(() => {
    const node = video.current!
    setVisible(false)
    setEnded(false)
    void sequence.start(kind, (url) => new Promise<boolean>((resolve) => {
      pending.current = resolve
      node.src = url
      node.load()
    }), () => {
      setVisible(true)
      // MediaElement da referência usa seu volume padrão de 0,5 para estes clipes.
      node.volume = 0.5
      void node.play().catch(() => sequence.fail())
    })
    return () => {
      sequence.cancel()
      pending.current?.(false)
      pending.current = null
      node.pause()
      node.removeAttribute("src")
      node.load()
    }
  }, [kind, sequence])
  const failed = () => { pending.current?.(false); pending.current = null; sequence.fail() }
  return <div className="aniki-lifecycle-video" hidden={!visible} aria-hidden="true" data-testid={`aniki-${kind}-video`}>
    <video ref={video} playsInline preload="metadata" hidden={ended} onLoadedMetadata={() => { pending.current?.(true); pending.current = null }} onEnded={() => setEnded(true)} onError={failed} />
  </div>
}
