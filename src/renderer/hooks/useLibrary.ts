import { useEffect, useState } from "react"
import type { LibrarySnapshot } from "@shared/types"

/**
 * A biblioteca que está no banco de dados: jogos, status e regras. Recarrega sozinha sempre que o
 * processo principal avisa que algo mudou (canal "library:changed").
 */
export function useLibrary() {
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null)

  useEffect(() => {
    let active = true
    const load = () =>
      window.api.library.get().then((snapshot) => {
        if (active) setLibrary(snapshot)
      })

    void load()
    const stopListening = window.api.library.onChange(() => void load())
    return () => {
      active = false
      stopListening()
    }
  }, [])

  /** Muda o status de um jogo: aparece na tela na hora e é salvo no banco. */
  function setGameStatus(gameId: number, statusId: number): void {
    setLibrary(
      (current) =>
        current && {
          ...current,
          games: current.games.map((game) => (game.id === gameId ? { ...game, statusId } : game)),
        }
    )
    void window.api.games.setStatus(gameId, statusId)
  }

  return {
    /** true até a primeira leitura do banco terminar. */
    loading: library === null,
    games: library?.games ?? [],
    statuses: library?.statuses ?? [],
    rules: library?.rules ?? null,
    setGameStatus,
  }
}
