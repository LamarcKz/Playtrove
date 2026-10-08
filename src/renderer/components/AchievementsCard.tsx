import { useState } from "react"
import { Trophy } from "lucide-react"
import type { Game } from "@shared/types"
import { AchievementBadge, GradeCounts, ProgressBar } from "@/components/AchievementParts"
import { AchievementsDialog } from "@/components/AchievementsDialog"
import { Button } from "@/components/ui/button"
import { useGameAchievements } from "@/hooks/useAchievements"
import { useI18n } from "@/hooks/useI18n"
import { progressPercent } from "@/lib/achievements"
import { cn } from "@/lib/utils"

/** Quantas insígnias (as últimas desbloqueadas) o cartão mostra. */
const BADGES = 6

/**
 * Cartão das conquistas nos detalhes do jogo, no espaço à direita do título (pedido do usuário em
 * 2026-09-24, "menor e combinando com o app"): o progresso, quantos troféus de cada tipo (o padrão
 * do PS3, também nas conquistas do RetroAchievements), as últimas insígnias e "Ver todas". Nos jogos
 * de PS3, são os troféus do RPCS3. Jogo sem conquistas não mostra nada.
 */
export function AchievementsCard({ game, className }: { game: Game; className?: string }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const details = useGameAchievements(game.id, game)
  const progress = game.achievements
  if (!progress) return null

  const words = t.achievements.sources[progress.source]
  const percent = progressPercent(progress.unlocked, progress.total)
  const recent = (details?.achievements ?? [])
    .filter((item) => item.earnedAt)
    .sort((a, b) => (b.earnedAt ?? "").localeCompare(a.earnedAt ?? ""))
    .slice(0, BADGES)

  return (
    <section
      aria-label={words.title}
      className={cn("w-72 rounded-xl border border-border/60 bg-background/45 p-4 backdrop-blur-sm", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{words.title}</h2>
        {progress.platinum && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-platinum">
            <Trophy aria-hidden="true" className="size-3.5" />
            {t.achievements.platinum}
          </span>
        )}
      </div>
      <p className="mt-1.5 flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">
          {progress.unlocked}/{progress.total}
        </span>
        <span className="text-xs text-muted-foreground">
          {percent}%{details?.points != null ? ` · ${t.achievements.points(details.points)}` : ""}
        </span>
      </p>
      <ProgressBar value={percent} label={words.progress} className="mt-2" />
      {details && <GradeCounts counts={details.byGrade} className="mt-2.5 text-xs text-muted-foreground" />}
      {recent.length > 0 && (
        <div aria-label={words.latest} className="mt-3 flex items-center gap-1.5">
          {recent.map((item) => (
            <AchievementBadge key={item.key} url={item.badgeUrl} title={item.title} earned className="size-8" />
          ))}
          {progress.unlocked > recent.length && (
            <span className="ml-1 text-xs text-muted-foreground">+{progress.unlocked - recent.length}</span>
          )}
        </div>
      )}
      <Button variant="ghost" size="sm" className="mt-2 -ml-2 text-muted-foreground" onClick={() => setOpen(true)}>
        {words.seeAll}
      </Button>
      <AchievementsDialog game={game} open={open} onOpenChange={setOpen} />
    </section>
  )
}
