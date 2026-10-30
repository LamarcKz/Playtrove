/** Os temas da tela cheia, como os do Playnite: o do Playtrove (padrão) e o Aniki ReMake, que roda no Playnite. */
export const FULLSCREEN_THEMES = ["playtrove", "aniki"] as const
export type FullscreenTheme = (typeof FULLSCREEN_THEMES)[number]
/** Onde o trailer do tema Playtrove toca sozinho (o padrão é a biblioteca e os detalhes). */
export const FULLSCREEN_TRAILERS = ["off", "details", "all"] as const
export type FullscreenTrailers = (typeof FULLSCREEN_TRAILERS)[number]

/** Preferências próprias do modo de tela cheia, independentes do desktop (as do Aniki ficam no Playnite). */
export interface FullscreenConfig {
  /** "aniki" só é aceito com o Aniki instalado. */
  theme: FullscreenTheme
  startOnLaunch: boolean
  musicPlayback: boolean
  musicVolume: number
  /** Tema Playtrove: linhas de capas (1 a 3) e relógio na barra. */
  coverRows: number
  showClock: boolean
  /** Sons da navegação (volume de 0 a 100). */
  uiSounds: boolean
  uiSoundsVolume: number
  /** ○ confirma e × volta. */
  swapConfirm: boolean
  playtroveTrailers: FullscreenTrailers
}

/** As opções de energia do menu principal (a mesma lista do Rust, em src-tauri/src/power.rs). */
export const POWER_ACTIONS = ["lock", "sleep", "restart", "shutdown"] as const
export type PowerAction = (typeof POWER_ACTIONS)[number]

/** O Aniki pelo Playnite: instalado, baixando ("download") ou extraindo ("extract") um dos pacotes. */
export interface AnikiPackStatus {
  version: string
  /** Tamanho dos pacotes oficiais juntos, em bytes. */
  size: number
  installed: boolean
  installing: boolean
  phase: "download" | "extract" | null
  received: number
  total: number
  /** O pacote da vez (1 a `steps`; 0 parado). */
  step: number
  steps: number
}
