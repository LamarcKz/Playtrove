import { useEffect, useRef, useState, type CSSProperties } from "react"
import type { GameLaunchSplashApi, GameLaunchSplashLogoPosition, GameLaunchSplashState } from "@shared/gameLaunchSplash"
import { I18nProvider } from "@/components/I18nProvider"
import { useI18n } from "@/hooks/useI18n"

const logoPositions: Record<GameLaunchSplashLogoPosition, CSSProperties> = {
  leftTop: { left: 100, top: 90 },
  leftCenter: { left: 100, top: "50%", transform: "translateY(-50%)" },
  leftBottom: { left: 100, bottom: 90 },
  centerTop: { left: "50%", top: 90, transform: "translateX(-50%)" },
  center: { left: "50%", top: "50%", transform: "translate(-50%, -50%)" },
  centerBottom: { left: "50%", bottom: 90, transform: "translateX(-50%)" },
  rightTop: { right: 100, top: 90 },
  rightCenter: { right: 100, top: "50%", transform: "translateY(-50%)" },
  rightBottom: { right: 100, bottom: 90 },
}

const sceneStyles = `
@keyframes aniki-launch-splash-enter { from { opacity: 0; transform: scale(1.025) translateY(6px) } to { opacity: 1; transform: scale(1) translateY(0) } }
@keyframes aniki-launch-splash-zoom { from { transform: scale(1) } to { transform: scale(1.06) } }
.aniki-launch-splash-scene { position: absolute; inset: 0; overflow: hidden; background: #000; animation: aniki-launch-splash-enter 460ms ease-out both; }
.aniki-launch-splash-image { width: 100%; height: 100%; object-fit: cover; animation: aniki-launch-splash-zoom 90s linear both; }
.aniki-launch-splash-logo { position: absolute; max-width: 560px; max-height: 220px; width: auto; height: auto; object-fit: contain; filter: drop-shadow(0 0 24px #000); }
@media (prefers-reduced-motion: reduce) { .aniki-launch-splash-scene, .aniki-launch-splash-image { animation: none; } }
`

/** Janela independente, sem navegação ou atalhos. O processo e o relógio pertencem ao serviço Rust. */
export function AnikiGameLaunchSplash({ api, generation }: { api?: GameLaunchSplashApi; generation?: number } = {}) {
  return <I18nProvider><LaunchSplash api={api ?? window.api.gameLaunchSplash} generation={generation} /></I18nProvider>
}

function LaunchSplash({ api, generation }: { api: GameLaunchSplashApi; generation?: number }) {
  const { t } = useI18n()
  const [token] = useState(() => generation ?? Number(new URLSearchParams(window.location.search).get("generation")))
  const [state, setState] = useState<GameLaunchSplashState | null>(null)
  const reported = useRef<number | null>(null)

  useEffect(() => {
    // A camada nativa começa preta; o quadro opaco do splash assume essa função antes do fade.
    const body = document.body.style.background
    const html = document.documentElement.style.background
    document.body.style.background = "transparent"
    document.documentElement.style.background = "transparent"
    return () => { document.body.style.background = body; document.documentElement.style.background = html }
  }, [])

  useEffect(() => {
    let active = true
    let received = false
    const receive = (next: GameLaunchSplashState) => {
      if (active && next.generation === token) setState(next)
    }
    const stop = api.onStateChange((next) => {
      if (next.generation === token) received = true
      receive(next)
    })
    void api.getState().then((next) => { if (!received) receive(next) }).catch(() => {
      // O fundo continua preto; o failsafe nativo fecha mesmo se o renderer não carregar.
    })
    return () => { active = false; stop() }
  }, [api, token])

  useEffect(() => {
    if (!state?.open || state.generation !== token || reported.current === token) return
    let second: number | null = null
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        reported.current = token
        void api.rendered(token).catch(() => undefined)
      })
    })
    return () => {
      cancelAnimationFrame(first)
      if (second !== null) cancelAnimationFrame(second)
    }
  }, [api, state?.open, state?.generation, token])

  return <div className="fullscreen-shell aniki-launch-splash" data-testid="aniki-game-launch-splash" role="status" aria-label={`${t.common.loading} ${state?.title ?? ""}`} style={{ background: "#000", opacity: state?.phase === "closing" ? 0 : 1, transition: "opacity 420ms ease-in-out", pointerEvents: "none" }}>
    <style>{sceneStyles}</style>
    {state?.open && <SplashCanvas key={state.generation} state={state} />}
  </div>
}

function SplashCanvas({ state }: { state: GameLaunchSplashState }) {
  const [imageFailed, setImageFailed] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  return <div className="aniki-launch-splash-scene" aria-hidden="true">
    {state.imageUrl && !imageFailed && <img className="aniki-launch-splash-image" src={state.imageUrl} alt="" draggable={false} onError={() => setImageFailed(true)} />}
    <div style={{ position: "absolute", inset: 0, background: "#000", opacity: state.backgroundDimming }} />
    {state.showLogo && state.logoUrl && !logoFailed && <img className="aniki-launch-splash-logo" src={state.logoUrl} alt="" draggable={false} style={logoPositions[state.logoPosition]} onError={() => setLogoFailed(true)} />}
  </div>
}
