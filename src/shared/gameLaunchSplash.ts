/** Splash de lançamento do Helper: primeiro passo com imagens internas, sem vídeos nem pastas custom. */
export const GAME_LAUNCH_SPLASH_LOGO_POSITIONS = ["leftTop", "leftCenter", "leftBottom", "centerTop", "center", "centerBottom", "rightTop", "rightCenter", "rightBottom"] as const
export type GameLaunchSplashLogoPosition = (typeof GAME_LAUNCH_SPLASH_LOGO_POSITIONS)[number]
export const GAME_LAUNCH_SPLASH_SELECTION_MODES = ["automatic", "global"] as const
export type GameLaunchSplashSelectionMode = (typeof GAME_LAUNCH_SPLASH_SELECTION_MODES)[number]

export interface GameLaunchSplashConfig {
  gameLaunchSplashEnabled: boolean
  /** 500..600000; padrão do Helper: 2400. */
  gameLaunchSplashMinimumDurationMs: number
  /** 1000..120000 após o mínimo; padrão do Helper: 90000. */
  gameLaunchSplashMaximumWaitMs: number
  gameLaunchSplashShowLogo: boolean
  gameLaunchSplashLogoPosition: GameLaunchSplashLogoPosition
  /** 0..0.8; padrão do Helper: 95/255. */
  gameLaunchSplashBackgroundDimming: number
  /** Automatic usa fundo do jogo, depois global; global ausente usa preto. */
  gameLaunchSplashSelectionMode: GameLaunchSplashSelectionMode
}

export const DEFAULT_GAME_LAUNCH_SPLASH: GameLaunchSplashConfig = {
  gameLaunchSplashEnabled: true,
  gameLaunchSplashMinimumDurationMs: 2400,
  gameLaunchSplashMaximumWaitMs: 90000,
  gameLaunchSplashShowLogo: true,
  gameLaunchSplashLogoPosition: "leftCenter",
  gameLaunchSplashBackgroundDimming: 95 / 255,
  gameLaunchSplashSelectionMode: "automatic",
}

export interface GameLaunchSplashState {
  generation: number
  open: boolean
  gameId: number | null
  title: string
  phase: "launching" | "waiting" | "closing" | null
  source: "gameBackground" | "global" | "black"
  imageUrl: string | null
  logoUrl: string | null
  showLogo: boolean
  logoPosition: GameLaunchSplashLogoPosition
  backgroundDimming: number
  globalAvailable: boolean
}

export interface GameLaunchSplashApi {
  getState: () => Promise<GameLaunchSplashState>
  /** Só a rota própria informa quando o primeiro quadro daquele token foi apresentado. */
  rendered: (generation: number) => Promise<void>
  onStateChange: (callback: (state: GameLaunchSplashState) => void) => () => void
}
