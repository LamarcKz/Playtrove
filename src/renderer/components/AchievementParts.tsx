import { Trophy } from "lucide-react"
import { TROPHY_GRADES, type AchievementProgress, type GradeCount, type TrophyGrade } from "@shared/achievements"
import { useI18n } from "@/hooks/useI18n"
import { GRADE_TEXT } from "@/lib/achievements"
import { cn } from "@/lib/utils"

/**
 * Pedaços pequenos das conquistas, usados em vários lugares: a barra de progresso, a insígnia, o
 * troféu com "23/94" das listas e os troféus do PS3 por tipo.
 */

/** Barra de progresso fina (de 0 a 100). */
export function ProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn("h-1.5 overflow-hidden rounded-full bg-foreground/10", className)}
    >
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${value}%` }} />
    </div>
  )
}

interface AchievementBadgeProps {
  /** A imagem (colorida ou apagada), ou null enquanto não há imagem. */
  url: string | null
  title: string
  earned: boolean
  /** Apaga a imagem (os troféus do PS3 que faltam; as insígnias do RetroAchievements já vêm apagadas). */
  dim?: boolean
  /** Sem texto alternativo (quando o nome da conquista já aparece ao lado). */
  decorative?: boolean
  className?: string
}

/** A insígnia de uma conquista. Sem a imagem, mostra um troféu no lugar. */
export function AchievementBadge({ url, title, earned, dim = false, decorative = false, className }: AchievementBadgeProps) {
  if (url) {
    return (
      <img
        src={url}
        alt={decorative ? "" : title}
        title={decorative ? undefined : title}
        draggable={false}
        className={cn(
          "aspect-square shrink-0 rounded-md object-cover",
          !earned && "opacity-80",
          dim && !earned && "opacity-50 grayscale",
          className
        )}
      />
    )
  }
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative ? true : undefined}
      className={cn("flex aspect-square shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", className)}
    >
      <Trophy className="size-1/2" />
    </span>
  )
}

/** O troféu com "23/94" das listas; na platina, o troféu fica na cor da platina. */
export function AchievementCount({ progress, className }: { progress: AchievementProgress; className?: string }) {
  const { t } = useI18n()
  const count = t.achievements.sources[progress.source].countOf(progress.unlocked, progress.total)
  const description = progress.platinum ? `${t.achievements.platinum}: ${count}` : count
  return (
    <span
      role="img"
      aria-label={description}
      title={description}
      className={cn("inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums", className)}
    >
      <Trophy className={cn("size-3.5", progress.platinum && "text-platinum")} />
      {progress.unlocked}/{progress.total}
    </span>
  )
}

/** O troféu na cor do tipo (platina, ouro, prata ou bronze). */
export function TrophyIcon({ grade, className }: { grade: TrophyGrade; className?: string }) {
  return <Trophy aria-hidden="true" className={cn("size-3.5 shrink-0", GRADE_TEXT[grade], className)} />
}

/**
 * Os troféus do PS3 por tipo: só quantos foram pegos (número) ou pegos e total ("2/12"). No
 * segundo caso, os tipos que o jogo não tem ficam de fora.
 */
export function GradeCounts({ counts, className }: { counts: Record<TrophyGrade, number | GradeCount>; className?: string }) {
  const { t } = useI18n()
  const { achievements } = t
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums", className)}>
      {TROPHY_GRADES.map((grade) => {
        const value = counts[grade]
        if (typeof value !== "number" && value.total === 0) return null
        const name = achievements.grades[grade]
        const text = typeof value === "number" ? String(value) : `${value.unlocked}/${value.total}`
        const label =
          typeof value === "number"
            ? achievements.gradeCount(name, value)
            : achievements.gradeProgress(name, value.unlocked, value.total)
        return (
          <span key={grade} role="img" aria-label={label} title={label} className="inline-flex items-center gap-1">
            <TrophyIcon grade={grade} />
            {text}
          </span>
        )
      })}
    </span>
  )
}
