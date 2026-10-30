import type { AnikiColorPreset } from "./anikiColors"
import type { ControllerIconStyle } from "./anikiAppearance"
import type { InGameOverlayHotkey } from "./gameOverlay"
import type { AnikiPresentationConfig } from "./anikiPresentation"
import type { GameLaunchSplashConfig } from "./gameLaunchSplash"

/** Os temas da tela cheia, como os do Playnite: o do Playtrove (padrão) e o Aniki ReMake, baixado da release do autor. */
export const FULLSCREEN_THEMES = ["playtrove", "aniki"] as const
export type FullscreenTheme = (typeof FULLSCREEN_THEMES)[number]
/** Avatares próprios do Playtrove para o perfil do Aniki (a mesma lista do Rust, em src-tauri/src/fullscreen.rs). */
export const PROFILE_AVATARS = ["gamepad", "trophy", "star", "crown", "ghost", "swords", "rocket", "flame", "skull", "sparkles", "shield", "zap"] as const
export type ProfileAvatar = (typeof PROFILE_AVATARS)[number] | "custom"
/** Layouts do Aniki (as mesmas listas do Rust); o primeiro de cada uma é o padrão. */
export const LIBRARY_LAYOUTS = ["horizontal", "vertical", "list"] as const
export type LibraryLayout = (typeof LIBRARY_LAYOUTS)[number]
export const DETAILS_LAYOUTS = ["signature", "modern", "classic", "original", "showcase", "panel"] as const
export type DetailsLayout = (typeof DETAILS_LAYOUTS)[number]
/** Os modos de efeitos do Aniki, do mais animado ao mais leve (o padrão é o equilibrado). */
export const FULLSCREEN_EFFECTS = ["full", "animated", "balanced", "performance"] as const
export type FullscreenEffects = (typeof FULLSCREEN_EFFECTS)[number]
/** Os estilos de interface do Aniki, do mais limpo ao mais completo (o padrão é o Padrão). */
export const FULLSCREEN_INTERFACES = ["clean", "standard", "enhanced", "complete"] as const
export type FullscreenInterface = (typeof FULLSCREEN_INTERFACES)[number]
/** Onde os trailers tocam sozinhos (o padrão é só nos detalhes). */
export const FULLSCREEN_TRAILERS = ["off", "details", "all"] as const
export type FullscreenTrailers = (typeof FULLSCREEN_TRAILERS)[number]

/** Preferências próprias do modo de tela cheia, independentes do desktop. */
export interface FullscreenConfig extends AnikiPresentationConfig, GameLaunchSplashConfig {
  /** "aniki" só é aceito com o pacote do Aniki instalado. */
  theme: FullscreenTheme
  startOnLaunch: boolean
  musicPlayback: boolean
  musicVolume: number
  /** Onde a tela cheia abre, como no assistente do Aniki. */
  startDestination: "hub" | "library"
  /** Nome do perfil; vazio usa o nome padrão da tela. */
  profileName: string
  profileAvatar: ProfileAvatar
  /** Imagem do pacote Aniki (1 a 61); null mantém o avatar próprio do perfil. */
  anikiAvatarIndex: number | null
  /** Estilo visual dos ícones; não altera o controle nem o mapa de entrada. */
  controllerIconStyle: ControllerIconStyle
  inGameOverlayEnabled: boolean
  inGameOverlayHotkey: InGameOverlayHotkey
  libraryLayout: LibraryLayout
  detailsLayout: DetailsLayout
  colorPreset: AnikiColorPreset
  /** A cor tirada da arte do jogo selecionado, no lugar da paleta. */
  dynamicColors: boolean
  effects: FullscreenEffects
  interface: FullscreenInterface
  /** A tela de boas-vindas com o perfil ao abrir o app em tela cheia. */
  loginScreen: boolean
  trailers: FullscreenTrailers
  /** O assistente inicial já foi concluído (ou pulado). */
  setupDone: boolean
  /** Tema Playtrove: linhas de capas (1 a 3) e relógio na barra. */
  coverRows: number
  showClock: boolean
  /** Sons da navegação dos dois temas (volume de 0 a 100). */
  uiSounds: boolean
  uiSoundsVolume: number
  /** Tema Playtrove: ○ confirma e × volta. */
  swapConfirm: boolean
  /** Onde o trailer toca no tema Playtrove (o padrão é a biblioteca e os detalhes; o do Aniki é `trailers`). */
  playtroveTrailers: FullscreenTrailers
}

/** As opções de energia do menu principal (a mesma lista do Rust, em src-tauri/src/power.rs). */
export const POWER_ACTIONS = ["lock", "sleep", "restart", "shutdown"] as const
export type PowerAction = (typeof POWER_ACTIONS)[number]

/** O pacote oficial do Aniki: instalado, baixando ("download") ou extraindo as mídias ("extract"). */
export interface AnikiPackStatus {
  version: string
  /** Tamanho do pacote oficial, em bytes. */
  size: number
  installed: boolean
  installing: boolean
  phase: "download" | "extract" | null
  received: number
  total: number
}
