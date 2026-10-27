/** Avatares próprios do Playtrove para o perfil do Aniki (a mesma lista do Rust, em src-tauri/src/fullscreen.rs). */
export const PROFILE_AVATARS = ["gamepad", "trophy", "star", "crown", "ghost", "swords", "rocket", "flame", "skull", "sparkles", "shield", "zap"] as const
export type ProfileAvatar = (typeof PROFILE_AVATARS)[number]

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
}
