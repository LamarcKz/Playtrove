import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowLeft, Search, Settings2, Star, Maximize2, Gamepad2, Play, MoreHorizontal, Trophy } from "lucide-react"
import type { Game } from "@shared/types"
import { GameCover } from "@/components/GameCover"
import { AppLogo } from "@/components/AppLogo"
import { ControllerIndicator } from "@/components/ControllerIndicator"
import { useI18n } from "@/hooks/useI18n"
import { useStatuses } from "@/hooks/useStatuses"
import { useRunningGamesState } from "@/hooks/useRunningGames"
import { useFullscreenActive, useFullscreenInput } from "@/hooks/useFullscreenInput"
import { fullscreenGames, restoreFullscreenSelection, type FullscreenAction, type FullscreenCollection } from "@/lib/fullscreenNavigation"
import { FullscreenLaunchGuard } from "@/lib/fullscreenSession"
import { devMark } from "@/lib/devBuild"
import { formatPlaytime } from "@/lib/format"
import { FullscreenPreferences } from "./FullscreenPreferences"
import { FullscreenKeyboard } from "./FullscreenKeyboard"
import { FullscreenAchievements } from "./FullscreenAchievements"
import { FullscreenMedia } from "./FullscreenMedia"

type Panel = "preferences" | "options" | "search" | "review" | "achievements" | null
interface Props { enabled: boolean; games: Game[]; initialGameId: number | null; onExit: () => void; onOpenEmulators: () => void }
const collections: FullscreenCollection[] = ["all", "recent", "favorites"]

export function PlaytroveShell({ enabled, games, initialGameId, onExit, onOpenEmulators }: Props) {
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
  const back = () => {
    if (panel === "review") cancelReview()
    else if (panel) closePanel()
    else if (details) setDetails(false)
    else if (query) clearSearch()
    else onExit()
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
  const action = (event: FullscreenAction) => {
    if (event === "circle") { back(); return true }
    if (event === "create") { onExit(); return true }
    if (event === "options" && !panel) { setPanel("preferences"); return true }
    if (event === "square" && !panel) { setPanel("search"); return true }
    if (event === "triangle" && !panel) { favorite(); return true }
    if ((event === "l1" || event === "r1") && !panel && !details) {
      changeCollection(collections[(collections.indexOf(collection) + (event === "r1" ? 1 : 2)) % collections.length])
      return true
    }
    return false
  }
  useFullscreenInput(scope, !suspended, context, action)
  const status = statuses.find((item) => item.id === game?.statusId)?.name
  const canPlay = Boolean(game?.romPath && game.emulatorId)

  return (
    <div hidden={!enabled} className="playtrove-fullscreen" data-testid="fullscreen-shell">
      <FullscreenMedia game={game} details={details} suspended={suspended} />
      <section ref={panel ? undefined : scope} className="fs-main" inert={panel !== null || running.length > 0 || launching}>
        <header className="fs-header">
          <div className="fs-brand relative">
            <AppLogo />
            {devMark && (
              <span
                title={devMark === "tests" ? t.topBar.devTestsHint : t.topBar.devHint}
                className="absolute -bottom-1.5 left-0 rounded bg-dev px-1 text-[9px] leading-3.5 font-bold text-dev-foreground"
              >
                {t.topBar.dev}
              </span>
            )}
            <span>{"Playtrove"}</span>
          </div>
          <nav aria-label={t.fullscreen.collection} className="fs-collections">{collections.map((value) => <button type="button" key={value} aria-pressed={!query && collection === value} onClick={() => changeCollection(value)}>{label(value)}</button>)}</nav>
          <div className="fs-header-tools"><ControllerIndicator /><button type="button" aria-label={t.fullscreen.search} onClick={() => setPanel("search")}><Search /></button><button type="button" aria-label={t.fullscreen.preferences} onClick={() => setPanel("preferences")}><Settings2 /></button><button type="button" aria-label={t.fullscreen.exit} onClick={onExit}><Maximize2 /></button></div>
        </header>
        {details && game ? <div className="fs-signature" data-testid="fullscreen-details">
          <div className="fs-signature-heading">
            <button type="button" className="fs-back" onClick={() => setDetails(false)}><ArrowLeft />{t.fullscreen.back}</button>
            <p className="fs-eyebrow">{[game.platform, game.library].filter(Boolean).join(" · ")}</p>
            <h1>{game.title}{game.favorite && <Star className="fs-favorite" />}</h1>
          </div>
          <div className="fs-signature-card">
            <div className="fs-signature-cover"><GameCover title={game.title} src={game.coverUrl} /></div>
            <div className="fs-signature-content">
              <p className="fs-eyebrow">{[game.developers.join(", "), game.releaseDate?.slice(0, 4)].filter(Boolean).join(" · ")}</p>
              <div className="fs-details-actions">
                <button type="button" data-fs-default className="fs-primary fs-play" disabled={!canPlay || loadingRunning || launching || running.length > 0} onClick={() => void play()}><Play />{launching ? t.fullscreen.launching : t.fullscreen.play}</button>
                <button type="button" data-fs-fallback aria-label={t.fullscreen.options} onClick={() => setPanel("options")}><MoreHorizontal /></button>
                <button type="button" aria-label={t.fullscreen.favorite} aria-pressed={game.favorite} disabled={editing} onClick={favorite}><Star /></button>
              </div>
              <dl className="fs-facts">
                <div><dt>{t.fields.status}</dt><dd>{status}</dd></div>
                <div><dt>{t.fields.playtime}</dt><dd>{formatPlaytime(game.playtimeMinutes, t)}</dd></div>
                <div><dt>{t.fields.rating}</dt><dd>{game.rating !== null ? (game.rating / 2).toLocaleString(t.locale) + " / 5" : "—"}</dd></div>
                <div><dt>{t.fields.difficulty}</dt><dd>{game.difficulty !== null ? (game.difficulty / 2).toLocaleString(t.locale) + " / 5" : "—"}</dd></div>
              </dl>
              <div className="fs-achievement-card"><Trophy /><div><h2>{t.fields.achievements}</h2>{game.achievements ? <p>{game.achievements.unlocked} / {game.achievements.total}</p> : <p>{game.trophiesPending ? t.achievements.trophiesPending : t.fullscreen.noAchievements}</p>}</div>{game.achievements && <button type="button" onClick={() => setPanel("achievements")}>{t.fullscreen.achievements}</button>}</div>
              <button type="button" onClick={openReview}>{t.fullscreen.editReview}</button>
            </div>
          </div>
          <div className="fs-description" data-testid="fullscreen-description" data-fs-scroll tabIndex={0}><h2>{t.details.description}</h2><p>{game.description || t.fullscreen.noDescription}</p>{game.review && <><h2>{t.fullscreen.review}</h2><p className="fs-review-text">{game.review}</p></>}</div>
        </div> : <div className="fs-library" data-testid="fullscreen-library">
          <div className="fs-game-info"><p className="fs-eyebrow">{[game?.platform, game?.library].filter(Boolean).join(" · ")}</p><h1>{game?.title ?? t.library.emptyTitle}{game?.favorite && <Star className="fs-favorite" />}</h1></div>
          {game && <aside className="fs-library-stats"><dl><div><dt>{t.fields.status}</dt><dd>{status}</dd></div><div><dt>{t.fields.playtime}</dt><dd>{formatPlaytime(game.playtimeMinutes, t)}</dd></div>{game.rating !== null && <div><dt>{t.fields.rating}</dt><dd>{(game.rating / 2).toLocaleString(t.locale)} / 5</dd></div>}{game.achievements && <div><dt>{t.fields.achievements}</dt><dd><Trophy />{game.achievements.unlocked} / {game.achievements.total}</dd></div>}</dl></aside>}
          <div className="fs-library-bottom"><p className="fs-rail-controls">{t.fullscreen.controls}</p><div className="fs-rail-heading"><h2>{query ? t.fullscreen.searchResults : label(collection)}</h2><span>{t.common.games(visible.length)}</span>{query && <button type="button" onClick={clearSearch}>{t.fullscreen.clearSearch}</button>}</div><div className="fs-cover-rail">{visible.map((item) => <button type="button" key={item.id} data-testid={`fullscreen-game-${item.id}`} data-fs-default={item.id === resolvedId ? "" : undefined} aria-label={item.title} aria-current={item.id === resolvedId ? "true" : undefined} onFocus={() => setSelectedId(item.id)} onMouseEnter={() => setSelectedId(item.id)} onClick={() => openDetails(item.id)} className="fs-cover"><GameCover title={item.title} src={item.coverUrl} layout="grid" /><span>{item.title}</span></button>)}</div>{visible.length === 0 && <div className="fs-empty"><Gamepad2 /><p>{games.length ? t.library.noResultsTitle : t.library.emptyDescription}</p>{!games.length && <button type="button" onClick={onOpenEmulators}>{t.library.goToEmulators}</button>}</div>}</div>
        </div>}
        <footer className="fs-footer"><span>{details ? t.fullscreen.controls : ""}</span>{disconnected && <span role="status">{t.fullscreen.disconnected}</span>}</footer>
      </section>
      {panel && <div className="fs-modal-shade"><section ref={scope} role="dialog" aria-modal="true" aria-label={panel === "preferences" ? t.fullscreen.preferences : panel === "search" ? t.fullscreen.search : panel === "review" ? t.fullscreen.review : panel === "achievements" ? t.fields.achievements : t.fullscreen.options} className={`fs-modal fs-modal-${panel}`}>
        {panel === "search" ? <FullscreenKeyboard title={t.fullscreen.search} initial={query} onCancel={closePanel} onApply={(text) => { if (!query) searchReturn.current = { id: selectedId ?? resolvedId, details }; setQuery(text); setSelectedId(text ? null : searchReturn.current.id); setDetails(text ? false : searchReturn.current.details); closePanel() }} /> : panel === "review" && game ? <FullscreenKeyboard title={t.fullscreen.review} initial={game.review ?? ""} multiline onCancel={cancelReview} onApply={(text) => { const revision = reviewRevision.current; void mutate(async () => { await window.api.games.setEvaluation(game.id, { review: text || null }); if (revision === reviewRevision.current) closePanel() }) }} /> : <>
          <button type="button" className="fs-back" onClick={closePanel}><ArrowLeft />{t.fullscreen.back}</button>
          {panel === "preferences" && <><h2>{t.fullscreen.preferences}</h2><FullscreenPreferences /></>}
          {panel === "achievements" && game && <FullscreenAchievements game={game} />}
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
    </div>
  )
}
