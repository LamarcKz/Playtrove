import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from "react"
import type { AnikiPresentationConfig } from "@shared/anikiPresentation"
import type { Game } from "@shared/types"
import { useI18n } from "@/hooks/useI18n"
import { formatPlaytime } from "@/lib/format"
import { AnikiScreenSaverIdle, AnikiScreenSaverSelection, screenSaverDelayMs, screenSaverHasBackground } from "@/lib/anikiPresentation"
import { AnikiLogo } from "./AnikiLogo"

export interface AnikiScreenSaverHandle { activity: () => boolean; preview: () => boolean }
interface Props {
  config: AnikiPresentationConfig
  games: Game[]
  filteredGames: Game[]
  enabled: boolean
  active: boolean
  blocked: boolean
  running: boolean
  onActiveChange: (active: boolean) => void
  ref?: Ref<AnikiScreenSaverHandle>
}

/** Screensaver do Helper: fundos estáticos, seleção sem repetição, zoom alternado e despertar que consome a entrada. */
export function AnikiScreenSaver({ config, games, filteredGames, enabled, active: focused, blocked, running, onActiveChange, ref }: Props) {
  const { t } = useI18n()
  const [active, setActive] = useState(false)
  const changed = useRef(onActiveChange)
  changed.current = onActiveChange
  const [idle] = useState(() => new AnikiScreenSaverIdle((value) => { setActive(value); changed.current(value) }))
  const [selection] = useState(() => new AnikiScreenSaverSelection())
  const latest = useRef({ config, games, filteredGames })
  latest.current = { config, games, filteredGames }
  const [slide, setSlide] = useState<{ game: Game; zoomIn: boolean } | null>(null)
  const [pending, setPending] = useState<{ game: Game; token: number } | null>(null)
  const [opacity, setOpacity] = useState(0)
  const [fadeMs, setFadeMs] = useState(550)
  const rejected = useRef(new Set<number>())
  const failedAttempts = useRef(0)
  const loading = useRef(false)
  const token = useRef(0)
  const nextZoomIn = useRef(true)
  const next = useRef<(() => void) | null>(null)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frame = useRef<number | null>(null)
  const hasBackground = screenSaverHasBackground(games, config.screenSaverSource, filteredGames)
  useImperativeHandle(ref, () => ({ activity: () => idle.activity(), preview: () => idle.preview() }), [idle])
  useEffect(() => {
    idle.configure({
      eligible: enabled && focused && !blocked && !running && config.screenSaverEnabled && hasBackground,
      previewAllowed: enabled && focused && !running && hasBackground,
      delayMs: screenSaverDelayMs(config.screenSaverIdleDelayMinutes),
    })
  }, [idle, enabled, focused, blocked, running, config.screenSaverEnabled, config.screenSaverIdleDelayMinutes, hasBackground])
  useEffect(() => () => idle.dispose(), [idle])
  useEffect(() => { rejected.current.clear() }, [games])
  useEffect(() => {
    let mouse: { x: number; y: number } | null = null
    const consume = (event: Event) => { if (idle.activity()) { event.preventDefault(); event.stopImmediatePropagation() } }
    const move = (event: PointerEvent) => {
      if (!idle.isVisible) { idle.activity(); mouse = null; return }
      if (!mouse) { mouse = { x: event.clientX, y: event.clientY }; return }
      if (Math.abs(event.clientX - mouse.x) >= 2 || Math.abs(event.clientY - mouse.y) >= 2) { mouse = null; consume(event) }
    }
    const focus = () => { idle.activity(); mouse = null }
    window.addEventListener("keydown", consume, true)
    window.addEventListener("pointerdown", consume, true)
    window.addEventListener("wheel", consume, { capture: true, passive: false })
    window.addEventListener("pointermove", move, true)
    window.addEventListener("blur", focus)
    window.addEventListener("focus", focus)
    return () => {
      window.removeEventListener("keydown", consume, true)
      window.removeEventListener("pointerdown", consume, true)
      window.removeEventListener("wheel", consume, true)
      window.removeEventListener("pointermove", move, true)
      window.removeEventListener("blur", focus)
      window.removeEventListener("focus", focus)
    }
  }, [idle])
  useEffect(() => {
    if (!active) { setSlide(null); setPending(null); setOpacity(0); return }
    rejected.current.clear()
    failedAttempts.current = 0
    loading.current = false
    nextZoomIn.current = true
    const advance = () => {
      if (!idle.isVisible || loading.current) return
      const input = latest.current
      const game = selection.pick(input.games, input.config.screenSaverSource, input.filteredGames, new Date(), Math.random, rejected.current)
      if (!game) { idle.activity(); return }
      loading.current = true
      setPending({ game, token: ++token.current })
    }
    next.current = advance
    advance()
    const timer = setInterval(advance, Math.max(5, Math.min(300, config.screenSaverChangeIntervalSeconds)) * 1000)
    return () => {
      clearInterval(timer)
      if (fadeTimer.current !== null) clearTimeout(fadeTimer.current)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      token.current++
      next.current = null
      loading.current = false
    }
  }, [active, idle, selection, config.screenSaverSource, config.screenSaverChangeIntervalSeconds])

  const loaded = (candidate: NonNullable<typeof pending>) => {
    if (!idle.isVisible || candidate.token !== token.current) return
    failedAttempts.current = 0
    const settings = latest.current.config
    const apply = () => {
      if (!idle.isVisible || candidate.token !== token.current) return
      setSlide({ game: candidate.game, zoomIn: nextZoomIn.current })
      if (settings.screenSaverAnimateBackground) nextZoomIn.current = !nextZoomIn.current
      setPending(null)
      setFadeMs(settings.screenSaverUseFadeTransitions ? slide ? 500 : 550 : 0)
      frame.current = requestAnimationFrame(() => { frame.current = null; if (!idle.isVisible || candidate.token !== token.current) return; setOpacity(1); loading.current = false })
    }
    if (slide && settings.screenSaverUseFadeTransitions) { setFadeMs(320); setOpacity(0); fadeTimer.current = setTimeout(apply, 320) }
    else apply()
  }
  const failed = (candidate: NonNullable<typeof pending>) => {
    if (candidate.token !== token.current || !idle.isVisible) return
    rejected.current.add(candidate.game.id)
    loading.current = false
    if (++failedAttempts.current >= 80) idle.activity()
    else next.current?.()
  }
  if (!active) return null
  const game = slide?.game
  const zoomIn = slide?.zoomIn ?? true
  const duration = Math.max(6, config.screenSaverChangeIntervalSeconds + 2)
  return <div className="aniki-screen-saver" data-testid="aniki-screen-saver">
    {pending && <img key={pending.token} hidden src={pending.game.backgroundUrl!} alt="" onLoad={() => loaded(pending)} onError={() => failed(pending)} />}
    {game && <div className="aniki-screen-saver-layer" style={{ opacity, transitionDuration: `${fadeMs}ms` }}>
      <img key={`${game.id}:${zoomIn}`} className="aniki-screen-saver-background" src={game.backgroundUrl!} alt="" data-zoom={config.screenSaverAnimateBackground ? zoomIn ? "in" : "out" : "off"} style={{ animationDuration: `${duration}s` } as CSSProperties} />
      <div className="aniki-screen-saver-shade" />
      {config.screenSaverShowLogo && <div className="aniki-screen-saver-logo"><AnikiLogo game={game} /></div>}
      {config.screenSaverShowInfoCard && <section className="aniki-screen-saver-info">
        {!config.screenSaverShowLogo && <h2>{game.title}</h2>}
        <dl><dt>{t.fields.playtime}</dt><dd>{formatPlaytime(game.playtimeMinutes, t)}</dd>
          <dt>{t.fields.achievements}</dt><dd>{game.achievements ? `${game.achievements.unlocked} / ${game.achievements.total}` : t.filters.noData}</dd>
          <dt>{t.fields.lastPlayed}</dt><dd>{game.lastPlayedAt ? new Date(game.lastPlayedAt).toLocaleDateString(t.locale) : t.format.neverPlayed}</dd></dl>
        <p>{game.romPath && game.emulatorId ? t.fullscreen.screenSaverInstalled : t.fullscreen.screenSaverNotInstalled}</p>
      </section>}
    </div>}
  </div>
}
