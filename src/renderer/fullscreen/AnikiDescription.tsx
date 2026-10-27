import type { Game } from "@shared/types"
import { useI18n } from "@/hooks/useI18n"

/** Painel de descrição do Signature (botão de informações), com a análise do Playtrove logo abaixo. */
export function AnikiDescription({ game, onEditReview }: { game: Game; onEditReview: () => void }) {
  const { t } = useI18n()
  return <div className="aniki-description">
    <h2>{game.title}</h2>
    <div className="fs-description" data-testid="fullscreen-description" data-fs-scroll tabIndex={0}>
      <h3>{t.details.description}</h3>
      <p>{game.description || t.fullscreen.noDescription}</p>
      {game.review && <><h3>{t.fullscreen.review}</h3><p className="fs-review-text">{game.review}</p></>}
    </div>
    <button type="button" data-fs-default onClick={onEditReview}>{t.fullscreen.editReview}</button>
  </div>
}
