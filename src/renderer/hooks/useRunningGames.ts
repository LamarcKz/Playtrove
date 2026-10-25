import { useEffect, useState } from "react"

/** Ids dos jogos abertos agora (o main avisa quando um jogo abre ou fecha). */
export function useRunningGames(): number[] {
  return useRunningGamesState().running
}

/** A música permanece suspensa até confirmar o estado inicial dos jogos abertos. */
export function useRunningGamesState() {
  const [state, setState] = useState({ running: [] as number[], loading: true })

  useEffect(() => {
    let active = true
    let receivedEvent = false
    const stopListening = window.api.games.onRunningChange((ids) => {
      receivedEvent = true
      if (active) setState({ running: ids, loading: false })
    })
    void window.api.games.getRunning().then((ids) => {
      if (active && !receivedEvent) setState({ running: ids, loading: false })
    }).catch(() => {
      // Sem confirmar o estado, a música continua suspensa; um evento posterior pode liberá-la.
    })
    return () => {
      active = false
      stopListening()
    }
  }, [])

  return state
}
