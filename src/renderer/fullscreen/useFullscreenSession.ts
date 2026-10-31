import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent } from "react"
import type { PowerAction } from "@shared/fullscreen"
import type { Game } from "@shared/types"
import { useI18n } from "@/hooks/useI18n"
import { useStatuses } from "@/hooks/useStatuses"
import { useRunningGamesState } from "@/hooks/useRunningGames"
import { useFullscreenActive, useFullscreenInput } from "@/hooks/useFullscreenInput"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { useFullscreenNotices } from "@/hooks/useFullscreenNotices"
import { fullscreenGames, restoreFullscreenSelection, sortFullscreenGames, type FullscreenAction, type FullscreenCollection, type FullscreenSort } from "@/lib/fullscreenNavigation"
import { EMPTY_FILTERS, filterGames, type LibraryFilters } from "@/lib/filters"
import { UiSounds, type UiSound } from "@/lib/uiSounds"
import { FullscreenLaunchGuard } from "@/lib/fullscreenSession"

type FullscreenPanel = "preferences" | "options" | "search" | "review" | "achievements" | "trophies" | "menu" | "theme" | "power" | "filters" | "help" | "notices" | null
export interface FullscreenShellProps { enabled: boolean; games: Game[]; initialGameId: number | null; onExit: () => void; onOpenEmulators: () => void }
export const FULLSCREEN_COLLECTIONS: FullscreenCollection[] = ["all", "recent", "favorites"]

/**
 * O que todos os temas da tela cheia dividem: a coleção, a busca, os filtros, a seleção, os detalhes, os painéis, o
 * Jogar, as mudanças no jogo, os sons e o controle. Cada tema só desenha a tela com isso.
 */
export function useFullscreenSession({ enabled, games, initialGameId, onExit }: FullscreenShellProps) {
  const { t } = useI18n()
  const statuses = useStatuses()
  const [collection, setCollection] = useState<FullscreenCollection>("all")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(initialGameId)
  const [details, setDetails] = useState(false)
  const [panel, setPanel] = useState<FullscreenPanel>(null)
  const [error, setError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [editing, setEditing] = useState(false)
  const [disconnected, setDisconnected] = useState(false)
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<FullscreenSort>("collection")
  const [powerAction, setPowerAction] = useState<PowerAction | null>(null)
  const [updating, setUpdating] = useState(false)
  const { config } = useFullscreenConfig()
  const notices = useFullscreenNotices()
  const sounds = useRef(new UiSounds())
  // Painéis abertos pelo menu principal voltam para ele com ○, como no Playnite.
  const fromMenu = useRef(false)
  // O foco que a própria tela move (ao abrir um painel, por exemplo) não toca o som de mover.
  const programmaticFocus = useRef(false)
  const hovered = useRef<Element | null>(null)
  const scope = useRef<HTMLElement>(null)
  const launchGuard = useRef(new FullscreenLaunchGuard())
  const launchedId = useRef<number | null>(null)
  const searchReturn = useRef<{ id: number | null; details: boolean }>({ id: null, details: false })
  const reviewReturn = useRef<FullscreenPanel>(null)
  const reviewRevision = useRef(0)
  const collectionSelections = useRef<Partial<Record<FullscreenCollection, number | null>>>({ all: initialGameId })
  const visible = sortFullscreenGames(filterGames(fullscreenGames(games, collection, query), "", filters), sort, t.locale)
  const resolvedId = restoreFullscreenSelection(visible, selectedId)
  const game = games.find((item) => item.id === (details ? selectedId : resolvedId))
  const active = useFullscreenActive()
  const { running, loading: loadingRunning } = useRunningGamesState()
  const busy = running.length > 0 || launching
  const suspended = !enabled || !active || loadingRunning || busy
  const theme = config?.theme ?? "playtrove"
  const context = `${theme}:${details ? "details" : "library"}:${panel ?? "main"}:${details ? game?.id : collection}`
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
    programmaticFocus.current = true
    target?.focus()
    programmaticFocus.current = false
    target?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" })
  }, [context, active, suspended])

  useEffect(() => () => sounds.current.dispose(), [])
  const sound = (kind: UiSound) => { if (config?.uiSounds && !suspended) sounds.current.play(kind, config.uiSoundsVolume / 100, theme) }
  const interactive = (target: EventTarget) => target instanceof Element ? target.closest("button:not(:disabled), [tabindex='0']") : null
  // Como no Playnite: passar o mouse ou mover o foco por capas e botões toca o som de mover, e confirmar (clique,
  // ✕ ou Enter) toca o de confirmar. O ✕ e o Enter chegam aqui como clique no item com o foco.
  // Pelo movimento do mouse, e não pela entrada no elemento: a tela mudar embaixo do mouse parado (ex.: os detalhes
  // abrindo) também avisa a entrada, mas não conta como passar por um item.
  const rootProps = {
    hidden: !enabled,
    "data-testid": "fullscreen-shell",
    "data-fs-theme": theme,
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const target = interactive(event.target)
      if (target === hovered.current) return
      hovered.current = target
      if (target) sound("move")
    },
    onPointerLeave: () => { hovered.current = null },
    onFocusCapture: (event: FocusEvent<HTMLDivElement>) => {
      if (!programmaticFocus.current && interactive(event.target) && event.target !== hovered.current) sound("move")
    },
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => { if (interactive(event.target)) sound("confirm") },
  }
  const closePanel = () => { reviewRevision.current++; fromMenu.current = false; setPanel(null); setError(null) }
  const openFromMenu = (next: FullscreenPanel) => { fromMenu.current = true; setPanel(next); setError(null) }
  const openNotices = () => { notices.markSeen(); setPanel("notices") }
  const clearSearch = () => { setQuery(""); setSelectedId(searchReturn.current.id); setDetails(searchReturn.current.details) }
  const applySearch = (text: string) => {
    if (!query) searchReturn.current = { id: selectedId ?? resolvedId, details }
    setQuery(text)
    setSelectedId(text ? null : searchReturn.current.id)
    setDetails(text ? false : searchReturn.current.details)
    closePanel()
  }
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
    else if (panel && panel !== "menu" && fromMenu.current) { fromMenu.current = false; setPanel("menu"); setError(null) }
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
  const saveReview = (text: string) => {
    if (!game) return
    const revision = reviewRevision.current
    void mutate(async () => { await window.api.games.setEvaluation(game.id, { review: text || null }); if (revision === reviewRevision.current) closePanel() })
  }
  const randomGame = () => {
    if (!games.length) return
    closePanel()
    openDetails(games[Math.floor(Math.random() * games.length)].id)
  }
  const updateLibrary = async () => {
    if (updating) return
    setUpdating(true)
    try { await window.api.romFolders.scan(); notices.push(t.fullscreen.libraryUpdated); closePanel() }
    catch (reason) { setError(String(reason)) }
    finally { setUpdating(false) }
  }
  const askPower = (next: PowerAction) => { setPowerAction(next); openFromMenu("power") }
  const confirmPower = async () => {
    if (!powerAction) return
    try { await window.api.system.power(powerAction); closePanel() }
    catch (reason) { setError(String(reason)) }
  }
  /** Joga `target` (o jogo escolhido, se não vier outro): o Continuar jogando do Painel abre outro jogo direto. */
  const play = async (target: Game | undefined = game) => {
    if (!target || launching || loadingRunning || running.length > 0) return
    setLaunching(true)
    setError(null)
    try {
      // Confirmar o estado no serviço evita abrir outra sessão entre dois eventos do renderer.
      launchedId.current = target.id
      if (!await launchGuard.current.play(target.id, window.api.games)) launchedId.current = null
    } catch (reason) { launchedId.current = null; setError(String(reason)) }
    finally { setLaunching(false) }
  }
  const action = (event: FullscreenAction) => {
    if (event === "circle") sound("back")
    else if ((event === "options" || event === "square") && !panel) sound("open")
    if (event === "circle") { back(); return true }
    // Create no controle e F11 no teclado ("window") voltam ao modo janela.
    if (event === "create" || event === "window") { onExit(); return true }
    if (event === "options") { if (panel === "menu") closePanel(); else if (!panel) setPanel("menu"); return true }
    if (event === "square" && !panel) { setPanel("search"); return true }
    if (event === "triangle" && !panel) { favorite(); return true }
    if ((event === "l1" || event === "r1") && !panel && !details) {
      changeCollection(FULLSCREEN_COLLECTIONS[(FULLSCREEN_COLLECTIONS.indexOf(collection) + (event === "r1" ? 1 : 2)) % FULLSCREEN_COLLECTIONS.length])
      return true
    }
    return false
  }
  useFullscreenInput(scope, !suspended, context, action, config?.swapConfirm ?? false)
  const canPlay = (target: Game | undefined = game) => Boolean(target?.romPath && target.emulatorId) && !loadingRunning && !busy

  return {
    t, statuses, config, theme, notices, games, scope, rootProps,
    collection, changeCollection, label, query, clearSearch, applySearch, filters, setFilters, sort, setSort,
    visible, resolvedId, selectedId, setSelectedId, game, details, setDetails, openDetails,
    panel, setPanel, closePanel, openFromMenu, openNotices, back, error,
    editing, mutate, favorite, openReview, cancelReview, saveReview, randomGame, updating, updateLibrary,
    powerAction, askPower, confirmPower, launching, running, busy, suspended, play, canPlay, disconnected, onExit,
    status: statuses.find((item) => item.id === game?.statusId)?.name,
  }
}

export type FullscreenSession = ReturnType<typeof useFullscreenSession>
/** O que cada tema recebe: a sessão (que continua a mesma ao trocar de tema) e o caminho até a aba Emuladores. */
export interface FullscreenThemeProps { session: FullscreenSession; onOpenEmulators: () => void }
