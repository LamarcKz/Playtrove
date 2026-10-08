import { useEffect } from "react"
import { useI18n } from "@/hooks/useI18n"
import { useToast } from "@/hooks/useToast"

/** A partir de quantas conquistas de uma vez o aviso vira um só ("5 conquistas novas"). */
const GROUP_FROM = 4

/**
 * Mostra um aviso no canto quando o app acha conquistas novas no RetroAchievements ou troféus novos
 * no RPCS3 (escolha do usuário em 2026-09-24). Não desenha nada: só ouve o main.
 */
export function AchievementNotifier() {
  const { t } = useI18n()
  const toast = useToast()

  useEffect(
    () =>
      window.api.achievements.onUnlocked((achievements) => {
        const words = t.achievements
        if (achievements.length >= GROUP_FROM) {
          const games = [...new Set(achievements.map((item) => item.gameTitle))]
          const trophies = achievements.filter((item) => item.source === "rpcs3").length
          const kind = trophies === 0 ? "achievements" : trophies === achievements.length ? "trophies" : "both"
          toast({ kind: "success", title: words.newGrouped(achievements.length, kind), description: games.join(", ") })
          return
        }
        for (const achievement of achievements) {
          toast({
            kind: "success",
            title: `${words.sources[achievement.source].unlockedToast}: ${achievement.title}`,
            description: `${achievement.gameTitle} · ${words.grades[achievement.grade]}`,
          })
        }
      }),
    [t, toast]
  )

  return null
}
