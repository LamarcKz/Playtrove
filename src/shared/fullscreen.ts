/** Avatares próprios do Playtrove para o perfil do Aniki (a mesma lista do Rust, em src-tauri/src/fullscreen.rs). */
export const PROFILE_AVATARS = ["gamepad", "trophy", "star", "crown", "ghost", "swords", "rocket", "flame", "skull", "sparkles", "shield", "zap"] as const
export type ProfileAvatar = (typeof PROFILE_AVATARS)[number]
/** Layouts do Aniki (as mesmas listas do Rust); o primeiro de cada uma é o padrão. */
export const LIBRARY_LAYOUTS = ["horizontal", "vertical", "list"] as const
export type LibraryLayout = (typeof LIBRARY_LAYOUTS)[number]
export const DETAILS_LAYOUTS = ["signature", "modern", "classic", "original", "showcase", "panel"] as const
export type DetailsLayout = (typeof DETAILS_LAYOUTS)[number]

/** Preferências próprias do modo de tela cheia, independentes do desktop. */
export interface FullscreenConfig {
  startOnLaunch: boolean
  musicPlayback: boolean
  musicVolume: number
  /** Onde a tela cheia abre, como no assistente do Aniki. */
  startDestination: "hub" | "library"
  /** Nome do perfil; vazio usa o nome padrão da tela. */
  profileName: string
  profileAvatar: ProfileAvatar
  libraryLayout: LibraryLayout
  detailsLayout: DetailsLayout
}
