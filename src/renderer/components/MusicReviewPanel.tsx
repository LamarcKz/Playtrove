import { useState, type ReactNode } from "react"
import type { MusicReview } from "@shared/types"
import { Button } from "@/components/ui/button"
import { MusicReviewDialog } from "@/components/MusicReviewDialog"
import { useI18n } from "@/hooks/useI18n"
import { useMusicReviews } from "@/hooks/useMusicReviews"
import { useMetadataProgress } from "@/hooks/useMetadataProgress"
import { reviewableMusic } from "@/lib/musicReview"
import type { MusicReviewsState } from "@/lib/musicReviewsLoader"

export function MusicReviewPanel({ compact = false }: { compact?: boolean }) {
  const state = useMusicReviews()
  return <MusicReviewList compact={compact} state={state} onRetry={state.refresh} />
}

/** O resumo de Metadados e a lista recebem exatamente a mesma leitura das revisões. */
export function MusicReviewList({ compact = false, state, onRetry }: { compact?: boolean; state: MusicReviewsState; onRetry: () => Promise<void> }) {
  const { t } = useI18n()
  const progress = useMetadataProgress()
  const [selected, setSelected] = useState<MusicReview | null>(null)
  const selectedDialog = selected && <MusicReviewDialog gameId={selected.gameId} gameTitle={selected.gameTitle} review={selected} open onOpenChange={(open) => { if (!open) setSelected(null) }} />
  let content: ReactNode = null
  if (state.loading || state.error || state.reviews === null) {
    if (!compact) content = <div className="flex flex-wrap items-center gap-2">
      <p role={state.error ? "alert" : "status"} className="text-xs text-muted-foreground">{state.error ? t.music.reviewLoadError : t.music.loadingReviews}</p>
      {state.error && <Button size="sm" variant="outline" onClick={() => void onRetry()}>{t.music.retryReviews}</Button>}
    </div>
  } else {
    const reviews = state.reviews
    const running = progress?.running !== false
    const choices = reviewableMusic(reviews, running)
    const other = reviews.filter((review) => review.state !== "needsChoice")
    if (compact) {
      if (choices.length > 0 && !running) content = <Button size="sm" variant="outline" onClick={() => setSelected(choices[0])}>{t.music.review} ({choices.length})</Button>
    } else content = <>
      {reviews.some((review) => review.state === "needsChoice") && <p className="text-sm text-muted-foreground">{t.music.reviewCount(reviews.filter((review) => review.state === "needsChoice").length)}</p>}
      {running && reviews.length > 0 && <p className="text-xs text-muted-foreground">{t.music.pending}</p>}
      {reviews.filter((review) => review.state === "needsChoice").map((review) => <div key={review.gameId} className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm break-words">{review.gameTitle}</span>
        <Button size="sm" variant="outline" disabled={running} onClick={() => setSelected(review)}>{t.music.review}</Button>
      </div>)}
      {other.length > 0 && <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">{t.music.noResults} ({other.length})</summary>
        <div className="mt-3 flex flex-col gap-2">{other.map((review) => <div key={review.gameId} className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 text-sm break-words">{review.gameTitle}</span>
          <Button size="sm" variant="ghost" disabled={running} onClick={() => setSelected(review)}>{t.music.search}</Button>
        </div>)}</div>
      </details>}
    </>
  }
  // O portal do diálogo ocupa sempre o segundo filho da mesma raiz, inclusive sem lista visível.
  return <>
    <div className={compact ? "ml-auto flex items-center gap-2" : "flex min-w-0 flex-col gap-3"}>{content}</div>
    {selectedDialog}
  </>
}
