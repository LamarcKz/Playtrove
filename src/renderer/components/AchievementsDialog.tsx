import { useState } from "react"
import { Eye } from "lucide-react"
import type { GameAchievement } from "@shared/achievements"
import type { Game } from "@shared/types"
import { AchievementBadge, GradeCounts, ProgressBar, TrophyIcon } from "@/components/AchievementParts"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useGameAchievements } from "@/hooks/useAchievements"
import { useI18n } from "@/hooks/useI18n"
import { formatPercent, GRADE_TEXT, progressPercent } from "@/lib/achievements"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

type Filter = "all" | "unlocked" | "locked"

interface AchievementsDialogProps {
  game: Game
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Janela com todas as conquistas (ou os troféus do PS3) de um jogo: as desbloqueadas e as que
 * faltam. Os troféus ocultos que faltam ficam escondidos, como no PS3, até clicar em "Mostrar
 * ocultos" (escolha do usuário em 2026-09-24).
 */
export function AchievementsDialog({ game, open, onOpenChange }: AchievementsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">{open && <AchievementsList game={game} />}</DialogContent>
    </Dialog>
  )
}

function AchievementsList({ game }: { game: Game }) {
  const { t } = useI18n()
  const details = useGameAchievements(game.id, game)
  const [filter, setFilter] = useState<Filter>("all")
  const [showHidden, setShowHidden] = useState(false)
  const words = t.achievements.sources[details?.source ?? game.achievements?.source ?? "retroachievements"]
  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: words.all },
    { value: "unlocked", label: words.unlocked },
    { value: "locked", label: t.achievements.lockedFilter },
  ]
  const hasHidden = details?.achievements.some((item) => item.hidden && !item.earnedAt) ?? false
  const list = (details?.achievements ?? []).filter((item) =>
    filter === "all" ? true : filter === "unlocked" ? item.earnedAt !== null : item.earnedAt === null
  )

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{words.titleOf(game.title)}</DialogTitle>
        <DialogDescription>
          {details
            ? words.unlockedOf(details.unlocked, details.total) +
              (details.points !== null ? ` · ${t.achievements.pointsOf(details.points, details.totalPoints ?? 0)}` : "")
            : t.common.loading}
        </DialogDescription>
      </DialogHeader>
      {details && (
        <>
          <ProgressBar value={progressPercent(details.unlocked, details.total)} label={words.progress} />
          <GradeCounts counts={details.byGrade} className="text-sm text-muted-foreground" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup
              type="single"
              value={filter}
              onValueChange={(value) => value && setFilter(value as Filter)}
              aria-label={t.achievements.show}
            >
              {filters.map(({ value, label }) => (
                <ToggleGroupItem key={value} value={value} className="px-3 text-xs">
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {hasHidden && (
              <Toggle
                size="sm"
                variant="outline"
                pressed={showHidden}
                onPressedChange={setShowHidden}
                className="text-xs aria-pressed:border-primary/60 aria-pressed:bg-primary/15"
              >
                <Eye />
                {t.achievements.showHidden}
              </Toggle>
            )}
          </div>
          <ul aria-label={words.list} className="-mx-2 max-h-[55vh] overflow-y-auto">
            {list.map((achievement) => (
              <AchievementRow key={achievement.key} achievement={achievement} revealHidden={showHidden} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

interface AchievementRowProps {
  achievement: GameAchievement
  /** O nome do jogo (na lista de recentes da aba, que mistura jogos). */
  gameTitle?: string
  /** Mostra o nome e a descrição dos troféus ocultos que ainda faltam. */
  revealHidden?: boolean
  /** A aba Conquistas usa texto maior e permite que a data vá para outra linha. */
  compact?: boolean
}

/**
 * Uma conquista: insígnia, nome, descrição, o tipo do troféu (e, no RetroAchievements, a raridade,
 * a porcentagem de jogadores e os pontos; no PS3, o pacote extra) e quando foi desbloqueada.
 */
export function AchievementRow({ achievement, gameTitle, revealHidden = false, compact = true }: AchievementRowProps) {
  const { t } = useI18n()
  const words = t.achievements
  const earned = achievement.earnedAt !== null
  const masked = achievement.hidden && !earned && !revealHidden
  const title = masked ? words.hiddenTitle : achievement.title
  return (
    <li className={cn("flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-accent/30", !compact && "flex-wrap")}>
      <AchievementBadge
        url={masked ? null : achievement.badgeUrl}
        title={title}
        earned={earned}
        dim={achievement.source === "rpcs3"}
        decorative
        className="size-12"
      />
      <div className={cn("min-w-0 flex-1", !compact && "basis-48")}>
        <p className={cn("text-sm font-medium", !earned && "text-muted-foreground", !compact && "[overflow-wrap:anywhere]")}>{title}</p>
        {gameTitle && (
          <p className={cn("text-muted-foreground", compact ? "truncate text-xs" : "[overflow-wrap:anywhere] text-sm")}>{gameTitle}</p>
        )}
        <p className={cn("text-muted-foreground", compact ? "text-xs" : "[overflow-wrap:anywhere] text-sm")}>
          {masked ? words.hiddenDescription : achievement.description}
        </p>
        {/* Texto corrido (e não flex): numa coluna estreita, quebra entre as palavras. */}
        <p className={cn("mt-1 text-muted-foreground", compact ? "text-xs" : "[overflow-wrap:anywhere] text-sm")}>
          <TrophyIcon grade={achievement.grade} className="mr-1 inline align-[-3px]" />
          <span className={GRADE_TEXT[achievement.grade]}>{words.grades[achievement.grade]}</span>
          {achievement.rarity &&
            ` · ${words.rarities[achievement.rarity]} · ${words.ofPlayers(formatPercent(achievement.percent ?? 0, t.locale))} · ${words.points(achievement.points ?? 0)}`}
          {achievement.group && ` · ${achievement.group}`}
        </p>
      </div>
      <div
        className={cn("shrink-0 text-right text-muted-foreground", compact ? "text-xs" : "ml-auto max-w-full [overflow-wrap:anywhere] text-sm")}
      >
        {achievement.earnedAt ? formatDateTime(achievement.earnedAt, t.locale) : words.locked}
        {achievement.hardcore && <p className="mt-0.5 font-medium text-foreground/80">{words.hardcore}</p>}
      </div>
    </li>
  )
}
