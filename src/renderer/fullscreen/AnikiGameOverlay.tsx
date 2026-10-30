import { useEffect, useRef, useState } from "react"
import type { Game } from "@shared/types"
import type { GameOverlayState } from "@shared/gameOverlay"
import { I18nProvider } from "@/components/I18nProvider"
import { useI18n } from "@/hooks/useI18n"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { useFullscreenActive, useFullscreenInput } from "@/hooks/useFullscreenInput"
import { AnikiAppearanceProvider } from "./AnikiAppearanceContext"
import { AnikiAudioPanel } from "./AnikiAudioPanel"
import { AnikiGallery, type AnikiGalleryHandle } from "./AnikiGallery"
import { AnikiGlyph, AnikiIcon } from "./AnikiGlyph"
import { AnikiLogo } from "./AnikiLogo"
import { AnikiStage } from "./AnikiStage"
import { AnikiTrophies } from "./AnikiTrophies"

/** Renderer independente: o foco e os relatórios pertencem à janela nativa do centro de controle. */
export function AnikiGameOverlay() {
  return <I18nProvider><ControlCenter /></I18nProvider>
}

function ControlCenter() {
  const { t } = useI18n()
  const { config } = useFullscreenConfig()
  const focused = useFullscreenActive("gameOverlay")
  const [state, setState] = useState<GameOverlayState | null>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [panel, setPanel] = useState<"home" | "audio" | "gallery" | "trophies" | "close">("home")
  const [pending, setPending] = useState(false)
  const [requested, setRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scope = useRef<HTMLElement>(null)
  const gallery = useRef<AnikiGalleryHandle>(null)
  const busy = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    let received = false
    const receive = (next: GameOverlayState) => { if (mounted.current) setState(next) }
    const stop = window.api.gameOverlay.onStateChange((next) => { received = true; receive(next) })
    void window.api.gameOverlay.getState().then((next) => { if (!received) receive(next) }).catch((reason) => { if (mounted.current) setError(String(reason)) })
    return () => { mounted.current = false; stop() }
  }, [])

  useEffect(() => {
    let active = true
    const refresh = () => void window.api.library.get().then((snapshot) => {
      if (active) setGame(snapshot.games.find((item) => item.id === state?.gameId) ?? null)
    }).catch((reason) => { if (active) setError(String(reason)) })
    refresh()
    const stop = window.api.library.onChange(refresh)
    return () => { active = false; stop() }
  }, [state?.gameId])

  useEffect(() => {
    if (!focused) return
    const target = scope.current?.querySelector<HTMLElement>("[data-fs-default]") ?? scope.current?.querySelector<HTMLElement>("button:not(:disabled)")
    target?.focus()
  }, [panel, focused])

  const run = async (operation: () => Promise<unknown>) => {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    try { await operation() }
    catch (reason) { if (mounted.current) setError(String(reason)) }
    finally { busy.current = false; if (mounted.current) setPending(false) }
  }
  const back = () => {
    if (pending) return
    if (panel === "gallery" && gallery.current?.back()) return
    if (panel !== "home") { setPanel("home"); return }
    void run(() => window.api.gameOverlay.returnToGame())
  }
  useFullscreenInput(scope, focused && !pending, panel, (action) => {
    if (action === "circle") { back(); return true }
    if (action === "window") return true
    if (panel === "gallery" && (action === "left" || action === "right")) return gallery.current?.navigate(action)
    return false
  }, false, "gameOverlay")

  return <div className="fullscreen-shell aniki-game-overlay" data-testid="aniki-game-overlay" data-aniki-color={config?.colorPreset ?? "default"} data-aniki-effects={config?.effects ?? "balanced"}>
    <AnikiAppearanceProvider value={config ?? { controllerIconStyle: "playstation", anikiAvatarIndex: null }}>
      <AnikiStage>
        {game?.backgroundUrl && <img className="aniki-overlay-background" src={game.backgroundUrl} alt="" />}
        <section ref={scope} className="aniki-overlay-content" aria-busy={pending}>
          <header className="aniki-overlay-header">
            <div><p>{t.fullscreen.controlCenter}</p><h1>{game ? <AnikiLogo game={game} /> : t.fullscreen.gameSessionLoading}</h1></div>
            {panel !== "home" && <button type="button" onClick={back} disabled={pending}><AnikiGlyph button="circle" />{t.fullscreen.back}</button>}
          </header>
          {panel === "home" && <div className="aniki-overlay-menu aniki-menu-items">
            <button type="button" data-fs-default aria-disabled={pending} onClick={() => void run(() => window.api.gameOverlay.returnToGame())}><AnikiIcon icon="home" />{t.fullscreen.returnToGame}</button>
            <button type="button" aria-disabled={pending} onClick={() => void run(() => window.api.gameOverlay.returnToApp())}><AnikiIcon icon="desktop" />{t.fullscreen.returnToApp}</button>
            <button type="button" onClick={() => setPanel("audio")} disabled={pending}><AnikiIcon icon="audio" />{t.audioOutput.title}</button>
            {game && <>
              <button type="button" onClick={() => setPanel("gallery")} disabled={pending}><AnikiIcon icon="gallery" />{t.gameMedia.title}</button>
              <button type="button" onClick={() => setPanel("trophies")} disabled={pending}><AnikiIcon icon="trophy" />{t.fullscreen.trophiesTitle}</button>
            </>}
            <button type="button" onClick={() => setPanel("close")} disabled={pending || requested}><AnikiIcon icon="exit" />{t.fullscreen.closeGame}</button>
          </div>}
          {panel === "audio" && <div className="aniki-overlay-panel"><AnikiAudioPanel /></div>}
          {panel === "gallery" && game && <AnikiGallery ref={gallery} game={game} />}
          {panel === "trophies" && game && <AnikiTrophies game={game} />}
          {panel === "close" && <div className="aniki-overlay-confirm" role="alertdialog" aria-label={t.fullscreen.closeGame} aria-describedby="close-game-question">
            <p id="close-game-question">{t.fullscreen.closeGameConfirm(game?.title ?? "")}</p>
            <div><button type="button" data-fs-default disabled={pending} onClick={() => setPanel("home")}>{t.common.cancel}</button>
              <button type="button" disabled={pending} onClick={() => void run(async () => { await window.api.gameOverlay.requestCloseGame(); if (mounted.current) { setRequested(true); setPanel("home") } })}>{t.fullscreen.confirmAction}</button></div>
          </div>}
          {requested && <p role="status">{t.fullscreen.closeGameRequested}</p>}
          {error && <p className="aniki-overlay-error" role="alert">{error}</p>}
        </section>
      </AnikiStage>
    </AnikiAppearanceProvider>
  </div>
}
