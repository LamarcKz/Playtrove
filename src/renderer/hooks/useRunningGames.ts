import { useEffect, useState } from "react"

/** Ids dos jogos abertos agora (o main avisa quando um jogo abre ou fecha). */
export function useRunningGames(): number[] {
  const [running, setRunning] = useState<number[]>([])

  useEffect(() => {
    let active = true
    window.api.games.getRunning().then((ids) => {
      if (active) setRunning(ids)
    })
    const stopListening = window.api.games.onRunningChange(setRunning)
    return () => {
      active = false
      stopListening()
    }
  }, [])

  return running
}
