import { formatScore } from "@shared/evaluation"
import type { Game } from "@shared/types"
import { ScoreIcons } from "@/components/ScoreIcons"
import { useI18n } from "@/hooks/useI18n"
import type { ScoreKind } from "@/lib/score"
import { cn } from "@/lib/utils"

/**
 * A nota e a dificuldade do jogo, com o rótulo pequeno em cima, como as informações ao lado do
 * botão de jogar da Steam (pedido do usuário em 2026-09-24). Quem avalia é o menu Mais.
 */
export function GameScores({ game, className }: { game: Game; className?: string }) {
  const { t } = useI18n()
  return (
    <dl className={cn("flex gap-9", className)}>
      <Score label={t.details.myRating} kind="rating" score={game.rating} />
      <Score label={t.fields.difficulty} kind="difficulty" score={game.difficulty} />
    </dl>
  )
}

function Score({ label, kind, score }: { label: string; kind: ScoreKind; score: number | null }) {
  const { t } = useI18n()
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1.5 flex h-5 items-center gap-2 text-sm">
        {score === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <>
            <ScoreIcons kind={kind} score={score} />
            <span className="tabular-nums">{formatScore(score, t.locale)}</span>
          </>
        )}
      </dd>
    </div>
  )
}
