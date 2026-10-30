/** Imagens locais copiadas para o armazenamento interno; nenhuma API aceita caminhos do renderer. */
export interface AnikiCustomMediaApi {
  getAvatar: () => Promise<string | null>
  /** null significa que o diálogo foi cancelado. */
  pickAvatar: () => Promise<string | null>
  removeAvatar: () => Promise<void>
  getGlobalSplash: () => Promise<string | null>
  /** null significa que o diálogo foi cancelado. */
  pickGlobalSplash: () => Promise<string | null>
  removeGlobalSplash: () => Promise<void>
  /** false significa que o diálogo foi cancelado. */
  pickLogo: (gameId: number) => Promise<boolean>
  /** Remove somente a logo personalizada, revelando a automática existente quando houver. */
  removeLogo: (gameId: number) => Promise<void>
  onAvatarChange: (callback: (url: string | null) => void) => () => void
}
