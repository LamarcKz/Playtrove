/** Fontes do screensaver do Aniki Helper (MIT); nomes próprios do contrato do Playtrove. */
export const ANIKI_SCREENSAVER_SOURCES = ["all", "installed", "favorites", "neverPlayed", "recentlyAdded", "currentFilter", "weighted"] as const
export type AnikiScreenSaverSource = (typeof ANIKI_SCREENSAVER_SOURCES)[number]
export const ANIKI_SCREENSAVER_IDLE_PRESETS = [-30, -45, 1, 2, 5, 10, 15, 30] as const
export const ANIKI_SCREENSAVER_INTERVAL_PRESETS = [5, 8, 10, 15, 20, 30, 45] as const

export interface AnikiPresentationConfig {
  startupIntroVideoEnabled: boolean
  shutdownVideoEnabled: boolean
  screenSaverEnabled: boolean
  /** -30/-45 representam segundos; valores positivos, de 1 a 120 minutos, seguem o Helper. */
  screenSaverIdleDelayMinutes: number
  screenSaverChangeIntervalSeconds: number
  screenSaverSource: AnikiScreenSaverSource
  screenSaverAmbientMusicEnabled: boolean
  screenSaverShowLogo: boolean
  screenSaverShowInfoCard: boolean
  screenSaverAnimateBackground: boolean
  screenSaverUseFadeTransitions: boolean
}

export const DEFAULT_ANIKI_PRESENTATION: AnikiPresentationConfig = {
  startupIntroVideoEnabled: true,
  shutdownVideoEnabled: true,
  screenSaverEnabled: true,
  screenSaverIdleDelayMinutes: 1,
  screenSaverChangeIntervalSeconds: 15,
  screenSaverSource: "installed",
  screenSaverAmbientMusicEnabled: true,
  screenSaverShowLogo: true,
  screenSaverShowInfoCard: true,
  screenSaverAnimateBackground: true,
  screenSaverUseFadeTransitions: true,
}
