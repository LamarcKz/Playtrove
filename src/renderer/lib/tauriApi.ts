import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { EVENTS, type AppApi } from "@shared/ipc"

/** Ouve um aviso do Rust. Devolve uma função para parar de ouvir. */
function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let stopped = false
  let unlisten: (() => void) | undefined
  void listen<T>(event, (message) => callback(message.payload)).then((stop) => {
    if (stopped) stop()
    else unlisten = stop
  })
  return () => {
    stopped = true
    unlisten?.()
  }
}

/**
 * O `window.api`: cada função chama o comando do Rust de mesmo nome, em snake_case
 * (src-tauri/src/commands.rs), e os avisos chegam pelos nomes de EVENTS.
 */
export function createTauriApi(): AppApi {
  return {
    app: {
      getVersion: () => invoke("app_version"),
      openLink: (link) => void invoke("app_open_link", { link }),
      reportBug: () => void invoke("app_report_bug"),
      getLanguage: () => invoke("app_get_language"),
      setLanguage: (language) => invoke("app_set_language", { language }),
    },
    windowControls: {
      minimize: () => void invoke("window_minimize"),
      toggleMaximize: () => void invoke("window_toggle_maximize"),
      close: () => void invoke("window_close"),
      getState: () => invoke("window_get_state"),
      setFullscreen: (enabled) => invoke("window_set_fullscreen", { enabled }),
      onStateChange: (callback) => subscribe(EVENTS.windowState, callback),
    },
    fullscreen: {
      getConfig: () => invoke("fullscreen_get_config"),
      setConfig: (patch) => invoke("fullscreen_set_config", { patch }),
      onConfigChange: (callback) => subscribe(EVENTS.fullscreenConfig, callback),
    },
    system: {
      power: (action) => invoke("system_power", { action }),
    },
    themes: {
      anikiStatus: () => invoke("themes_aniki_status"),
      installAniki: () => invoke("themes_aniki_install"),
      cancelAniki: () => invoke("themes_aniki_cancel"),
      removeAniki: () => invoke("themes_aniki_remove"),
      onAnikiProgress: (callback) => subscribe(EVENTS.anikiProgress, callback),
      enterAniki: () => invoke("aniki_enter"),
    },
    library: {
      get: () => invoke("library_get"),
      onChange: (callback) => subscribe(EVENTS.libraryChanged, () => callback()),
    },
    games: {
      setStatus: (gameId, statusId) => invoke("games_set_status", { gameId, statusId }),
      play: (gameId) => invoke("games_play", { gameId }),
      getRunning: () => invoke("games_get_running"),
      onRunningChange: (callback) => subscribe(EVENTS.gamesRunning, callback),
      setFavorite: (gameId, favorite) => invoke("games_set_favorite", { gameId, favorite }),
      showRom: (gameId) => invoke("games_show_rom", { gameId }),
      setEvaluation: (gameId, evaluation) => invoke("games_set_evaluation", { gameId, evaluation }),
      pickBackgroundVideo: (gameId) => invoke("games_pick_background_video", { gameId }),
      accentColor: (gameId) => invoke("games_accent_color", { gameId }),
      removeBackgroundVideo: (gameId) => invoke("games_remove_background_video", { gameId }),
      useAutomaticBackgroundVideo: (gameId) => invoke("games_use_automatic_background_video", { gameId }),
      pickThemeMusic: (gameId) => invoke("games_pick_theme_music", { gameId }),
      removeThemeMusic: (gameId) => invoke("games_remove_theme_music", { gameId }),
      useAutomaticThemeMusic: (gameId) => invoke("games_use_automatic_theme_music", { gameId }),
    },
    music: {
      getReviews: () => invoke("music_get_reviews"),
      search: (gameId, query) => invoke("music_search", { gameId, query: query ?? null }),
      preview: (gameId, generation, videoId, operationId) => invoke("music_preview", { gameId, generation, videoId, operationId: operationId ?? null }),
      choose: (gameId, generation, videoId, operationId) => invoke("music_choose", { gameId, generation, videoId, operationId: operationId ?? null }),
      cancelPreview: () => invoke("music_cancel_preview"),
      getConfig: () => invoke("music_get_config"),
      setConfig: (config) => invoke("music_set_config", { config }),
      onConfigChange: (callback) => subscribe(EVENTS.musicConfig, callback),
      download: () => invoke("music_download"),
    },
    metadata: {
      getConfig: () => invoke("metadata_get_config"),
      setIgdb: (credentials) => invoke("metadata_set_igdb", { credentials }),
      setSteamGridDb: (key) => invoke("metadata_set_steam_grid_db", { key }),
      setAutoDownload: (enabled) => invoke("metadata_set_auto_download", { enabled }),
      download: (gameIds) => invoke("metadata_download", { gameIds: gameIds ?? null }),
      getProgress: () => invoke("metadata_get_progress"),
      onProgress: (callback) => subscribe(EVENTS.metadataProgress, callback),
    },
    emulators: {
      list: () => invoke("emulators_list"),
      detect: () => invoke("emulators_detect"),
      pickPath: (id) => invoke("emulators_pick_path", { id }),
      cores: () => invoke("emulators_cores"),
    },
    romFolders: {
      list: () => invoke("rom_folders_list"),
      pick: () => invoke("rom_folders_pick"),
      add: (folder) => invoke("rom_folders_add", { folder }),
      remove: (id) => invoke("rom_folders_remove", { id }),
      scan: (id) => invoke("rom_folders_scan", { id: id ?? null }),
    },
    stats: {
      dailyPlaytime: () => invoke("stats_daily_playtime"),
    },
    achievements: {
      getConfig: () => invoke("achievements_get_config"),
      setAccount: (account) => invoke("achievements_set_account", { account }),
      sync: () => invoke("achievements_sync"),
      game: (gameId) => invoke("achievements_game", { gameId }),
      overview: () => invoke("achievements_overview"),
      onStatus: (callback) => subscribe(EVENTS.achievementsStatus, callback),
      onUnlocked: (callback) => subscribe(EVENTS.achievementsUnlocked, callback),
    },
    updates: {
      getStatus: () => invoke("updates_get_status"),
      check: () => invoke("updates_check"),
      install: () => invoke("updates_install"),
      setAutoCheck: (enabled) => invoke("updates_set_auto_check", { enabled }),
      onStatus: (callback) => subscribe(EVENTS.updatesStatus, callback),
    },
    controllers: {
      list: () => invoke("controllers_list"),
      getInput: () => invoke("controllers_get_input"),
      setInputEnabled: (enabled) => invoke("controllers_set_input_enabled", { enabled }),
      onInputChange: (callback) => subscribe(EVENTS.controllersInput, callback),
      onChange: (callback) => subscribe(EVENTS.controllersChanged, callback),
    },
    statuses: {
      create: (name) => invoke("statuses_create", { name }),
      rename: (id, name) => invoke("statuses_rename", { id, name }),
      reorder: (ids) => invoke("statuses_reorder", { ids }),
      remove: (id, moveToId) => invoke("statuses_remove", { id, moveToId }),
      setRules: (rules) => invoke("statuses_set_rules", { rules }),
    },
  }
}
