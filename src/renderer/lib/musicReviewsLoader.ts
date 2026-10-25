import type { Game, MusicReview } from "@shared/types"
import { needsMusicDownload } from "@/lib/musicReview"

export interface MusicReviewsState {
  reviews: MusicReview[] | null
  loading: boolean
  error: string | null
}

/** A lista desconhecida nunca é tratada como uma consulta concluída sem escolhas. */
export class MusicReviewsLoader {
  private state: MusicReviewsState = { reviews: null, loading: true, error: null }
  private revision = 0
  private listeners = new Set<() => void>()
  constructor(private read: () => Promise<MusicReview[]>) {}

  getSnapshot = () => this.state
  subscribe = (callback: () => void) => {
    this.listeners.add(callback)
    return () => { this.listeners.delete(callback) }
  }
  invalidate() { this.revision++ }
  refresh = async () => {
    const current = ++this.revision
    this.update({ ...this.state, loading: true, error: null })
    try {
      const reviews = await this.read()
      if (current === this.revision) this.update({ reviews, loading: false, error: null })
    } catch (error) {
      if (current === this.revision) this.update({ ...this.state, loading: false, error: String(error) })
    }
  }
  private update(state: MusicReviewsState) {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }
}

export function missingMusicCount(games: Game[], state: MusicReviewsState) {
  if (state.loading || state.error || state.reviews === null) return null
  return games.filter((game) => needsMusicDownload(game, state.reviews!)).length
}
