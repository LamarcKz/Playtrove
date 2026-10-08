import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import { IPC_CHANNELS, type AppApi, type WindowControlAction, type WindowState } from "../shared/ipc"
import type { MetadataProgress, UpdateStatus } from "../shared/types"

// O preload é a ponte segura entre o React e o Electron. O React não tem acesso ao Node:
// ele só enxerga as funções abaixo, em window.api. Nunca exponha o ipcRenderer inteiro.

function sendWindowControl(action: WindowControlAction): void {
  ipcRenderer.send(IPC_CHANNELS.windowControls, action)
}

/** Ouve um aviso do main sem repassar o "event" do Electron. Devolve a função que para de ouvir. */
function listen<T>(channel: string, callback: (data: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: AppApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appVersion),
    openLink: (link) => ipcRenderer.send(IPC_CHANNELS.appOpenLink, link),
    reportBug: () => ipcRenderer.send(IPC_CHANNELS.appReportBug),
    getLanguage: () => ipcRenderer.invoke(IPC_CHANNELS.appGetLanguage),
    setLanguage: (language) => ipcRenderer.invoke(IPC_CHANNELS.appSetLanguage, language),
  },
  windowControls: {
    minimize: () => sendWindowControl("minimize"),
    toggleMaximize: () => sendWindowControl("toggle-maximize"),
    close: () => sendWindowControl("close"),
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.windowState),
    onStateChange: (callback) => listen<WindowState>(IPC_CHANNELS.windowState, callback),
  },
  library: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.libraryGet),
    onChange: (callback) => listen(IPC_CHANNELS.libraryChanged, () => callback()),
  },
  games: {
    setStatus: (gameId, statusId) => ipcRenderer.invoke(IPC_CHANNELS.gamesSetStatus, gameId, statusId),
    play: (gameId) => ipcRenderer.invoke(IPC_CHANNELS.gamesPlay, gameId),
    getRunning: () => ipcRenderer.invoke(IPC_CHANNELS.gamesRunning),
    onRunningChange: (callback) => listen<number[]>(IPC_CHANNELS.gamesRunning, callback),
    setFavorite: (gameId, favorite) => ipcRenderer.invoke(IPC_CHANNELS.gamesSetFavorite, gameId, favorite),
    setEvaluation: (gameId, evaluation) => ipcRenderer.invoke(IPC_CHANNELS.gamesSetEvaluation, gameId, evaluation),
    showRom: (gameId) => ipcRenderer.invoke(IPC_CHANNELS.gamesShowRom, gameId),
  },
  metadata: {
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.metadataGetConfig),
    setIgdb: (credentials) => ipcRenderer.invoke(IPC_CHANNELS.metadataSetIgdb, credentials),
    setSteamGridDb: (key) => ipcRenderer.invoke(IPC_CHANNELS.metadataSetSteamGridDb, key),
    setAutoDownload: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.metadataSetAutoDownload, enabled),
    download: (gameIds) => ipcRenderer.invoke(IPC_CHANNELS.metadataDownload, gameIds ?? null),
    getProgress: () => ipcRenderer.invoke(IPC_CHANNELS.metadataProgress),
    onProgress: (callback) => listen<MetadataProgress>(IPC_CHANNELS.metadataProgress, callback),
  },
  emulators: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.emulatorsList),
    detect: () => ipcRenderer.invoke(IPC_CHANNELS.emulatorsDetect),
    pickPath: (id) => ipcRenderer.invoke(IPC_CHANNELS.emulatorsPickPath, id),
    cores: () => ipcRenderer.invoke(IPC_CHANNELS.emulatorsCores),
  },
  romFolders: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.romFoldersList),
    pick: () => ipcRenderer.invoke(IPC_CHANNELS.romFoldersPick),
    add: (folder) => ipcRenderer.invoke(IPC_CHANNELS.romFoldersAdd, folder),
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.romFoldersRemove, id),
    scan: (id) => ipcRenderer.invoke(IPC_CHANNELS.romFoldersScan, id ?? null),
  },
  stats: {
    dailyPlaytime: () => ipcRenderer.invoke(IPC_CHANNELS.statsDailyPlaytime),
  },
  achievements: {
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.achievementsGetConfig),
    setAccount: (account) => ipcRenderer.invoke(IPC_CHANNELS.achievementsSetAccount, account),
    sync: () => ipcRenderer.invoke(IPC_CHANNELS.achievementsSync),
    game: (gameId) => ipcRenderer.invoke(IPC_CHANNELS.achievementsGame, gameId),
    overview: () => ipcRenderer.invoke(IPC_CHANNELS.achievementsOverview),
    onStatus: (callback) => listen(IPC_CHANNELS.achievementsStatus, callback),
    onUnlocked: (callback) => listen(IPC_CHANNELS.achievementsUnlocked, callback),
  },
  updates: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.updatesStatus),
    check: () => ipcRenderer.invoke(IPC_CHANNELS.updatesCheck),
    install: () => ipcRenderer.invoke(IPC_CHANNELS.updatesInstall),
    setAutoCheck: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.updatesSetAutoCheck, enabled),
    onStatus: (callback) => listen<UpdateStatus>(IPC_CHANNELS.updatesStatus, callback),
  },
  statuses: {
    create: (name) => ipcRenderer.invoke(IPC_CHANNELS.statusesCreate, name),
    rename: (id, name) => ipcRenderer.invoke(IPC_CHANNELS.statusesRename, id, name),
    reorder: (ids) => ipcRenderer.invoke(IPC_CHANNELS.statusesReorder, ids),
    remove: (id, moveToId) => ipcRenderer.invoke(IPC_CHANNELS.statusesDelete, id, moveToId),
    setRules: (rules) => ipcRenderer.invoke(IPC_CHANNELS.statusesSetRules, rules),
  },
}

contextBridge.exposeInMainWorld("api", api)
