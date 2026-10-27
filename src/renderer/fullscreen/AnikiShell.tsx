import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { ArrowLeft, Star, Gamepad2 } from "lucide-react"
import type { Game } from "@shared/types"
import { useI18n } from "@/hooks/useI18n"
import { useStatuses } from "@/hooks/useStatuses"
import { useRunningGamesState } from "@/hooks/useRunningGames"
import { useFullscreenActive, useFullscreenInput } from "@/hooks/useFullscreenInput"
import { fullscreenGames, restoreFullscreenSelection, type FullscreenAction, type FullscreenCollection } from "@/lib/fullscreenNavigation"
import { FullscreenLaunchGuard } from "@/lib/fullscreenSession"
import { AnikiSettings, SETTINGS_CATEGORIES, type SettingsCategory } from "./AnikiSettings"
import { AnikiSetup, SETUP_STEPS, type SetupDraft } from "./AnikiSetup"
import { AnikiLogin } from "./AnikiLogin"
import { FullscreenKeyboard } from "./FullscreenKeyboard"
import { FullscreenMedia } from "./FullscreenMedia"
import { AnikiStage } from "./AnikiStage"
import { AnikiTopBar } from "./AnikiTopBar"
import { AnikiLibrary } from "./AnikiLibrary"
import { AnikiMainMenu } from "./AnikiMainMenu"
import { AnikiDetails } from "./AnikiDetails"
import { DETAILS_LAYOUTS, LIBRARY_LAYOUTS } from "@shared/fullscreen"
import { AnikiTrophies } from "./AnikiTrophies"
import { AnikiDescription } from "./AnikiDescription"
import { AnikiHub, HUB_PAGES } from "./AnikiHub"
import { AnikiQuickAccess, AnikiQuickOptions } from "./AnikiQuickPanels"
import { AnikiProfile } from "./AnikiProfile"
import { AnikiTrophyOverview } from "./AnikiTrophyOverview"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { useDynamicPalette } from "@/hooks/useDynamicPalette"
import type { AnikiShortcut } from "./AnikiShortcutBar"

type Panel = "preferences" | "options" | "search" | "review" | "achievements" | "description" | "menu" | "quickAccess" | "quickOptions" | "profileName" | "profile" | "trophyOverview" | "setup" | "login" | null
interface Props { enabled: boolean; games: Game[]; initialGameId: number | null; onExit: () => void; onOpenEmulators: () => void }
const collections: FullscreenCollection[] = ["all", "recent", "favorites"]

export function AnikiShell({ enabled, games, initialGameId, onExit, onOpenEmulators }: Props) {
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
  const [hub, setHub] = useState(false)
  const [hubPage, setHubPage] = useState(0)
  const [updating, setUpdating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const { config, save: saveConfig } = useFullscreenConfig()
  const startApplied = useRef(false)
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("general")
  const [setupStep, setSetupStep] = useState(0)
  const [setupDraft, setSetupDraft] = useState<SetupDraft | null>(null)
  const nameReturn = useRef<Panel>("preferences")
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
  const context = `${hub ? `hub${hubPage}` : details ? "details" : "library"}:${panel ?? "main"}:${details ? game?.id : collection}:${panel === "preferences" ? settingsCategory : panel === "setup" ? setupStep : ""}`
  const label = (value: FullscreenCollection) => value === "all" ? t.fullscreen.all : value === "recent" ? t.fullscreen.recent : t.fullscreen.favorites

  useEffect(() => {
    let live = true
    const stop = window.api.controllers.onChange((controllers) => setDisconnected(controllers.length === 0))
    void window.api.controllers.list().then((controllers) => { if (live) setDisconnected(controllers.length === 0) }).catch(() => {})
    return () => { live = false; stop() }
  }, [])
  // Como no assistente do Aniki: ao abrir o app em tela cheia, começa no Hub ou na biblioteca. Alternar
  // janela/tela cheia depois preserva onde a pessoa estava.
  useEffect(() => {
    if (!enabled || !config || startApplied.current) return
    startApplied.current = true
    setHub(config.startDestination === "hub")
    // Como no Aniki: a tela de boas-vindas, se ligada, e o assistente na primeira vez.
    if (!config.setupDone) openSetup()
    else if (config.loginScreen) setPanel("login")
  }, [enabled, config])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])
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
  const openSetup = () => {
    if (!config) return
    const { profileName, profileAvatar, startDestination, loginScreen, interface: style, colorPreset, detailsLayout, effects, trailers } = config
    setSetupDraft({ profileName, profileAvatar, startDestination, loginScreen, interface: style, colorPreset, detailsLayout, effects, trailers })
    setSetupStep(0)
    setPanel("setup")
  }
  const finishSetup = async (patch: Partial<SetupDraft>) => {
    await saveConfig({ ...patch, setupDone: true })
    setSetupDraft(null)
    closePanel()
  }
  const editName = () => { nameReturn.current = panel; setPanel("profileName") }
  const clearSearch = () => { setQuery(""); setSelectedId(searchReturn.current.id); setDetails(searchReturn.current.details) }
  const openReview = () => { reviewRevision.current++; reviewReturn.current = panel; setPanel("review") }
  const cancelReview = () => { reviewRevision.current++; setPanel(reviewReturn.current); setError(null) }
  const openDetails = (id: number) => { setSelectedId(id); setDetails(true); setHub(false); setError(null) }
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
    else if (panel === "profileName") setPanel(nameReturn.current)
    else if (panel === "setup") { if (setupStep > 0) setSetupStep(setupStep - 1); else void finishSetup({}) }
    else if (panel) closePanel()
    else if (hub) setHub(false)
    else if (details) setDetails(false)
    else if (query) clearSearch()
  }
  const randomGame = () => {
    if (!games.length) return
    openDetails(games[Math.floor(Math.random() * games.length)].id)
    closePanel()
  }
  const updateLibrary = async () => {
    if (updating) return
    setUpdating(true)
    try { await window.api.romFolders.scan(); setNotice(t.fullscreen.libraryUpdated); closePanel() }
    catch (reason) { setError(String(reason)) }
    finally { setUpdating(false) }
  }
  // Como segurar △ no Aniki: troca o layout da tela atual (biblioteca ou detalhes), em ciclo.
  const cycleLayout = () => {
    if (!config) return
    if (details) void saveConfig({ detailsLayout: DETAILS_LAYOUTS[(DETAILS_LAYOUTS.indexOf(config.detailsLayout) + 1) % DETAILS_LAYOUTS.length] })
    else void saveConfig({ libraryLayout: LIBRARY_LAYOUTS[(LIBRARY_LAYOUTS.indexOf(config.libraryLayout) + 1) % LIBRARY_LAYOUTS.length] })
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
  // Mapa do Aniki: □ joga, △ abre as opções do jogo, L3 busca, Options abre o Acesso rápido (segurar:
  // configurações) e Create abre o Hub (segurar: Opções rápidas).
  const action = (event: FullscreenAction) => {
    if (event === "circle") { back(); return true }
    if (event === "window") { onExit(); return true }
    if (panel === "preferences" && (event === "l1" || event === "r1")) {
      setSettingsCategory(SETTINGS_CATEGORIES[(SETTINGS_CATEGORIES.indexOf(settingsCategory) + (event === "r1" ? 1 : SETTINGS_CATEGORIES.length - 1)) % SETTINGS_CATEGORIES.length])
      return true
    }
    if (panel) return false
    if (event === "options") { setPanel("quickAccess"); return true }
    if (event === "options-hold") { setPanel("preferences"); return true }
    if (event === "create") { setHub(!hub); setDetails(false); return true }
    if (event === "create-hold") { setPanel("quickOptions"); return true }
    if (hub && (event === "l1" || event === "r1")) { setHubPage((hubPage + (event === "r1" ? 1 : HUB_PAGES - 1)) % HUB_PAGES); return true }
    if (hub) return false
    if (event === "l3") { setPanel("search"); return true }
    if (event === "square") { if (game?.romPath && game.emulatorId) void play(); return true }
    if (event === "triangle" && game) { setPanel("options"); return true }
    if (event === "triangle-hold") { cycleLayout(); return true }
    if ((event === "l1" || event === "r1") && !details) {
      changeCollection(collections[(collections.indexOf(collection) + (event === "r1" ? 1 : 2)) % collections.length])
      return true
    }
    return false
  }
  useFullscreenInput(scope, !suspended, context, action)
  const status = statuses.find((item) => item.id === game?.statusId)?.name
  const dynamic = useDynamicPalette(game, Boolean(config?.dynamicColors) && enabled)
  const canPlay = Boolean(game?.romPath && game.emulatorId)
  const shortcuts: AnikiShortcut[] = [
    ...(canPlay ? [{ button: "square" as const, label: t.fullscreen.play }] : []),
    { button: "cross", label: t.fullscreen.details },
    ...(game ? [{ button: "triangle" as const, label: t.fullscreen.options, hold: t.fullscreen.holdLayout }] : []),
    { button: "l3", label: t.fullscreen.searchShort },
    { button: "create", label: t.fullscreen.hub, hold: t.fullscreen.holdQuickOptions },
    { button: "options", label: t.fullscreen.quickAccess, hold: t.fullscreen.holdSettings },
  ]

  return (
    <div hidden={!enabled} className="fullscreen-shell" data-testid="fullscreen-shell" data-aniki-color={config?.colorPreset ?? "default"} data-aniki-effects={config?.effects ?? "balanced"} data-aniki-interface={config?.interface ?? "standard"} style={dynamic as CSSProperties}>
      <AnikiStage>
      {/* No Aniki, o trailer fica no cartão dos detalhes (AnikiTrailerCard), não no fundo. */}
      <FullscreenMedia game={game} details={false} suspended={suspended} />
      <section ref={panel ? undefined : scope} className="fs-main" inert={panel !== null || running.length > 0 || launching}>
        <AnikiTopBar games={games} hub={hub} layoutLabel={!config ? null : details ? t.fullscreen.detailsLayouts[config.detailsLayout] : t.fullscreen.libraryLayouts[config.libraryLayout]} onLayout={cycleLayout} onHub={() => { setHub(!hub); setDetails(false) }} onProfile={() => setPanel("profile")} onTrophies={() => setPanel("trophyOverview")} onSearch={() => setPanel("search")} onMenu={() => setPanel("menu")} />
        {hub && config ? <AnikiHub games={games} config={config} page={hubPage} onOpen={openDetails} /> : details && game && config ? <AnikiDetails
          layout={config.detailsLayout}
          game={game}
          status={status}
          canPlay={canPlay}
          playLabel={launching ? t.fullscreen.launching : t.fullscreen.play}
          playDisabled={loadingRunning || launching || running.length > 0}
          playVideo={!suspended && !panel}
          showTrailer={config.trailers !== "off"}
          onPlay={() => void play()}
          onTrophies={() => setPanel("achievements")}
          onDescription={() => setPanel("description")}
          onOptions={() => setPanel("options")}
          onReview={openReview}
        /> : <AnikiLibrary layout={config?.libraryLayout ?? "horizontal"} interfaceStyle={config?.interface ?? "standard"} trailer={config?.trailers === "all"} playVideo={!suspended && !panel} status={status} game={game} games={games} visible={visible} selectedId={resolvedId} query={query} collectionLabel={query ? t.fullscreen.searchResults : label(collection)} shortcuts={shortcuts} onSelect={setSelectedId} onOpen={openDetails} onClearSearch={clearSearch} onOpenEmulators={onOpenEmulators} />}
        {disconnected && <p role="status" className="aniki-disconnected">{t.fullscreen.disconnected}</p>}
      </section>
      {panel === "menu" && <div className="aniki-menu-shade" onClick={(event) => { if (event.target === event.currentTarget) closePanel() }}><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fullscreen.mainMenu}>
        <AnikiMainMenu canRandom={games.length > 0} onSettings={() => setPanel("preferences")} onRandom={randomGame} onMinimize={() => { closePanel(); window.api.windowControls.minimize() }} onDesktop={() => { closePanel(); onExit() }} onExit={() => window.api.windowControls.close()} />
      </section></div>}
      {panel === "quickAccess" && <div className="aniki-menu-shade" onClick={(event) => { if (event.target === event.currentTarget) closePanel() }}><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fullscreen.quickAccess}>
        <AnikiQuickAccess canRandom={games.length > 0} updating={updating} onProfile={() => setPanel("profile")} onTrophies={() => setPanel("trophyOverview")} onSettings={() => setPanel("preferences")} onRandom={randomGame} onUpdate={() => void updateLibrary()} onPower={() => setPanel("menu")} />
      </section></div>}
      {panel === "quickOptions" && <div className="aniki-menu-shade" onClick={(event) => { if (event.target === event.currentTarget) closePanel() }}><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fullscreen.quickOptions} className="aniki-quick-options-panel">
        <AnikiQuickOptions />
      </section></div>}
      {panel === "preferences" && <div className="aniki-trophies-shade"><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fullscreen.settings}>
        <AnikiSettings category={settingsCategory} onCategory={setSettingsCategory} onEditName={editName} onRunSetup={openSetup} />
      </section></div>}
      {panel === "setup" && setupDraft && <div className="aniki-trophies-shade"><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fullscreen.setup.title}>
        <AnikiSetup step={setupStep} draft={setupDraft} onDraft={(patch) => setSetupDraft({ ...setupDraft, ...patch })} onStep={(step) => setSetupStep(Math.max(0, Math.min(SETUP_STEPS.length - 1, step)))} onApply={() => void finishSetup(setupDraft)} onEditName={editName} />
      </section></div>}
      {panel === "login" && config && <div className="aniki-trophies-shade"><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fullscreen.welcomeBack}>
        <AnikiLogin config={config} onContinue={closePanel} />
      </section></div>}
      {panel === "description" && game && <div className="aniki-menu-shade" onClick={(event) => { if (event.target === event.currentTarget) closePanel() }}><section ref={scope} role="dialog" aria-modal="true" aria-label={t.details.description} className="aniki-side-panel">
        <AnikiDescription game={game} onEditReview={openReview} />
      </section></div>}
      {panel === "profile" && config && <div className="aniki-trophies-shade"><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fullscreen.profile}>
        <AnikiProfile games={games} config={config} onOpen={(id) => { openDetails(id); closePanel() }} />
      </section></div>}
      {panel === "trophyOverview" && config && <div className="aniki-trophies-shade"><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fullscreen.trophiesTitle}>
        <AnikiTrophyOverview games={games} config={config} onOpen={(id) => { openDetails(id); setPanel("achievements") }} />
      </section></div>}
      {panel === "achievements" && game && <div className="aniki-trophies-shade"><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fields.achievements}>
        <AnikiTrophies game={game} />
      </section></div>}
      {panel && !["menu", "description", "achievements", "quickAccess", "quickOptions", "profile", "trophyOverview", "preferences", "setup", "login"].includes(panel) && <div className="fs-modal-shade"><section ref={scope} role="dialog" aria-modal="true" aria-label={panel === "profileName" ? t.fullscreen.profileName : panel === "search" ? t.fullscreen.search : panel === "review" ? t.fullscreen.review : t.fullscreen.options} className={`fs-modal fs-modal-${panel}`}>
        {panel === "profileName" && config ? <FullscreenKeyboard title={t.fullscreen.profileName} initial={nameReturn.current === "setup" && setupDraft ? setupDraft.profileName : config.profileName} onCancel={() => setPanel(nameReturn.current)} onApply={(text) => { if (nameReturn.current === "setup" && setupDraft) { setSetupDraft({ ...setupDraft, profileName: text.trim().slice(0, 32) }); setPanel("setup") } else void saveConfig({ profileName: text.trim() }).then(() => setPanel(nameReturn.current)) }} /> : panel === "search" ? <FullscreenKeyboard title={t.fullscreen.search} initial={query} onCancel={closePanel} onApply={(text) => { if (!query) searchReturn.current = { id: selectedId ?? resolvedId, details }; setQuery(text); setSelectedId(text ? null : searchReturn.current.id); setDetails(text ? false : searchReturn.current.details); closePanel() }} /> : panel === "review" && game ? <FullscreenKeyboard title={t.fullscreen.review} initial={game.review ?? ""} multiline onCancel={cancelReview} onApply={(text) => { const revision = reviewRevision.current; void mutate(async () => { await window.api.games.setEvaluation(game.id, { review: text || null }); if (revision === reviewRevision.current) { setPanel(reviewReturn.current); setError(null) } }) }} /> : <>
          <button type="button" className="fs-back" onClick={closePanel}><ArrowLeft />{t.fullscreen.back}</button>
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
      {notice && <p role="status" className="fs-toast">{notice}</p>}
      {(running.length > 0 || launching) && <div className="fs-running" role="status"><Gamepad2 /><p>{launching ? t.fullscreen.launching : t.fullscreen.running}</p></div>}
      </AnikiStage>
    </div>
  )
}
