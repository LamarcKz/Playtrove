/** Uma sessão iniciada pelo Playtrove; a identidade nativa do processo permanece somente no Rust. */
export interface RunningSession {
  gameId: number
  processId: number
  startedAt: string
  /** O processo original está vivo e seu handle está disponível; a janela pode ainda estar carregando. */
  canControl: boolean
}
