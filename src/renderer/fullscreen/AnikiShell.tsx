import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent, type PointerEvent } from "react"
import { ArrowLeft, Star, Gamepad2, Download, FolderOpen } from "lucide-react"
import type { Game } from "@shared/types"
import { useI18n } from "@/hooks/useI18n"
import { useStatuses } from "@/hooks/useStatuses"
import { useRunningGamesState } from "@/hooks/useRunningGames"
import { useFullscreenActive, useFullscreenInput } from "@/hooks/useFullscreenInput"
import { fullscreenGames, restoreFullscreenSelection, sortFullscreenGames, type FullscreenAction, type FullscreenCollection, type FullscreenSort } from "@/lib/fullscreenNavigation"
import { EMPTY_FILTERS, filterGames, hasActiveFilters, type LibraryFilters } from "@/lib/filters"
import { FullscreenLaunchGuard } from "@/lib/fullscreenSession"
import { AnikiSettings, SETTINGS_CATEGORIES, type SettingsCategory, type SplashDurationField } from "./AnikiSettings"
import { AnikiSetup, SETUP_STEPS, type SetupDraft } from "./AnikiSetup"
import { AnikiLogin } from "./AnikiLogin"
import { FullscreenKeyboard } from "./FullscreenKeyboard"
import { AnikiMedia } from "./AnikiMedia"
import { AnikiStage } from "./AnikiStage"
import { AnikiTopBar } from "./AnikiTopBar"
import { AnikiLibrary } from "./AnikiLibrary"
import { AnikiMainMenu } from "./AnikiMainMenu"
import { AnikiDetails } from "./AnikiDetails"
import { DETAILS_LAYOUTS, LIBRARY_LAYOUTS, type PowerAction } from "@shared/fullscreen"
import { AnikiTrophies } from "./AnikiTrophies"
import { AnikiDescription } from "./AnikiDescription"
import { AnikiHub, HUB_PAGES } from "./AnikiHub"
import { AnikiQuickAccess, AnikiQuickOptions } from "./AnikiQuickPanels"
import { AnikiProfile } from "./AnikiProfile"
import { AnikiTrophyOverview } from "./AnikiTrophyOverview"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { useDynamicPalette } from "@/hooks/useDynamicPalette"
import type { AnikiShortcut } from "./AnikiShortcutBar"
import { AnikiSounds, type AnikiSound } from "@/lib/anikiSounds"
import { AnikiAppearanceProvider } from "./AnikiAppearanceContext"
import { AnikiAudioPanel } from "./AnikiAudioPanel"
import { AnikiHelp } from "./AnikiHelp"
import { PlaytroveFilters } from "./PlaytroveFilters"
import { PlaytroveNotices } from "./PlaytroveInfoPanels"
import { PowerConfirm } from "./PlaytroveMenu"
import { useFullscreenNotices } from "@/hooks/useFullscreenNotices"
import { AnikiGallery, type AnikiGalleryHandle } from "./AnikiGallery"
import { AnikiMaintenance, type AnikiMaintenanceHandle } from "./AnikiMaintenance"
import { AnikiMusicPlayer } from "./AnikiMusicPlayer"
import { AnikiNews, type AnikiNewsHandle } from "./AnikiNews"
import { AnikiCustomMediaPicker, type AnikiCustomMediaPickerHandle } from "./AnikiCustomMediaPicker"
import { AnikiLifecycleVideo } from "./AnikiLifecycleVideo"
import { AnikiScreenSaver, type AnikiScreenSaverHandle } from "./AnikiScreenSaver"
import { AnikiRunningSession, type AnikiRunningSessionHandle } from "./AnikiRunningSession"
import { screenSaverHasBackground } from "@/lib/anikiPresentation"

type CustomMediaPanel = "customAvatar" | "customLogo" | "customSplash"
type Panel = "preferences" | "options" | "search" | "review" | "achievements" | "description" | "menu" | "quickAccess" | "quickOptions" | "profileName" | "profile" | "trophyOverview" | "setup" | "login" | "filters" | "notices" | "help" | "power" | "audio" | "gallery" | "maintenance" | "music" | "news" | "splashDuration" | CustomMediaPanel | null
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
  const [splashDurationField, setSplashDurationField] = useState<SplashDurationField | null>(null)
  const splashDurationTitle = splashDurationField === "gameLaunchSplashMinimumDurationMs" ? t.gameLaunchSplash.minimumEdit : t.gameLaunchSplash.maximumEdit
  const panelReturn = useRef<Panel>(null)
  const customMediaReturn = useRef<Panel>(null)
  const customMediaTarget = panel === "customAvatar" ? "avatar" : panel === "customLogo" ? "logo" : panel === "customSplash" ? "globalSplash" : null
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<FullscreenSort>("collection")
  const [powerAction, setPowerAction] = useState<PowerAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [editing, setEditing] = useState(false)
  const [disconnected, setDisconnected] = useState(false)
  const [hub, setHub] = useState(false)
  const [hubPage, setHubPage] = useState(0)
  const [hubPageCount, setHubPageCount] = useState(HUB_PAGES)
  const gallery = useRef<AnikiGalleryHandle>(null)
  const maintenance = useRef<AnikiMaintenanceHandle>(null)
  const news = useRef<AnikiNewsHandle>(null)
  const customMedia = useRef<AnikiCustomMediaPickerHandle>(null)
  const [updating, setUpdating] = useState(false)
  const [lifecycle, setLifecycle] = useState<"startup" | "shutdown" | null>(null)
  const [startupWaiting, setStartupWaiting] = useState(false)
  const [screenSaverActive, setScreenSaverActive] = useState(false)
  const screenSaver = useRef<AnikiScreenSaverHandle>(null)
  const runningSession = useRef<AnikiRunningSessionHandle>(null)
  const notices = useFullscreenNotices()
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
  const sounds = useRef(new AnikiSounds())
  const programmaticFocus = useRef(false)
  const hovered = useRef<Element | null>(null)
  const visible = sortFullscreenGames(filterGames(fullscreenGames(games, collection, query), "", filters), sort, t.locale)
  const resolvedId = restoreFullscreenSelection(visible, selectedId)
  const game = games.find((item) => item.id === (details ? selectedId : resolvedId))
  const active = useFullscreenActive()
  const { running, loading: loadingRunning } = useRunningGamesState()
  const startupUninitialized = enabled && !startApplied.current && Boolean(config?.startupIntroVideoEnabled)
  const suspended = !enabled || !active || loadingRunning || running.length > 0 || launching || startupWaiting || startupUninitialized || lifecycle !== null
  const context = `${hub ? `hub${hubPage}:${hubPageCount}` : details ? "details" : "library"}:${panel ?? "main"}:${details ? game?.id : collection}:${panel === "preferences" ? settingsCategory : panel === "setup" ? setupStep : ""}:${screenSaverActive}:${running.join(",")}`
  useEffect(() => window.api.windowControls.onCloseRequest(() => setLifecycle("shutdown")), [])
  useEffect(() => {
    if (!startupWaiting) return
    if (!enabled) { setStartupWaiting(false); return }
    if (active) { setLifecycle("startup"); setStartupWaiting(false); return }
    const timer = window.setTimeout(() => setStartupWaiting(false), 1000)
    return () => window.clearTimeout(timer)
  }, [startupWaiting, enabled, active])
  const finishLifecycle = () => {
    if (lifecycle === "shutdown") void window.api.windowControls.finishClose().catch((reason) => setError(String(reason)))
    setLifecycle(null)
  }
  useEffect(() => {
    if (lifecycle && (!enabled || !active)) finishLifecycle()
  }, [lifecycle, enabled, active])
  useEffect(() => { if (hubPage >= hubPageCount) setHubPage(0) }, [hubPage, hubPageCount])
  const label = (value: FullscreenCollection) => value === "all" ? t.fullscreen.all : value === "recent" ? t.fullscreen.recent : t.fullscreen.favorites
  const sound = (kind: AnikiSound) => { if (config?.uiSounds && !suspended && !screenSaverActive) sounds.current.play(kind, config.uiSoundsVolume / 100) }
  useEffect(() => () => sounds.current.dispose(), [])
  useEffect(() => { if (suspended || !config?.uiSounds) sounds.current.pause() }, [suspended, config?.uiSounds])
  const previousPanel = useRef<Panel>(null)
  useEffect(() => {
    if (panel && panel !== previousPanel.current) sound(["quickAccess", "quickOptions", "menu", "options"].includes(panel) ? "open" : "view")
    previousPanel.current = panel
  }, [panel])
  const previousHub = useRef(false)
  useEffect(() => {
    if (hub !== previousHub.current) sound(hub ? "hub" : "closeHub")
    previousHub.current = hub
  }, [hub])
  const interactive = (target: EventTarget) => target instanceof Element ? target.closest("button:not(:disabled), [tabindex='0']") : null
  const soundOnHover = (event: PointerEvent<HTMLDivElement>) => {
    const target = interactive(event.target)
    if (target === hovered.current) return
    hovered.current = target
    if (target) sound("move")
  }
  const soundOnFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!programmaticFocus.current && interactive(event.target) && event.target !== hovered.current) sound("move")
  }
  const soundOnClick = (event: MouseEvent<HTMLDivElement>) => { if (interactive(event.target)) sound("confirm") }

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
    if (config.startupIntroVideoEnabled) setStartupWaiting(true)
    setHub(config.startDestination === "hub")
    // Como no Aniki: a tela de boas-vindas, se ligada, e o assistente na primeira vez.
    if (!config.setupDone) openSetup()
    else if (config.loginScreen) setPanel("login")
  }, [enabled, config])
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
    programmaticFocus.current = true
    target?.focus()
    programmaticFocus.current = false
    target?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" })
  }, [context, active, suspended])

  const closePanel = () => { reviewRevision.current++; panelReturn.current = null; setPanel(null); setError(null) }
  const openPanel = (next: Panel, from: Panel = panel) => { panelReturn.current = from; setPanel(next); setError(null) }
  const openCustomMedia = (next: CustomMediaPanel) => { customMediaReturn.current = panel; setPanel(next); setError(null) }
  const openNotices = () => { notices.markSeen(); openPanel("notices") }
  const openFilters = () => { setHub(false); setDetails(false); openPanel("filters", null) }
  const openSetup = () => {
    if (!config) return
    const { profileName, profileAvatar, anikiAvatarIndex, startDestination, loginScreen, interface: style, colorPreset, detailsLayout, effects, trailers } = config
    setSetupDraft({ profileName, profileAvatar, anikiAvatarIndex, startDestination, loginScreen, interface: style, colorPreset, detailsLayout, effects, trailers })
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
  const openDetails = (id: number) => { sound("details"); setSelectedId(id); setDetails(true); setHub(false); setError(null) }
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
    if (panel === "gallery" && gallery.current?.back()) return
    if (panel === "maintenance" && maintenance.current?.back()) return
    if (panel === "news" && news.current?.back()) return
    if (customMediaTarget && customMedia.current?.back()) return
    if (panel) sound("back")
    else if (details) sound("library")
    if (customMediaTarget) { setPanel(customMediaReturn.current); customMediaReturn.current = null; setError(null) }
    else if (panel === "review") cancelReview()
    else if (panel === "splashDuration") { setPanel("preferences"); setError(null) }
    else if (panel === "profileName") setPanel(nameReturn.current)
    else if (panel === "setup") { if (setupStep > 0) setSetupStep(setupStep - 1); else void finishSetup({}) }
    else if (panel && panelReturn.current) { setPanel(panelReturn.current); panelReturn.current = null; setError(null) }
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
    try { await window.api.romFolders.scan(); notices.push(t.fullscreen.libraryUpdated); closePanel() }
    catch (reason) { setError(String(reason)) }
    finally { setUpdating(false) }
  }
  // Como segurar △ no Aniki: troca o layout da tela atual (biblioteca ou detalhes), em ciclo.
  const cycleLayout = () => {
    if (!config) return
    sound("layout")
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
  const applySplashDuration = (text: string) => {
    if (!splashDurationField || editing) return
    const [min, max] = splashDurationField === "gameLaunchSplashMinimumDurationMs" ? [500, 600000] : [1000, 120000]
    const value = Number(text.trim())
    if (!/^\d+$/.test(text.trim()) || !Number.isSafeInteger(value) || value < min || value > max) {
      setError(t.gameLaunchSplash.invalidDuration(min, max))
      return
    }
    void mutate(async () => {
      await window.api.fullscreen.setConfig({ [splashDurationField]: value })
      setPanel("preferences")
    })
  }
  const confirmPower = async () => {
    if (!powerAction) return
    await mutate(async () => { await window.api.system.power(powerAction); closePanel() })
  }
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
    // F11 continua disponível durante a abertura; uma saída do app já solicitada deve terminar.
    if (event === "window") {
      if (lifecycle === "shutdown") return true
      setLifecycle(null)
      setStartupWaiting(false)
      onExit()
      return true
    }
    if (startupWaiting || startupUninitialized || lifecycle !== null) return true
    if (screenSaver.current?.activity()) return true
    if (running.length > 0) {
      if (event === "circle") { runningSession.current?.back(); return true }
      return false
    }
    if (event === "circle") { back(); return true }
    if (panel === "preferences" && (event === "l1" || event === "r1")) {
      setSettingsCategory(SETTINGS_CATEGORIES[(SETTINGS_CATEGORIES.indexOf(settingsCategory) + (event === "r1" ? 1 : SETTINGS_CATEGORIES.length - 1)) % SETTINGS_CATEGORIES.length])
      return true
    }
    if (panel === "gallery" && (event === "left" || event === "right") && gallery.current?.navigate(event)) return true
    if (panel) return false
    if (event === "options") { setPanel("quickAccess"); return true }
    if (event === "options-hold") { setPanel("preferences"); return true }
    if (event === "create") { setHub(!hub); setDetails(false); return true }
    if (event === "create-hold") { setPanel("quickOptions"); return true }
    if (hub && (event === "l1" || event === "r1")) { setHubPage((hubPage + (event === "r1" ? 1 : hubPageCount - 1)) % hubPageCount); return true }
    if (hub) return false
    if (event === "l3") { setPanel("search"); return true }
    if (event === "r3") { openFilters(); return true }
    if (event === "square") { if (game?.romPath && game.emulatorId) void play(); return true }
    if (event === "triangle" && game) { setPanel("options"); return true }
    if (event === "triangle-hold") { cycleLayout(); return true }
    if ((event === "l1" || event === "r1") && !details) {
      changeCollection(collections[(collections.indexOf(collection) + (event === "r1" ? 1 : 2)) % collections.length])
      return true
    }
    return false
  }
  useFullscreenInput(scope, enabled && active && !loadingRunning && !launching, context, action, false, "main", () => screenSaver.current?.activity() ?? false)
  const status = statuses.find((item) => item.id === game?.statusId)?.name
  const dynamic = useDynamicPalette(game, Boolean(config?.dynamicColors) && enabled)
  const canPlay = Boolean(game?.romPath && game.emulatorId)
  const panelTitle = panel === "splashDuration" ? splashDurationTitle : panel === "customAvatar" ? t.anikiCustomMedia.avatarTitle : panel === "customLogo" ? t.anikiCustomMedia.logoTitle : panel === "customSplash" ? t.anikiCustomMedia.globalSplashTitle : panel === "news" ? t.anikiNews.title : panel === "filters" ? t.filters.title : panel === "notices" ? t.fullscreen.notices : panel === "help" ? t.fullscreen.help : panel === "power" && powerAction ? t.fullscreen.powerActions[powerAction] : panel === "music" ? t.musicPlayer.title : panel === "audio" ? t.audioOutput.title : panel === "maintenance" ? t.fullscreenProfiles.title : panel === "profileName" ? t.fullscreen.profileName : panel === "search" ? t.fullscreen.search : panel === "review" ? t.fullscreen.review : t.fullscreen.options
  const shortcuts: AnikiShortcut[] = [
    ...(canPlay ? [{ button: "square" as const, label: t.fullscreen.play }] : []),
    { button: "cross", label: t.fullscreen.details },
    ...(game ? [{ button: "triangle" as const, label: t.fullscreen.options, hold: t.fullscreen.holdLayout }] : []),
    { button: "l3", label: t.fullscreen.searchShort },
    { button: "create", label: t.fullscreen.hub, hold: t.fullscreen.holdQuickOptions },
    { button: "options", label: t.fullscreen.quickAccess, hold: t.fullscreen.holdSettings },
  ]

  return (
    <div hidden={!enabled} className="fullscreen-shell" data-testid="fullscreen-shell" data-aniki-view={hub ? "hub" : details ? "details" : "library"} data-aniki-color={config?.colorPreset ?? "default"} data-aniki-effects={config?.effects ?? "balanced"} data-aniki-interface={config?.interface ?? "standard"} style={dynamic as CSSProperties} onPointerMove={soundOnHover} onPointerLeave={() => { hovered.current = null }} onFocusCapture={soundOnFocus} onClickCapture={soundOnClick}>
      <AnikiAppearanceProvider value={config ?? { controllerIconStyle: "playstation", anikiAvatarIndex: null }}>
      <AnikiStage inert={screenSaverActive || lifecycle !== null || startupWaiting}>
      {/* No Aniki, o trailer fica no cartão dos detalhes (AnikiTrailerCard), não no fundo. */}
      <AnikiMedia game={game} context={screenSaverActive ? "screensaver" : panel === "login" ? "login" : panel === "profile" || panel === "trophyOverview" || panel === "achievements" ? "secondary" : hub ? "hub" : "library"} suspended={suspended || screenSaverActive && !config?.screenSaverAmbientMusicEnabled} />
      <section ref={panel || running.length > 0 ? undefined : scope} className="fs-main" inert={panel !== null || running.length > 0 || launching}>
        <AnikiTopBar games={games} hub={hub} detailsGame={details ? game : undefined} layoutLabel={!config ? null : details ? t.fullscreen.detailsLayouts[config.detailsLayout] : t.fullscreen.libraryLayouts[config.libraryLayout]} filtered={hasActiveFilters(filters) || sort !== "collection"} unseen={notices.unseen} onLayout={cycleLayout} onHub={() => { setHub(!hub); setDetails(false) }} onProfile={() => openPanel("profile", null)} onTrophies={() => openPanel(details ? "achievements" : "trophyOverview", null)} onSearch={() => setPanel("search")} onMenu={() => setPanel("menu")} onFilters={openFilters} onNotices={openNotices} />
        {hub && config ? <AnikiHub games={games} config={config} page={hubPage} onPageCount={setHubPageCount} onOpen={openDetails} /> : details && game && config ? <AnikiDetails
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
          onGallery={() => setPanel("gallery")}
          onDescription={() => setPanel("description")}
          onOptions={() => setPanel("options")}
          onReview={openReview}
        /> : <AnikiLibrary layout={config?.libraryLayout ?? "horizontal"} interfaceStyle={config?.interface ?? "standard"} trailer={config?.trailers === "all"} playVideo={!suspended && !panel} status={status} game={game} games={games} visible={visible} selectedId={resolvedId} query={query} collectionLabel={query ? t.fullscreen.searchResults : label(collection)} shortcuts={shortcuts} onSelect={setSelectedId} onOpen={openDetails} onClearSearch={clearSearch} onOpenEmulators={onOpenEmulators} />}
        {disconnected && <p role="status" className="aniki-disconnected">{t.fullscreen.disconnected}</p>}
      </section>
      {panel === "menu" && <div className="aniki-menu-shade" onClick={(event) => { if (event.target === event.currentTarget) closePanel() }}><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fullscreen.mainMenu}>
        <AnikiMainMenu canRandom={games.length > 0} updating={updating} onSettings={() => openPanel("preferences")} onRandom={randomGame} onMinimize={() => { closePanel(); window.api.windowControls.minimize() }} onDesktop={() => { closePanel(); onExit() }} onExit={() => window.api.windowControls.close()} onUpdate={() => void updateLibrary()} onHelp={() => openPanel("help")} onPower={(action) => { setPowerAction(action); openPanel("power") }} />
      </section></div>}
      {panel === "quickAccess" && <div className="aniki-menu-shade" onClick={(event) => { if (event.target === event.currentTarget) closePanel() }}><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fullscreen.quickAccess}>
        <AnikiQuickAccess canRandom={games.length > 0} updating={updating} onProfile={() => openPanel("profile")} onTrophies={() => openPanel("trophyOverview")} onSettings={() => openPanel("preferences")} onRandom={randomGame} onUpdate={() => void updateLibrary()} onPower={() => setPanel("menu")} onAudio={() => openPanel("audio")} onMusic={() => openPanel("music")} onNotices={openNotices} onHelp={() => openPanel("help")} onMaintenance={() => openPanel("maintenance")} onNews={() => openPanel("news")} />
      </section></div>}
      {panel === "quickOptions" && <div className="aniki-menu-shade" onClick={(event) => { if (event.target === event.currentTarget) closePanel() }}><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fullscreen.quickOptions} className="aniki-quick-options-panel">
        <AnikiQuickOptions />
      </section></div>}
      {panel === "preferences" && <div className="aniki-trophies-shade"><section ref={scope} role="dialog" aria-modal="true" aria-label={t.fullscreen.settings}>
        <AnikiSettings category={settingsCategory} onCategory={setSettingsCategory} onEditName={editName} onRunSetup={openSetup} onPreviewScreenSaver={() => screenSaver.current?.preview()} canPreviewScreenSaver={Boolean(config && screenSaverHasBackground(games, config.screenSaverSource, visible))} onCustomAvatar={() => openCustomMedia("customAvatar")} onGlobalSplash={() => openCustomMedia("customSplash")} onEditSplashDuration={(field) => { setSplashDurationField(field); setPanel("splashDuration"); setError(null) }} />
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
      {panel === "gallery" && game && <div className="aniki-trophies-shade"><section ref={scope} role="dialog" aria-modal="true" aria-label={t.gameMedia.title} className="aniki-gallery-panel">
        <button type="button" className="aniki-gallery-back" aria-label={t.fullscreen.back} onClick={back}><ArrowLeft /></button>
        <AnikiGallery ref={gallery} game={game} />
      </section></div>}
      {panel && !["menu", "description", "achievements", "quickAccess", "quickOptions", "profile", "trophyOverview", "preferences", "setup", "login", "gallery"].includes(panel) && <div className="fs-modal-shade"><section ref={scope} role="dialog" aria-modal="true" aria-label={panelTitle} className={`fs-modal fs-modal-${panel}`}>
        {panel === "splashDuration" && config && splashDurationField ? <FullscreenKeyboard title={splashDurationTitle} initial={String(config[splashDurationField])} onCancel={() => { setPanel("preferences"); setError(null) }} onApply={applySplashDuration} /> : panel === "profileName" && config ? <FullscreenKeyboard title={t.fullscreen.profileName} initial={nameReturn.current === "setup" && setupDraft ? setupDraft.profileName : config.profileName} onCancel={() => setPanel(nameReturn.current)} onApply={(text) => { if (nameReturn.current === "setup" && setupDraft) { setSetupDraft({ ...setupDraft, profileName: text.trim().slice(0, 32) }); setPanel("setup") } else void saveConfig({ profileName: text.trim() }).then(() => setPanel(nameReturn.current)) }} /> : panel === "search" ? <FullscreenKeyboard title={t.fullscreen.search} initial={query} onCancel={closePanel} onApply={(text) => { if (!query) searchReturn.current = { id: selectedId ?? resolvedId, details }; setQuery(text); setSelectedId(text ? null : searchReturn.current.id); setDetails(text ? false : searchReturn.current.details); closePanel() }} /> : panel === "review" && game ? <FullscreenKeyboard title={t.fullscreen.review} initial={game.review ?? ""} multiline onCancel={cancelReview} onApply={(text) => { const revision = reviewRevision.current; void mutate(async () => { await window.api.games.setEvaluation(game.id, { review: text || null }); if (revision === reviewRevision.current) { setPanel(reviewReturn.current); setError(null) } }) }} /> : <>
          <button type="button" className="fs-back" onClick={back}><ArrowLeft />{t.fullscreen.back}</button>
          {panel === "filters" && <PlaytroveFilters games={games} filters={filters} sort={sort} onFilters={setFilters} onSort={setSort} />}
          {panel === "notices" && <PlaytroveNotices notices={notices.notices} onClear={notices.clear} />}
          {panel === "help" && <AnikiHelp />}
          {panel === "audio" && <AnikiAudioPanel />}
          {panel === "music" && <AnikiMusicPlayer />}
          {panel === "maintenance" && <AnikiMaintenance ref={maintenance} />}
          {panel === "news" && <AnikiNews ref={news} api={window.api.anikiNews} labels={t.anikiNews} locale={t.locale} />}
          {customMediaTarget && <AnikiCustomMediaPicker ref={customMedia} target={customMediaTarget} game={game ?? undefined} />}
          {panel === "power" && powerAction && <PowerConfirm action={powerAction} onConfirm={() => void confirmPower()} onCancel={back} />}
          {panel === "options" && game && <><h2>{game.title}</h2><div className="fs-options">
            <button type="button" aria-pressed={game.favorite} disabled={editing} onClick={favorite}><Star />{t.fullscreen.favorite}</button>
            <h3>{t.fields.status}</h3><div className="fs-status-options">{statuses.map((item) => <button type="button" key={item.id} disabled={editing} aria-pressed={game.statusId === item.id} onClick={() => void mutate(() => window.api.games.setStatus(game.id, item.id))}>{item.name}</button>)}</div>
            {(["rating", "difficulty"] as const).map((field) => <div key={field} className="fs-score"><h3>{t.fields[field]}</h3><button type="button" disabled={editing} aria-label={t.fields[field] + " −"} onClick={() => void mutate(() => window.api.games.setEvaluation(game.id, { [field]: Math.max(1, (game[field] ?? 2) - 1) }))}>{"−"}</button><output>{game[field] !== null ? (game[field]! / 2).toLocaleString(t.locale) + " / 5" : "—"}</output><button type="button" disabled={editing} aria-label={t.fields[field] + " +"} onClick={() => void mutate(() => window.api.games.setEvaluation(game.id, { [field]: Math.min(10, (game[field] ?? 0) + 1) }))}>{"+"}</button><button type="button" disabled={editing} aria-label={t.fields[field] + ": " + t.common.clear} onClick={() => void mutate(() => window.api.games.setEvaluation(game.id, { [field]: null }))}>{t.common.clear}</button></div>)}
            <button type="button" onClick={openReview}>{t.fullscreen.editReview}</button>
            <button type="button" onClick={() => openCustomMedia("customLogo")}><FolderOpen />{t.anikiCustomMedia.logoTitle}</button>
            <button type="button" disabled={editing} onClick={() => void mutate(async () => { await window.api.metadata.download([game.id]); notices.push(t.fullscreen.metadataQueued(game.title)) })}><Download />{t.actions.downloadMetadata}</button>
            <button type="button" disabled={editing || !game.romPath} onClick={() => void mutate(() => window.api.games.showRom(game.id))}><FolderOpen />{t.actions.showRom}</button>
          </div></>}
        </>}
        {error && <p role="alert" className="fs-error">{error}</p>}
      </section></div>}
      {!panel && error && <p role="alert" className="fs-error fs-toast">{error}</p>}
      {notices.latest && panel !== "notices" && <div className="fs-notice-banner" aria-live="polite"><strong>{notices.latest.title}</strong>{notices.latest.description && <span>{notices.latest.description}</span>}</div>}
      {launching && <div className="fs-running" role="status"><Gamepad2 /><p>{t.fullscreen.launching}</p></div>}
      {!launching && running.length > 0 && <section ref={scope} className="fs-running" role="dialog" aria-modal="true" aria-label={t.fullscreen.runningSessionsTitle}><AnikiRunningSession ref={runningSession} games={games} runningIds={running} focused={enabled && active} /></section>}
      </AnikiStage>
      {config && <AnikiScreenSaver ref={screenSaver} config={config} games={games} filteredGames={visible} enabled={enabled} active={active} blocked={panel !== null || startupWaiting || lifecycle !== null} running={loadingRunning || running.length > 0 || launching} onActiveChange={setScreenSaverActive} />}
      {lifecycle && <AnikiLifecycleVideo kind={lifecycle} onComplete={finishLifecycle} />}
      </AnikiAppearanceProvider>
    </div>
  )
}
