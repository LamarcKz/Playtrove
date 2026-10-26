interface GameLauncher { getRunning: () => Promise<number[]>; play: (gameId: number) => Promise<void> }
/** Serializa consulta e lançamento: o intervalo antes do evento de execução também fica protegido. */
export class FullscreenLaunchGuard {
  private pending = false
  async play(gameId: number, api: GameLauncher): Promise<boolean> {
    if (this.pending) return false
    this.pending = true
    try {
      if ((await api.getRunning()).length) return false
      await api.play(gameId)
      return true
    } finally { this.pending = false }
  }
}
