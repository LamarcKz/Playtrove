import { useId, useState, type FormEvent } from "react"
import { MAX_REVIEW_LENGTH } from "@shared/evaluation"
import type { Game } from "@shared/types"
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
import { Textarea } from "@/components/ui/textarea"
import { useI18n } from "@/hooks/useI18n"
import { useToast } from "@/hooks/useToast"
import { errorMessage } from "@/lib/errors"

interface ReviewDialogProps {
  game: Game
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Janela "Minha análise" (menu Mais → "Escrever análise…"): o que o usuário achou do jogo, em
 * texto livre. Fica separada da nota e da dificuldade (escolha do usuário em 2026-09-24).
 */
export function ReviewDialog({ game, open, onOpenChange }: ReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* O formulário só existe com a janela aberta: cada vez que abre, começa com o que está salvo. */}
        <ReviewForm game={game} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function ReviewForm({ game, onDone }: { game: Game; onDone: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const [review, setReview] = useState(game.review ?? "")
  const [saving, setSaving] = useState(false)
  const id = useId()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await window.api.games.setEvaluation(game.id, { review: review.trim() || null })
      onDone()
    } catch (error) {
      toast({ kind: "error", title: t.review.saveError, description: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>{t.review.title(game.title)}</DialogTitle>
        <DialogDescription>{t.review.hint}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="sr-only">
          {t.review.label}
        </label>
        <Textarea
          id={id}
          value={review}
          maxLength={MAX_REVIEW_LENGTH}
          onChange={(event) => setReview(event.target.value)}
          placeholder={t.review.placeholder}
          className="max-h-96 min-h-44"
        />
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
