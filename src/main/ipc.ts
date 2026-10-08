import { existsSync } from "node:fs"
import { release, version as windowsName } from "node:os"
import { app, BrowserWindow, dialog, ipcMain, net, shell } from "electron"
import {
  EXTERNAL_LINKS,
  IPC_CHANNELS,
  WINDOW_CONTROL_ACTIONS,
  type ExternalLink,
  type WindowControlAction,
  type WindowState,
} from "../shared/ipc"
import type { UnlockedAchievement } from "../shared/achievements"
import { isScore, MAX_REVIEW_LENGTH, type GameEvaluation } from "../shared/evaluation"
import { isLanguage, type Messages } from "../shared/i18n"
import { badgeUrl } from "./achievements/badges"
import { createRaClient, RA_ENDPOINTS, raTestEndpoints, type RaAccount } from "./achievements/client"
import { createAchievementsService } from "./achievements/service"
import { saveRaAccount } from "./achievements/store"
import { findTrophyDir } from "./achievements/trophyFiles"
import { copyTrophyIconResized, trophyIconUrl } from "./achievements/trophyIcons"
import { unlockedTrophies } from "./achievements/trophyStore"
import { syncTrophies } from "./achievements/trophySync"
import { getGameAchievements, getOverview, type AchievementImages } from "./achievements/views"
import type { EmulatorId, RomFolder, StatusRules } from "../shared/types"
import { bugReportUrl } from "./bugReport"
import { getDatabase } from "./database"
import { readPs3TrophySets } from "./discs"
import {
  fillMissingEmulators,
  getEmulatorPaths,
  getPreset,
  isEmulatorId,
  listEmulators,
  listRetroArchCores,
  setEmulatorPath,
} from "./emulators"
import { getLanguage, saveLanguage, t } from "./i18n"
import { getImagesDir } from "./imageProtocol"
import { getRunningGames, launchGame } from "./launcher"
import {
  createStatus,
  deleteStatus,
  getLaunchInfo,
  getLibrary,
  listGamesWithoutMetadata,
  renameStatus,
  reorderStatuses,
  saveGameEvaluation,
  setGameFavorite,
  setGameStatus,
  setStatusRules,
} from "./library"
import {
  getMetadataConfig,
  readMetadataCredentials,
  saveIgdbCredentials,
  saveSteamGridDbKey,
  setMetadataAutoDownload,
} from "./metadata/credentials"
import type { MetadataServices } from "./metadata/download"
import { DEFAULT_ENDPOINTS, testEndpoints, type Fetch } from "./metadata/http"
import { createIgdbSession, type IgdbCredentials, type IgdbSession } from "./metadata/igdb"
import { createMetadataQueue } from "./metadata/queue"
import { createSteamGridDbSession } from "./metadata/steamGridDb"
import { startPlaytimeSync } from "./playtimeSync"
import { getDailyPlaytime } from "./stats"
import { addRomFolder, listRomFolders, removeRomFolder, scanRomFolders } from "./romScanner"
import { getSetting, setSetting } from "./settings"
import { emulatorDetectionEnabled, systemDetectionSources } from "./systemSources"
import { testMode } from "./testMode"
import { createUpdateService } from "./updateService"
import { createUpdater, isPortable, STARTUP_CHECK_DELAY_MS } from "./updates"

let detectedOnce = false

// Metadados. Os testes do app trocam os serviços por um servidor de mentira (nunca no app instalado).
const metadataTestServer = testMode.metadataServer
const metadataEndpoints = metadataTestServer ? testEndpoints(metadataTestServer) : DEFAULT_ENDPOINTS
const netFetch: Fetch = (url, init) => net.fetch(url, init)
const raEndpoints = metadataTestServer ? raTestEndpoints(metadataTestServer) : RA_ENDPOINTS

/** A conexão com o IGDB fica guardada entre os downloads, para reaproveitar o token de acesso. */
let igdbSession: { key: string; session: IgdbSession } | null = null

function getIgdbSession(credentials: IgdbCredentials): IgdbSession {
  const key = `${credentials.clientId}:${credentials.clientSecret}`
  if (igdbSession?.key !== key) igdbSession = { key, session: createIgdbSession(netFetch, metadataEndpoints, credentials) }
  return igdbSession.session
}

/**
 * Os serviços de metadados com as chaves salvas agora. O libretro-thumbnails (capas dos jogos de
 * emulador) não precisa de chave, então sempre há o que baixar.
 */
function getMetadataServices(): MetadataServices {
  const { igdb, steamGridDbKey } = readMetadataCredentials(getDatabase())
  return {
    fetch: netFetch,
    endpoints: metadataEndpoints,
    igdb: igdb ? getIgdbSession(igdb) : null,
    steamGridDb: steamGridDbKey ? createSteamGridDbSession(netFetch, metadataEndpoints, steamGridDbKey) : null,
    imagesDir: getImagesDir(),
  }
}

/** Relê o tempo jogado nos emuladores (começa quando os canais são registrados). */
let syncPlaytime: () => void = () => undefined

/**
 * Conquistas: as do RetroAchievements (a cada 5 minutos e depois de fechar um jogo) e os troféus do
 * RPCS3 (a cada minuto e logo depois de fechar um jogo).
 */
const achievementsService = createAchievementsService({
  getDatabase,
  fetch: netFetch,
  endpoints: raEndpoints,
  imagesDir: getImagesDir,
  readTrophies: readRpcs3Trophies,
  onLibraryChanged: () => notifyLibraryChanged(),
  onStatus: (config) => sendToAllWindows(IPC_CHANNELS.achievementsStatus, config),
  onUnlocked: (achievements) => sendToAllWindows(IPC_CHANNELS.achievementsUnlocked, achievements),
})

/** Os endereços das insígnias (coloridas ou apagadas) e das imagens dos troféus que já estão no disco. */
const achievementImages: AchievementImages = {
  badge: (name, earned) => badgeUrl(getImagesDir(), name, earned),
  trophyIcon: (setId, trophyId) => trophyIconUrl(getImagesDir(), setId, trophyId),
}

/** Lê os troféus que o RPCS3 guardou (se ele estiver configurado na aba Emuladores). */
function readRpcs3Trophies(): { changed: boolean; unlocked: UnlockedAchievement[] } {
  const db = getDatabase()
  const rpcs3 = getEmulatorPaths(db).rpcs3
  if (!rpcs3) return { changed: false, unlocked: [] }
  const result = syncTrophies(db, {
    trophyDir: findTrophyDir(rpcs3),
    imagesDir: getImagesDir(),
    copyIcon: copyTrophyIconResized,
    readGameSets: readPs3TrophySets,
  })
  return { changed: result.changed, unlocked: unlockedTrophies(db, result.newlyUnlocked, achievementImages.trophyIcon) }
}

const metadataQueue = createMetadataQueue({
  getDatabase,
  getServices: getMetadataServices,
  onProgress: (progress) => sendToAllWindows(IPC_CHANNELS.metadataProgress, progress),
  onGameUpdated: () => notifyLibraryChanged(),
  delayMs: 250,
})

/** A atualização do app pelas releases do GitHub (o aviso de versão nova e Configurações → Sobre). */
const updateService = createUpdateService({
  updater: createUpdater(),
  portable: isPortable,
  autoCheck: {
    get: () => getSetting(getDatabase(), "updatesAutoCheck") !== "0",
    set: (enabled) => setSetting(getDatabase(), "updatesAutoCheck", enabled ? null : "0"),
  },
  openDownloadPage: () => void shell.openExternal(EXTERNAL_LINKS.releases),
  onChange: (status) => sendToAllWindows(IPC_CHANNELS.updatesStatus, status),
})

/** Registra as respostas do processo principal aos canais IPC. Chamado uma vez, na inicialização. */
export function registerIpcHandlers(): void {
  // Tempo jogado registrado pelos próprios emuladores (inclusive o que foi jogado fora do app).
  syncPlaytime = startPlaytimeSync(() => notifyLibraryChanged())
  achievementsService.start()

  // "app:version": devolve a versão que está no package.json.
  ipcMain.handle(IPC_CHANNELS.appVersion, () => app.getVersion())

  // "app:open-link": abre no navegador só os sites conhecidos (as páginas para criar as chaves).
  ipcMain.on(IPC_CHANNELS.appOpenLink, (_event, link: unknown) => {
    if (typeof link === "string" && Object.hasOwn(EXTERNAL_LINKS, link)) {
      void shell.openExternal(EXTERNAL_LINKS[link as ExternalLink])
    }
  })

  // "app:report-bug": o formulário de bug do GitHub, já com a versão do app e a do Windows.
  ipcMain.on(IPC_CHANNELS.appReportBug, () => {
    const windows = `${windowsName()} (${release()})`
    void shell.openExternal(bugReportUrl({ appVersion: app.getVersion(), portable: isPortable, windows }))
  })

  // Idioma (Configurações → Geral). Os nomes dos status padrão mudam junto, então a biblioteca é
  // pedida de novo.
  ipcMain.handle(IPC_CHANNELS.appGetLanguage, () => getLanguage())
  ipcMain.handle(IPC_CHANNELS.appSetLanguage, (_event, language: unknown) => {
    if (!isLanguage(language)) throw new Error(t().errors.invalidLanguage)
    saveLanguage(getDatabase(), language)
    notifyLibraryChanged()
  })

  // "window:controls": minimiza, maximiza/restaura ou fecha a janela que mandou a mensagem.
  ipcMain.on(IPC_CHANNELS.windowControls, (event, action: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !isWindowControlAction(action)) return

    switch (action) {
      case "minimize":
        win.minimize()
        break
      case "toggle-maximize":
        if (win.isMaximized()) win.unmaximize()
        else win.maximize()
        break
      case "close":
        win.close()
        break
    }
  })

  // "window:state": responde se a janela que perguntou está maximizada.
  ipcMain.handle(IPC_CHANNELS.windowState, (event): WindowState => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return { isMaximized: win?.isMaximized() ?? false }
  })

  // Biblioteca: jogos, status e regras.
  ipcMain.handle(IPC_CHANNELS.libraryGet, () => getLibrary(getDatabase()))

  ipcMain.handle(IPC_CHANNELS.gamesSetStatus, (_event, gameId: unknown, statusId: unknown) => {
    setGameStatus(getDatabase(), toId(gameId), toId(statusId))
    notifyLibraryChanged()
  })

  // Status (Configurações → Status).
  ipcMain.handle(IPC_CHANNELS.statusesCreate, (_event, name: unknown) => {
    const status = createStatus(getDatabase(), toText(name))
    notifyLibraryChanged()
    return status
  })
  ipcMain.handle(IPC_CHANNELS.statusesRename, (_event, id: unknown, name: unknown) => {
    renameStatus(getDatabase(), toId(id), toText(name))
    notifyLibraryChanged()
  })
  ipcMain.handle(IPC_CHANNELS.statusesReorder, (_event, ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error(t().errors.invalidOrder)
    reorderStatuses(getDatabase(), ids.map(toId))
    notifyLibraryChanged()
  })
  ipcMain.handle(IPC_CHANNELS.statusesDelete, (_event, id: unknown, moveToId: unknown) => {
    deleteStatus(getDatabase(), toId(id), toId(moveToId))
    notifyLibraryChanged()
  })
  ipcMain.handle(IPC_CHANNELS.statusesSetRules, (_event, rules: unknown) => {
    const { newGameStatusId, firstPlayStatusId } = (rules ?? {}) as Partial<StatusRules>
    setStatusRules(getDatabase(), { newGameStatusId: toId(newGameStatusId), firstPlayStatusId: toId(firstPlayStatusId) })
    notifyLibraryChanged()
  })

  // Emuladores.
  ipcMain.handle(IPC_CHANNELS.emulatorsList, () => {
    // Na primeira vez em cada execução, procura sozinho os emuladores que ainda não têm executável.
    if (emulatorDetectionEnabled && !detectedOnce) {
      detectedOnce = true
      fillMissingEmulators(getDatabase(), systemDetectionSources())
    }
    return listEmulators(getDatabase())
  })
  ipcMain.handle(IPC_CHANNELS.emulatorsDetect, () => {
    if (emulatorDetectionEnabled) fillMissingEmulators(getDatabase(), systemDetectionSources())
    return listEmulators(getDatabase())
  })
  ipcMain.handle(IPC_CHANNELS.emulatorsPickPath, async (event, id: unknown) => {
    const emulatorId = toEmulatorId(id)
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: t().dialogs.pickEmulator(getPreset(emulatorId).name),
      properties: ["openFile"],
      filters: [{ name: t().dialogs.programs, extensions: ["exe"] }],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const path = result.filePaths[0]
    if (!result.canceled && path) {
      setEmulatorPath(getDatabase(), emulatorId, path)
      if (emulatorId === "rpcs3") achievementsService.readTrophies()
    }
    return listEmulators(getDatabase())
  })
  ipcMain.handle(IPC_CHANNELS.emulatorsCores, () => {
    const path = getEmulatorPaths(getDatabase()).retroarch
    return path && existsSync(path) ? listRetroArchCores(path) : []
  })

  // Pastas de ROMs.
  ipcMain.handle(IPC_CHANNELS.romFoldersList, () => listRomFolders(getDatabase()))
  ipcMain.handle(IPC_CHANNELS.romFoldersPick, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { title: t().dialogs.pickRomFolder, properties: ["openDirectory"] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC_CHANNELS.romFoldersAdd, (_event, folder: unknown) => {
    const { path, emulatorId, core, platform } = (folder ?? {}) as Partial<RomFolder>
    return addRomFolder(getDatabase(), {
      path: toText(path),
      emulatorId: toEmulatorId(emulatorId),
      core: core === null || core === undefined ? null : toText(core),
      platform: toText(platform),
    })
  })
  ipcMain.handle(IPC_CHANNELS.romFoldersRemove, (_event, id: unknown) => removeRomFolder(getDatabase(), toId(id)))
  ipcMain.handle(IPC_CHANNELS.romFoldersScan, (_event, id: unknown) => {
    const db = getDatabase()
    const result = scanRomFolders(db, id === null ? undefined : [toId(id)])
    if (result.added.length > 0) {
      notifyLibraryChanged()
      // Os jogos novos já ganham os metadados, se o usuário deixou (Configurações → Metadados),
      // e o tempo que os emuladores já registraram para eles.
      if (getMetadataConfig(db).autoDownload) metadataQueue.enqueue(result.addedIds)
      syncPlaytime()
      achievementsService.readTrophies()
    }
    return result
  })

  // Jogar: abre o jogo no emulador e avisa a interface quando ele abre e fecha.
  ipcMain.handle(IPC_CHANNELS.gamesPlay, (_event, gameId: unknown) =>
    launchGame(getDatabase(), toId(gameId), () => {
      sendToAllWindows(IPC_CHANNELS.gamesRunning, getRunningGames())
      notifyLibraryChanged()
      // O emulador grava o tempo dele ao fechar: relê um pouco depois, para o total bater.
      setTimeout(() => syncPlaytime(), PLAYTIME_SYNC_DELAY_MS).unref()
      achievementsService.afterGameClosed()
    })
  )
  ipcMain.handle(IPC_CHANNELS.gamesRunning, () => getRunningGames())

  ipcMain.handle(IPC_CHANNELS.gamesSetFavorite, (_event, gameId: unknown, favorite: unknown) => {
    if (typeof favorite !== "boolean") throw new Error(t().errors.invalidValue)
    setGameFavorite(getDatabase(), toId(gameId), favorite)
    notifyLibraryChanged()
  })
  ipcMain.handle(IPC_CHANNELS.gamesSetEvaluation, (_event, gameId: unknown, evaluation: unknown) => {
    saveGameEvaluation(getDatabase(), toId(gameId), toEvaluation(evaluation))
    notifyLibraryChanged()
  })
  ipcMain.handle(IPC_CHANNELS.gamesShowRom, (_event, gameId: unknown) => {
    const { romPath } = getLaunchInfo(getDatabase(), toId(gameId))
    if (!romPath) throw new Error(t().errors.noRom)
    if (!existsSync(romPath)) throw new Error(t().errors.romNotFound(romPath))
    shell.showItemInFolder(romPath)
  })

  // Metadados: as chaves são conferidas (com um pedido de teste) antes de serem salvas.
  ipcMain.handle(IPC_CHANNELS.metadataGetConfig, () => getMetadataConfig(getDatabase()))
  ipcMain.handle(IPC_CHANNELS.metadataSetIgdb, async (_event, value: unknown) => {
    const credentials = toIgdbCredentials(value)
    if (credentials) await createIgdbSession(netFetch, metadataEndpoints, credentials).validate()
    saveIgdbCredentials(getDatabase(), credentials)
    return getMetadataConfig(getDatabase())
  })
  ipcMain.handle(IPC_CHANNELS.metadataSetSteamGridDb, async (_event, value: unknown) => {
    const key = value === null ? null : toSecret(value, "steamGridDbKey")
    if (key) await createSteamGridDbSession(netFetch, metadataEndpoints, key).validate()
    saveSteamGridDbKey(getDatabase(), key)
    return getMetadataConfig(getDatabase())
  })
  // Atualização do app: a situação, procurar agora, instalar a versão encontrada e a procura ao abrir
  // (que começa alguns segundos depois de o app abrir, para não atrasar a abertura).
  ipcMain.handle(IPC_CHANNELS.updatesStatus, () => updateService.getStatus())
  ipcMain.handle(IPC_CHANNELS.updatesCheck, () => updateService.check())
  ipcMain.handle(IPC_CHANNELS.updatesInstall, () => updateService.install())
  ipcMain.handle(IPC_CHANNELS.updatesSetAutoCheck, (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error(t().errors.invalidValue)
    updateService.setAutoCheck(enabled)
  })
  setTimeout(() => void updateService.checkOnStartup(), STARTUP_CHECK_DELAY_MS).unref()

  ipcMain.handle(IPC_CHANNELS.metadataSetAutoDownload, (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error(t().errors.invalidValue)
    setMetadataAutoDownload(getDatabase(), enabled)
    return getMetadataConfig(getDatabase())
  })
  ipcMain.handle(IPC_CHANNELS.metadataDownload, (_event, ids: unknown) => {
    const gameIds = ids === null ? listGamesWithoutMetadata(getDatabase()) : toIdList(ids)
    return metadataQueue.enqueue(gameIds)
  })
  ipcMain.handle(IPC_CHANNELS.metadataProgress, () => metadataQueue.getProgress())

  // Conquistas: a conta é conferida no RetroAchievements antes de ser salva.
  ipcMain.handle(IPC_CHANNELS.achievementsGetConfig, () => achievementsService.config())
  ipcMain.handle(IPC_CHANNELS.achievementsSetAccount, async (_event, value: unknown) => {
    const account = toRaAccount(value)
    if (account) await createRaClient(netFetch, raEndpoints, account).validate()
    saveRaAccount(getDatabase(), account)
    notifyLibraryChanged()
    if (account) void achievementsService.sync(true)
    return achievementsService.config()
  })
  ipcMain.handle(IPC_CHANNELS.achievementsSync, () => achievementsService.sync(true))
  ipcMain.handle(IPC_CHANNELS.achievementsGame, (_event, gameId: unknown) =>
    getGameAchievements(getDatabase(), toId(gameId), achievementImages)
  )
  ipcMain.handle(IPC_CHANNELS.achievementsOverview, () => getOverview(getDatabase(), achievementImages))

  // Estatísticas: a atividade dos últimos 30 dias (o resto é calculado na interface, com os jogos).
  ipcMain.handle(IPC_CHANNELS.statsDailyPlaytime, () => getDailyPlaytime(getDatabase(), ACTIVITY_DAYS))
}

/** Quantos dias o gráfico de atividade mostra. */
const ACTIVITY_DAYS = 30

/** Quanto o app espera, depois de o jogo fechar, para reler o tempo registrado pelo emulador. */
const PLAYTIME_SYNC_DELAY_MS = 3000

/**
 * Avisa a interface pelo canal "window:state" sempre que a janela maximizar ou restaurar,
 * seja pelo botão, por duplo clique na barra do topo ou por atalhos do Windows (Win+↑).
 */
export function sendWindowStateChanges(win: BrowserWindow): void {
  const send = () => {
    const state: WindowState = { isMaximized: win.isMaximized() }
    win.webContents.send(IPC_CHANNELS.windowState, state)
  }
  win.on("maximize", send)
  win.on("unmaximize", send)
}

/** Avisa todas as janelas que a biblioteca mudou (elas pedem os dados de novo). */
function notifyLibraryChanged(): void {
  sendToAllWindows(IPC_CHANNELS.libraryChanged)
}

/** Manda um aviso do main para a interface, em todas as janelas. */
function sendToAllWindows(channel: string, data?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, data)
}

/** Confere se o valor que veio da interface é uma ação conhecida (nunca confie cegamente no renderer). */
function isWindowControlAction(value: unknown): value is WindowControlAction {
  return WINDOW_CONTROL_ACTIONS.includes(value as WindowControlAction)
}

/** Confere se o valor que veio da interface é um id (número inteiro positivo). */
function toId(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(t().errors.invalidId)
  return value
}

/**
 * Confere a avaliação que veio da interface: só as partes enviadas, com a nota e a dificuldade de 1
 * a 10 (ou null) e a análise de até MAX_REVIEW_LENGTH caracteres (ou null).
 */
function toEvaluation(value: unknown): GameEvaluation {
  const { errors, locale } = t()
  if (typeof value !== "object" || value === null) throw new Error(errors.invalidEvaluation)
  const { rating, difficulty, review } = value as Record<string, unknown>
  const changes: GameEvaluation = {}
  if (rating !== undefined) {
    if (rating !== null && !isScore(rating)) throw new Error(errors.invalidRating)
    changes.rating = rating
  }
  if (difficulty !== undefined) {
    if (difficulty !== null && !isScore(difficulty)) throw new Error(errors.invalidDifficulty)
    changes.difficulty = difficulty
  }
  if (review !== undefined) {
    if (review !== null && typeof review !== "string") throw new Error(errors.invalidReview)
    if (typeof review === "string" && review.length > MAX_REVIEW_LENGTH) {
      throw new Error(errors.reviewTooLong(MAX_REVIEW_LENGTH.toLocaleString(locale)))
    }
    changes.review = review
  }
  return changes
}

/** Confere a conta do RetroAchievements que veio da interface (null = apagar a conta). */
function toRaAccount(value: unknown): RaAccount | null {
  if (value === null) return null
  if (typeof value !== "object") throw new Error(t().errors.invalidAccount)
  const { username, apiKey } = value as Record<string, unknown>
  const name = typeof username === "string" ? username.trim() : ""
  if (!/^[\w.-]{2,32}$/.test(name)) throw new Error(t().errors.raUsername)
  return { username: name, apiKey: toSecret(apiKey, "raApiKey") }
}

/** Confere se o valor que veio da interface é um emulador conhecido. */
function toEmulatorId(value: unknown): EmulatorId {
  if (!isEmulatorId(value)) throw new Error(t().errors.unknownEmulator)
  return value
}

/** Confere se o valor que veio da interface é um texto. */
function toText(value: unknown): string {
  if (typeof value !== "string") throw new Error(t().errors.invalidText)
  return value
}

/** Confere se o valor que veio da interface é uma lista de ids. */
function toIdList(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error(t().errors.invalidGameList)
  return value.map(toId)
}

/** Confere uma chave que veio da interface: um texto, sem os espaços das pontas e de tamanho razoável. */
function toSecret(value: unknown, field: keyof Messages["errors"]["keyFields"]): string {
  const { errors } = t()
  const text = typeof value === "string" ? value.trim() : ""
  if (!text) throw new Error(errors.fillIn(errors.keyFields[field]))
  if (text.length > 200) throw new Error(errors.tooLong(errors.keyFields[field]))
  return text
}

/** Confere o Client ID e o Client Secret do IGDB que vieram da interface (null = apagar). */
function toIgdbCredentials(value: unknown): IgdbCredentials | null {
  if (value === null) return null
  const { clientId, clientSecret } = (value ?? {}) as Partial<IgdbCredentials>
  return { clientId: toSecret(clientId, "igdbClientId"), clientSecret: toSecret(clientSecret, "igdbClientSecret") }
}
