import type { ComponentType, SVGProps } from "react"
import { Star } from "lucide-react"
import { PepperIcon } from "@/components/icons/PepperIcon"
import { useI18n } from "@/hooks/useI18n"
import { describeScore, iconFill, type ScoreKind } from "@/lib/score"
import { cn } from "@/lib/utils"

/** O ícone e a cor de cada tipo de nota. */
const SCORE_ICONS: Record<ScoreKind, { Icon: ComponentType<SVGProps<SVGSVGElement>>; color: string }> = {
  rating: { Icon: Star, color: "text-favorite" },
  difficulty: { Icon: PepperIcon, color: "text-pepper" },
}

interface ScoreIconsProps {
  kind: ScoreKind
  /** De 1 a 10 (9 = quatro ícones e meio). */
  score: number
  className?: string
  /** Tamanho dos ícones (ex.: "size-4"). */
  iconClassName?: string
}

/** Cinco estrelas (ou pimentas), com meio ícone. Só mostra: para escolher, é o ScoreInput. */
export function ScoreIcons({ kind, score, className, iconClassName = "size-4" }: ScoreIconsProps) {
  const { t } = useI18n()
  return (
    <span role="img" aria-label={describeScore(kind, score, t)} className={cn("inline-flex items-center gap-0.5", className)}>
      {[0, 1, 2, 3, 4].map((index) => (
        <ScoreIcon key={index} kind={kind} fill={iconFill(score, index)} className={iconClassName} />
      ))}
    </span>
  )
}

/** Um ícone cheio, vazio ou pela metade (o cheio por cima do vazio, cortado ao meio). */
export function ScoreIcon({
  kind,
  fill,
  className,
}: {
  kind: ScoreKind
  fill: "full" | "half" | "empty"
  className?: string
}) {
  const { Icon, color } = SCORE_ICONS[kind]
  const empty = <Icon aria-hidden="true" className={cn("block shrink-0 text-muted-foreground/45", className)} />
  const full = <Icon aria-hidden="true" fill="currentColor" className={cn("block shrink-0", color, className)} />
  if (fill === "empty") return empty
  if (fill === "full") return full
  return (
    <span className="relative inline-block" data-fill="half">
      {empty}
      <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">{full}</span>
    </span>
  )
}
