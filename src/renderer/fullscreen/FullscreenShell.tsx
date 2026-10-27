import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowLeft, Star, Gamepad2 } from "lucide-react"
import type { Game } from "@shared/types"
import { useI18n } from "@/hooks/useI18n"
import { useStatuses } from "@/hooks/useStatuses"
import { useRunningGamesState } from "@/hooks/useRunningGames"
import { useFullscreenActive, useFullscreenInput } from "@/hooks/useFullscreenInput"
import { fullscreenGames, restoreFullscreenSelection, type FullscreenAction, type FullscreenCollection } from "@/lib/fullscreenNavigation"
import { FullscreenLaunchGuard } from "@/lib/fullscreenSession"
import { FullscreenPreferences } from "./FullscreenPreferences"
import { FullscreenKeyboard } from "./FullscreenKeyboard"
import { FullscreenMedia } from "./FullscreenMedia"
import { AnikiStage } from "./AnikiStage"
import { AnikiTopBar } from "./AnikiTopBar"
import { AnikiLibrary } from "./AnikiLibrary"
import { AnikiMainMenu } from "./AnikiMainMenu"
import { AnikiSignature } from "./AnikiSignature"
import { AnikiTrophies } from "./AnikiTrophies"
import { AnikiDescription } from "./AnikiDescription"
import type { AnikiShortcut } from "./AnikiShortcutBar"

type Panel = "preferences" | "options" | "search" | "review" | "achievements" | "description" | "menu" | null
interface Props { enabled: boolean; games: Game[]; initialGameId: number | null; onExit: () => void; onOpenEmulators: () => void }
const collections: FullscreenCollection[] = ["all", "recent", "favorites"]

export function FullscreenShell({ enabled, games, initialGameId, onExit, onOpenEmulators }: Props) {
  const { t } = useI18n()
  const statuses = useStatuses()
  const [collection, setCollection] = useState<FullscreenCollection>("all")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(initialGameId)
  const [details, setDetails] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [error, setError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [editing, setEditing] = useState(false)
  const [disconnected, setDisconnected] = useState(false)
  const scope = useRef<HTMLElement>(null)
  const launchGuard = useRef(new FullscreenLaunchGuard())
  const launchedId = useRef<number | null>(null)
  const searchReturn = useRef<{ id: number | null; details: boolean }>({ id: null, details: false })
  const reviewReturn = useRef<Panel>(null)
  const reviewRevision = useRef(0)
  const collectionSelections = useRef<Partial<Record<FullscreenCollection, number | null>>>({ all: initialGameId })
  const visible = fullscreenGames(games, collection, query)
  const resolvedId = restoreFullscreenSelection(visible, selectedId)
  const game = games.find((item) => item.id === (details ? selectedId : resolvedId))
  const active = useFullscreenActive()
  const { running, loading: loadingRunning } = useRunningGamesState()
  const suspended = !enabled || !active || loadingRunning || running.length > 0 || launching
  const context = `${details ? "details" : "library"}:${panel ?? "main"}:${details ? game?.id : collection}`
  const label = (value: FullscreenCollection) => value === "all" ? t.fullscreen.all : value === "recent" ? t.fullscreen.recent : t.fullscreen.favorites

  useEffect(() => {
    let live = true
    const stop = window.api.controllers.onChange((controllers) => setDisconnected(controllers.length === 0))
    void window.api.controllers.list().then((controllers) => { if (live) setDisconnected(controllers.length === 0) }).catch(() => {})
    return () => { live = false; stop() }
  }, [])
  useEffect(() => {
    if (launchedId.current !== null && !launching && running.length === 0 && !loadingRunning) {
      setSelectedId(launchedId.current)
      launchedId.current = null
    }
  }, [running, launching, loadingRunning])
  useLayoutEffect(() => {
    if (!active || suspended) return
    const node = scope.current
    const target = node?.querySelector<HTMLElement>("[data-fs-default]:not(:disabled)") ?? node?.querySelector<HTMLElement>("[data-fs-fallback]:not(:disabled)") ?? node?.querySelector<HTMLElement>("button:not(:disabled)")
    target?.focus()
    target?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" })
  }, [context, active, suspended])

  const closePanel = () => { reviewRevision.current++; setPanel(null); setError(null) }
  const clearSearch = () => { setQuery(""); setSelectedId(searchReturn.current.id); setDetails(searchReturn.current.details) }
  const openReview = () => { reviewRevision.current++; reviewReturn.current = panel; setPanel("review") }
  const cancelReview = () => { reviewRevision.current++; setPanel(reviewReturn.current); setError(null) }
  const openDetails = (id: number) => { setSelectedId(id); setDetails(true); setError(null) }
  const changeCollection = (next: FullscreenCollection) => {
    collectionSelections.current[collection] = selectedId ?? resolvedId
    setQuery("")
    setCollection(next)
    setSelectedId(collectionSelections.current[next] ?? null)
    setDetails(false)
    closePanel()
  }
  // Na biblioteca, voltar não sai da tela cheia: no Aniki a saída fica no menu principal.
  const back = () => {
    if (panel === "review") cancelReview()
    else if (panel) closePanel()
    else if (details) setDetails(false)
    else if (query) clearSearch()
  }
  const randomGame = () => {
    if (!games.length) return
    openDetails(games[Math.floor(Math.random() * games.length)].id)
    closePanel()
  }
  const mutate = async (operation: () => Promise<void>) => {
    if (editing) return
    setEditing(true)
    try { await operation(); setError(null) }
    catch (reason) { setError(String(reason)) }
    finally { setEditing(false) }
  }
  const favorite = () => { if (game) void mutate(() => window.api.games.setFavorite(game.id, !game.favorite)) }
  const play = async () => {
    if (!game || launching || loadingRunning || running.length > 0) return
    setLaunching(true)
    setError(null)
    try {
      // Confirmar o estado no serviço evita abrir outra sessão entre dois eventos do renderer.
      launchedId.current = game.id
      if (!await launchGuard.current.play(game.id, window.api.games)) launchedId.current = null
    } catch (reason) { launchedId.current = null; setError(String(reason)) }
    finally { setLaunching(false) }
  }
  // Mapa do Aniki: □ joga, △ abre as opções do jogo, L3 busca e Options abre o menu (segurar: configurações).
  const action = (event: FullscreenAction) => {
    if (event === "circle") { back(); return true }
    if (event === "window") { onExit(); return true }
    if (panel) return false
    if (event === "options") { setPanel("menu"); return true }
    if (event === "options-hold") { setPanel("preferences"); return true }
    if (event === "l3") { setPanel("search"); return true }
    if (event === "square") { if (game?.romPath && game.emulatorId) void play(); return true }
    if (event === "triangle" && game) { setPanel("options"); return true }
    if ((event === "l1" || event === "r1") && !details) {
      changeCollection(collections[(collections.indexOf(collection) + (event === "r1" ? 1 : 2)) % collections.length])
      return true
    }
    return false
  }
  useFullscreenInput(scope, !suspended, context, action)
  const status = statuses.find((item) => item.id === game?.statusId)?.name
  const canPlay = Boolean(game?.romPath && game.emulatorId)
  const shortcuts: AnikiShortcut[] = [
    ...(canPlay ? [{ button: "square" as const, label: t.fullscreen.play }] : []),
    { button: "cross", label: t.fullscreen.details },
    ...(game ? [{ button: "triangle" as const, label: t.fullscreen.options }] : []),
    { button: "l3", label: t.fullscreen.searchShort },
    { button: "options", label: t.fullscreen.menu, hold: t.fullscreen.holdSettings },
  ]

  return (
    <div hidden={!enabled} className="fullscreen-shell" data-testid="fullscreen-shell">
      <AnikiStage>
      <FullscreenMedia game={game} suspended={suspended} />
      <section ref={panel ? undefined : scope} className="fs-main" inert={panel !== null || running.length > 0 || launching}>
        <AnikiTopBar games={games} label={details && game ? game.platform ?? game.library ?? "" : query ? t.fullscreen.searchResults : label(collection)} onSearch={() => setPanel("search")} onMenu={() => setPanel("menu")} />
        {details && game ? <AnikiSignature
          game={game}
          status={status}
          canPlay={canPlay}
          playLabel={launching ? t.fullscreen.launching : t.fullscreen.play}
          playDisabled={loadingRunning || launching || running.length > 0}
          playVideo={!suspended && !panel}
          onPlay={() => void play()}
          onTrophies={() => setPanel("achievements")}
          onDescription={() => setPanel("description")}
          onOptions={() => setPanel("options")}
        /> : <AnikiLibrary game={game} games={games} visible={visible} selectedId={resolvedId} query={query} shortcuts={shortcuts} onSelect={setSelectedId} onOpen={openDetails} onClearSearch={clearSearch} onOpenEmulators={onOpenEmulators} />}
        {disconnected && <p role="status" className="aniki-disconnected">{t.fullscreen.disconnected}</p>}
      </section>
      {panel === "menu" && <div className="aniki-menu-shade" onClick={(event) => { if (event.target === event.currentTarget) closePanel() }}><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fullscreen.mainMenu}>
        <AnikiMainMenu canRandom={games.length > 0} onSettings={() => setPanel("preferences")} onRandom={randomGame} onMinimize={() => { closePanel(); window.api.windowControls.minimize() }} onDesktop={() => { closePanel(); onExit() }} onExit={() => window.api.windowControls.close()} />
      </section></div>}
      {panel === "description" && game && <div className="aniki-menu-shade" onClick={(event) => { if (event.target === event.currentTarget) closePanel() }}><section ref={scope} role="dialog" aria-modal="true" aria-label={t.details.description} className="aniki-side-panel">
        <AnikiDescription game={game} onEditReview={openReview} />
      </section></div>}
      {panel === "achievements" && game && <div className="aniki-trophies-shade"><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fields.achievements}>
        <AnikiTrophies game={game} />
      </section></div>}
      {panel && !["menu", "description", "achievements"].includes(panel) && <div className="fs-modal-shade"><section ref={scope} role="dialog" aria-modal="true" aria-label={panel === "preferences" ? t.fullscreen.preferences : panel === "search" ? t.fullscreen.search : panel === "review" ? t.fullscreen.review : t.fullscreen.options} className={`fs-modal fs-modal-${panel}`}>
        {panel === "search" ? <FullscreenKeyboard title={t.fullscreen.search} initial={query} onCancel={closePanel} onApply={(text) => { if (!query) searchReturn.current = { id: selectedId ?? resolvedId, details }; setQuery(text); setSelectedId(text ? null : searchReturn.current.id); setDetails(text ? false : searchReturn.current.details); closePanel() }} /> : panel === "review" && game ? <FullscreenKeyboard title={t.fullscreen.review} initial={game.review ?? ""} multiline onCancel={cancelReview} onApply={(text) => { const revision = reviewRevision.current; void mutate(async () => { await window.api.games.setEvaluation(game.id, { review: text || null }); if (revision === reviewRevision.current) closePanel() }) }} /> : <>
          <button type="button" className="fs-back" onClick={closePanel}><ArrowLeft />{t.fullscreen.back}</button>
          {panel === "preferences" && <><h2>{t.fullscreen.preferences}</h2><FullscreenPreferences /></>}
          {panel === "options" && game && <><h2>{game.title}</h2><div className="fs-options">
            <button type="button" aria-pressed={game.favorite} disabled={editing} onClick={favorite}><Star />{t.fullscreen.favorite}</button>
            <h3>{t.fields.status}</h3><div className="fs-status-options">{statuses.map((item) => <button type="button" key={item.id} disabled={editing} aria-pressed={game.statusId === item.id} onClick={() => void mutate(() => window.api.games.setStatus(game.id, item.id))}>{item.name}</button>)}</div>
            {(["rating", "difficulty"] as const).map((field) => <div key={field} className="fs-score"><h3>{t.fields[field]}</h3><button type="button" disabled={editing} aria-label={t.fields[field] + " −"} onClick={() => void mutate(() => window.api.games.setEvaluation(game.id, { [field]: Math.max(1, (game[field] ?? 2) - 1) }))}>{"−"}</button><output>{game[field] !== null ? (game[field]! / 2).toLocaleString(t.locale) + " / 5" : "—"}</output><button type="button" disabled={editing} aria-label={t.fields[field] + " +"} onClick={() => void mutate(() => window.api.games.setEvaluation(game.id, { [field]: Math.min(10, (game[field] ?? 0) + 1) }))}>{"+"}</button><button type="button" disabled={editing} aria-label={t.fields[field] + ": " + t.common.clear} onClick={() => void mutate(() => window.api.games.setEvaluation(game.id, { [field]: null }))}>{t.common.clear}</button></div>)}
            <button type="button" onClick={openReview}>{t.fullscreen.editReview}</button>
          </div></>}
        </>}
        {error && <p role="alert" className="fs-error">{error}</p>}
      </section></div>}
      {!panel && error && <p role="alert" className="fs-error fs-toast">{error}</p>}
      {(running.length > 0 || launching) && <div className="fs-running" role="status"><Gamepad2 /><p>{launching ? t.fullscreen.launching : t.fullscreen.running}</p></div>}
      </AnikiStage>
    </div>
  )
}
