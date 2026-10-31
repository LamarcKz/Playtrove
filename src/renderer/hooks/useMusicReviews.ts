import { useEffect, useState, useSyncExternalStore } from "react"
import { MusicReviewsLoader } from "@/lib/musicReviewsLoader"

/** Listas persistidas, também recuperadas depois de reabrir o app ou terminar a fila inteira. */
export function useMusicReviews() {
  const [loader] = useState(() => new MusicReviewsLoader(() => window.api.music.getReviews()))
  const state = useSyncExternalStore(loader.subscribe, loader.getSnapshot)
  useEffect(() => {
    void loader.refresh()
    const stopLibrary = window.api.library.onChange(() => void loader.refresh())
    const stopProgress = window.api.metadata.onProgress((progress) => { if (!progress.running) void loader.refresh() })
    return () => { loader.invalidate(); stopLibrary(); stopProgress() }
  }, [loader])
  return { ...state, refresh: loader.refresh }
}
