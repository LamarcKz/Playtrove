/** Onde o trailer do tema Playtrove toca sozinho (o padrão é a biblioteca e os detalhes). */
export const FULLSCREEN_TRAILERS = ["off", "details", "all"] as const
export type FullscreenTrailers = (typeof FULLSCREEN_TRAILERS)[number]
/** No Mosaico, o trailer só toca nos detalhes ou fica desligado. */
export const MOSAICO_TRAILERS = ["off", "details"] as const
export type MosaicoTrailers = (typeof MOSAICO_TRAILERS)[number]

/** Os temas da tela cheia (a mesma lista do Rust, em src-tauri/src/fullscreen.rs); o Playtrove é o padrão. */
export const FULLSCREEN_THEMES = ["playtrove", "horizonte", "mosaico", "painel"] as const
export type FullscreenTheme = (typeof FULLSCREEN_THEMES)[number]

/** Preferências próprias do modo de tela cheia, independentes do desktop. */
export interface FullscreenConfig {
  theme: FullscreenTheme
  startOnLaunch: boolean
  musicPlayback: boolean
  musicVolume: number
  /** Linhas de capas (1 a 3) e relógio na barra. */
  coverRows: number
  showClock: boolean
  /** Sons da navegação (volume de 0 a 100). */
  uiSounds: boolean
  uiSoundsVolume: number
  /** ○ confirma e × volta. */
  swapConfirm: boolean
  /** Onde o trailer toca em cada tema. */
  playtroveTrailers: FullscreenTrailers
  horizonteTrailers: FullscreenTrailers
  mosaicoTrailers: MosaicoTrailers
  painelTrailers: FullscreenTrailers
}

/** As opções de energia do menu principal (a mesma lista do Rust, em src-tauri/src/power.rs). */
export const POWER_ACTIONS = ["lock", "sleep", "restart", "shutdown"] as const
export type PowerAction = (typeof POWER_ACTIONS)[number]
