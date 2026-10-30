import { Trophy } from "lucide-react"
import type { Game } from "@shared/types"
import { ProgressBar } from "@/components/AchievementParts"
import { useI18n } from "@/hooks/useI18n"

/** Os troféus de toda a biblioteca: o total e os jogos com conquistas, do mais adiantado ao menos; abrir um leva aos detalhes. */
export function FullscreenTrophyOverview({ games, onOpen }: { games: Game[]; onOpen: (id: number) => void }) {
  const { t } = useI18n()
  const withTrophies = games.filter((game) => game.achievements && game.achievements.total > 0)
    .sort((a, b) => b.achievements!.unlocked / b.achievements!.total - a.achievements!.unlocked / a.achievements!.total || a.title.localeCompare(b.title, t.locale))
  const unlocked = withTrophies.reduce((sum, game) => sum + game.achievements!.unlocked, 0)
  const total = withTrophies.reduce((sum, game) => sum + game.achievements!.total, 0)
  return <div className="fs-trophy-overview">
    <h2>{t.fields.achievements}</h2>
    {withTrophies.length === 0 ? <p>{t.fullscreen.noAchievements}</p> : <>
      <p>{t.fullscreen.trophyTotal(unlocked, total)}</p>
      <div className="fs-trophy-games" role="list">{withTrophies.map((game) => <button type="button" role="listitem" key={game.id} data-fs-default={game === withTrophies[0] ? "" : undefined} onClick={() => onOpen(game.id)}>
        <Trophy /><span>{game.title}</span><output>{game.achievements!.unlocked} / {game.achievements!.total}</output>
        <ProgressBar value={game.achievements!.unlocked * 100 / game.achievements!.total} label={game.title} />
      </button>)}</div>
    </>}
  </div>
}
