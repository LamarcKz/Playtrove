import { useEffect, useState } from "react"
import type { AchievementsConfig, AchievementsOverview, GameAchievements } from "@shared/achievements"

/**
 * A conta do RetroAchievements e a situação da atualização. Acompanha os avisos do main (começou
 * ou terminou de atualizar). Devolve também como trocar a configuração (depois de salvar a conta).
 */
export function useAchievementsConfig(): [AchievementsConfig | null, (config: AchievementsConfig) => void] {
  const [config, setConfig] = useState<AchievementsConfig | null>(null)

  useEffect(() => {
    let active = true
    void window.api.achievements.getConfig().then((result) => {
      if (active) setConfig(result)
    })
    const stop = window.api.achievements.onStatus(setConfig)
    return () => {
      active = false
      stop()
    }
  }, [])

  return [config, setConfig]
}

/**
 * As conquistas de um jogo. Busca de novo quando o jogo muda ou quando `version` muda (ex.: a
 * biblioteca recarregou depois de uma atualização).
 */
export function useGameAchievements(gameId: number, version: unknown): GameAchievements | null {
  const [data, setData] = useState<{ gameId: number; achievements: GameAchievements | null } | null>(null)

  useEffect(() => {
    let active = true
    void window.api.achievements.game(gameId).then((achievements) => {
      if (active) setData({ gameId, achievements })
    })
    return () => {
      active = false
    }
  }, [gameId, version])

  // Enquanto o jogo novo carrega, não mostra as conquistas do anterior.
  return data?.gameId === gameId ? data.achievements : null
}

/** Tudo o que a aba Conquistas mostra. Busca de novo quando `version` muda. */
export function useAchievementsOverview(version: unknown): AchievementsOverview | null {
  const [overview, setOverview] = useState<AchievementsOverview | null>(null)

  useEffect(() => {
    let active = true
    void window.api.achievements.overview().then((result) => {
      if (active) setOverview(result)
    })
    return () => {
      active = false
    }
  }, [version])

  return overview
}
