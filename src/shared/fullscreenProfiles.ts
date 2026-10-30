import type { FullscreenConfig } from "./fullscreen"

export const FULLSCREEN_PROFILE_FORMAT = "playtrove-fullscreen-preferences" as const
export const FULLSCREEN_PROFILE_VERSION = 2 as const

/** Formato próprio do Playtrove, sem outros dados ou configurações da biblioteca. */
export interface FullscreenProfileDocument {
  format: typeof FULLSCREEN_PROFILE_FORMAT
  version: typeof FULLSCREEN_PROFILE_VERSION
  config: FullscreenConfig
}

export interface FullscreenProfilesApi {
  /** false significa que o diálogo foi cancelado. */
  export: () => Promise<boolean>
  /** null significa que o diálogo foi cancelado. */
  import: () => Promise<FullscreenConfig | null>
  reset: () => Promise<FullscreenConfig>
}
