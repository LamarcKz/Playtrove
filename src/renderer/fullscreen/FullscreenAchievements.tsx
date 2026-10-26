import { useState } from "react"
import type { Game } from "@shared/types"
import { AchievementRow } from "@/components/AchievementsDialog"
import { GradeCounts, ProgressBar } from "@/components/AchievementParts"
import { useGameAchievements } from "@/hooks/useAchievements"
import { useI18n } from "@/hooks/useI18n"

export function FullscreenAchievements({ game }: { game: Game }) {
  const { t } = useI18n()
  const details = useGameAchievements(game.id, game)
  const [filter, setFilter] = useState<"all" | "unlocked" | "locked">("all")
  const [showHidden, setShowHidden] = useState(false)
  const words = t.achievements.sources[details?.source ?? game.achievements?.source ?? "retroachievements"]
  return <div className="fs-achievements">
    <h2>{words.titleOf(game.title)}</h2>
    {!details ? <p>{t.common.loading}</p> : <>
      <p>{words.unlockedOf(details.unlocked, details.total)}</p>
      <ProgressBar value={details.total ? details.unlocked * 100 / details.total : 0} label={words.progress} />
      <GradeCounts counts={details.byGrade} />
      <div className="fs-dialog-actions">{(["all", "unlocked", "locked"] as const).map((key) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{key === "all" ? words.all : key === "unlocked" ? words.unlocked : t.achievements.lockedFilter}</button>)}<button type="button" aria-pressed={showHidden} onClick={() => setShowHidden(!showHidden)}>{t.achievements.showHidden}</button></div>
      <div className="fs-achievements-list" role="list">{details.achievements.filter((item) => filter === "all" || (filter === "unlocked" ? item.earnedAt !== null : item.earnedAt === null)).map((item) => <div key={item.key} role="listitem" tabIndex={0}><ul><AchievementRow achievement={item} revealHidden={showHidden} compact={false} /></ul></div>)}</div>
    </>}
  </div>
}
