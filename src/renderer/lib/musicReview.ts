import type { Game, MusicReview } from "@shared/types"

/** Ausência anterior permite nova tentativa explícita; uma lista aguardando escolha permanece. */
export function needsMusicDownload(game: Game, reviews: MusicReview[]) {
  return game.themeMusicMode === "auto" && !game.themeMusicUrl
    && !reviews.some((review) => review.gameId === game.id && review.state === "needsChoice")
}

export function reviewableMusic(reviews: MusicReview[], running: boolean) {
  return running ? [] : reviews.filter((review) => review.state === "needsChoice")
}
