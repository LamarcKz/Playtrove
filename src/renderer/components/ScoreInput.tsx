import { useState, type KeyboardEvent } from "react"
import { X } from "lucide-react"
import { formatScore } from "@shared/evaluation"
import { ScoreIcon } from "@/components/ScoreIcons"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/useI18n"
import { describeScore, iconFill, scoreFromClick, scoreFromKey, type ScoreKind } from "@/lib/score"

interface ScoreInputProps {
  kind: ScoreKind
  /** Id do rótulo que aparece na tela (ex.: "Nota"), para os leitores de tela. */
  labelledBy: string
  /** De 1 a 10, ou null sem nota. */
  value: number | null
  onChange: (value: number | null) => void
}

/**
 * Escolher a nota (ou a dificuldade) clicando nos ícones: a metade esquerda de um ícone dá meio
 * ícone; a direita, o ícone inteiro. Pelo teclado, as setas mudam de meio em meio. "Limpar" tira a
 * nota.
 */
export function ScoreInput({ kind, labelledBy, value, onChange }: ScoreInputProps) {
  const { t } = useI18n()
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value
  const empty = kind === "rating" ? t.rating.noRating : t.rating.noDifficulty

  function handleKeyDown(event: KeyboardEvent) {
    const next = scoreFromKey(event.key, value)
    if (next === undefined) return
    event.preventDefault()
    onChange(next)
  }

  return (
    <div className="flex h-9 items-center gap-3">
      <div
        role="slider"
        tabIndex={0}
        aria-labelledby={labelledBy}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={value ?? 0}
        aria-valuetext={value ? describeScore(kind, value, t) : empty}
        onKeyDown={handleKeyDown}
        onMouseLeave={() => setHover(null)}
        className="flex items-center gap-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {[0, 1, 2, 3, 4].map((index) => (
          <span key={index} className="relative">
            <ScoreIcon kind={kind} fill={shown ? iconFill(shown, index) : "empty"} className="size-7" />
            {[true, false].map((leftHalf) => {
              const score = scoreFromClick(index, leftHalf)
              return (
                <span
                  key={score}
                  data-score={score}
                  onMouseEnter={() => setHover(score)}
                  onClick={() => onChange(score)}
                  className={`absolute inset-y-0 w-1/2 cursor-pointer ${leftHalf ? "left-0" : "right-0"}`}
                />
              )
            })}
          </span>
        ))}
      </div>
      <span className="w-8 text-sm tabular-nums">{shown ? formatScore(shown, t.locale) : "—"}</span>
      {value !== null && (
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onChange(null)}>
          <X />
          {t.common.clear}
        </Button>
      )}
    </div>
  )
}
