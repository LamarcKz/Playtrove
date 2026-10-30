import { useLayoutEffect, useRef, type ReactNode } from "react"

/** Área de desenho do tema: como no Playnite, o Aniki é desenhado em 1920×1080 e ajustado ao monitor. */
export const STAGE_WIDTH = 1920
export const STAGE_HEIGHT = 1080

export function AnikiStage({ children, inert = false }: { children: ReactNode; inert?: boolean }) {
  const stage = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = stage.current
    if (!node) return
    const fit = () => node.style.setProperty("--aniki-scale", String(Math.min(innerWidth / STAGE_WIDTH, innerHeight / STAGE_HEIGHT)))
    fit()
    addEventListener("resize", fit)
    return () => removeEventListener("resize", fit)
  }, [])
  return <div ref={stage} inert={inert} className="aniki-stage" data-testid="aniki-stage">{children}</div>
}
