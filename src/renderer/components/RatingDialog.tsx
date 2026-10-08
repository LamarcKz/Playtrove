import { useId, useState, type FormEvent } from "react"
import type { Game } from "@shared/types"
import { ScoreInput } from "@/components/ScoreInput"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useI18n } from "@/hooks/useI18n"
import { useToast } from "@/hooks/useToast"
import { errorMessage } from "@/lib/errors"

interface RatingDialogProps {
  game: Game
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Janela "Avaliar jogo" (menu Mais): a nota em estrelas e a dificuldade em pimentas, as duas com
 * meio ícone. A análise tem a janela dela (ReviewDialog), por escolha do usuário em 2026-09-24.
 */
export function RatingDialog({ game, open, onOpenChange }: RatingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* O formulário só existe com a janela aberta: cada vez que abre, começa com o que está salvo. */}
        <RatingForm game={game} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function RatingForm({ game, onDone }: { game: Game; onDone: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const [rating, setRating] = useState(game.rating)
  const [difficulty, setDifficulty] = useState(game.difficulty)
  const [saving, setSaving] = useState(false)
  const ids = { rating: useId(), difficulty: useId() }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await window.api.games.setEvaluation(game.id, { rating, difficulty })
      onDone()
    } catch (error) {
      toast({ kind: "error", title: t.rating.saveError, description: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>{t.rating.title(game.title)}</DialogTitle>
        <DialogDescription>{t.rating.hint}</DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-[6.5rem_1fr] items-center gap-y-3">
        <span id={ids.rating} className="text-sm text-muted-foreground">
          {t.fields.rating}
        </span>
        <ScoreInput kind="rating" labelledBy={ids.rating} value={rating} onChange={setRating} />
        <span id={ids.difficulty} className="text-sm text-muted-foreground">
          {t.fields.difficulty}
        </span>
        <ScoreInput kind="difficulty" labelledBy={ids.difficulty} value={difficulty} onChange={setDifficulty} />
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            {t.common.cancel}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={saving}>
          {t.common.save}
        </Button>
      </DialogFooter>
    </form>
  )
}
