import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react"
import { LoaderCircle, Pause, Play } from "lucide-react"
import type { MusicReview } from "@shared/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/hooks/useI18n"
import { useMusicConfig } from "@/hooks/useMusicConfig"
import { useRunningGamesState } from "@/hooks/useRunningGames"
import { useMetadataProgress } from "@/hooks/useMetadataProgress"
import { useToast } from "@/hooks/useToast"
import { errorMessage } from "@/lib/errors"
import { MusicPreviewPlayer, type MusicPreviewState } from "@/lib/musicPreviewPlayer"

interface Props {
  gameId: number
  gameTitle: string
  review?: MusicReview
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MusicReviewDialog(props: Props) {
  const player = useRef<MusicPreviewPlayer | null>(null)
  const onOpenChange = (open: boolean) => {
    if (!open) player.current?.stop()
    props.onOpenChange(open)
  }
  return <Dialog open={props.open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
      <MusicReviewForm key={props.gameId} {...props} player={player} onOpenChange={onOpenChange} />
    </DialogContent>
  </Dialog>
}

function MusicReviewForm({ gameId, gameTitle, review: initialReview, onOpenChange, player }: Props & { player: RefObject<MusicPreviewPlayer | null> }) {
  const { t } = useI18n()
  const toast = useToast()
  const { config } = useMusicConfig()
  const { running, loading } = useRunningGamesState()
  const progress = useMetadataProgress()
  const [review, setReview] = useState<MusicReview | undefined>(initialReview)
  const [query, setQuery] = useState(initialReview?.query || gameTitle)
  const [busy, setBusy] = useState<"search" | "save" | "import" | null>(null)
  const [limit, setLimit] = useState(3)
  const [preview, setPreview] = useState<MusicPreviewState>({ videoId: null, loading: false, playing: false, failed: false })
  const audio = useRef<HTMLAudioElement>(null)
  const revision = useRef(0)
  const mounted = useRef(false)
  const queryId = useId()
  const blocked = loading || running.length > 0 || progress?.running === true

  useEffect(() => {
    mounted.current = true
    const instance = new MusicPreviewPlayer(audio.current!, window.api.music, setPreview)
    player.current = instance
    if (!initialReview) {
      const current = revision.current
      void window.api.music.getReviews().then((reviews) => {
        if (mounted.current && current === revision.current) {
          const existing = reviews.find((item) => item.gameId === gameId)
          if (existing) { setReview(existing); setQuery(existing.query || gameTitle) }
        }
      }).catch(() => {})
    }
    // Uma importação, remoção ou reativação externa invalida a lista que estava aberta.
    const stopLibrary = window.api.library.onChange(() => {
      instance.stop()
      const current = ++revision.current
      void window.api.music.getReviews().then((reviews) => {
        if (mounted.current && current === revision.current) setReview(reviews.find((item) => item.gameId === gameId))
      }).catch(() => {})
    })
    const stopPlayback = () => instance.stop()
    const visibility = () => { if (document.hidden) instance.stop() }
    window.addEventListener("blur", stopPlayback)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      mounted.current = false
      revision.current++
      instance.dispose()
      player.current = null
      stopLibrary()
      window.removeEventListener("blur", stopPlayback)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [])

  useEffect(() => { if (blocked) player.current?.stop() }, [blocked])
  useEffect(() => { player.current?.setVolume(config?.volume ?? 20) }, [config?.volume])

  async function search(event: FormEvent) {
    event.preventDefault()
    player.current?.stop()
    const current = ++revision.current
    setBusy("search")
    try {
      const result = await window.api.music.search(gameId, query.trim() || undefined)
      if (mounted.current && current === revision.current) { setReview(result); setLimit(3) }
    } catch (error) {
      if (mounted.current && current === revision.current) toast({ kind: "error", title: t.music.downloadError, description: errorMessage(error) })
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  async function choose(videoId: string) {
    if (!review) return
    setBusy("save")
    try {
      const operationId = await player.current?.prepareChoice()
      if (!operationId || !mounted.current) return
      await window.api.music.choose(gameId, review.generation, videoId, operationId)
      if (mounted.current) { toast({ kind: "success", title: t.music.saved }); onOpenChange(false) }
    } catch (error) {
      if (mounted.current) toast({ kind: "error", title: t.actions.themeMusicError, description: errorMessage(error) })
    } finally { if (mounted.current) setBusy(null) }
  }

  async function importTrack() {
    player.current?.stop()
    revision.current++
    setBusy("import")
    try {
      const before = (await window.api.library.get()).games.find((game) => game.id === gameId)?.themeMusicUrl
      await window.api.games.pickThemeMusic(gameId)
      if (mounted.current) {
        // Cancelar o diálogo nativo mantém a revisão aberta; só fecha após uma importação salva.
        const snapshot = await window.api.library.get()
        const saved = snapshot.games.find((game) => game.id === gameId)
        if (saved?.themeMusicMode === "manual" && saved.themeMusicUrl !== before) onOpenChange(false)
      }
    } catch (error) {
      if (mounted.current) toast({ kind: "error", title: t.actions.themeMusicError, description: errorMessage(error) })
    } finally { if (mounted.current) setBusy(null) }
  }

  return <>
    <DialogHeader>
      <DialogTitle>{t.music.chooseTitle(gameTitle)}</DialogTitle>
      <DialogDescription>{t.music.reviewHint}</DialogDescription>
    </DialogHeader>
    <audio ref={audio} data-music-preview preload="none" onEnded={() => { void player.current?.prepareChoice() }} onError={() => player.current?.reportError()} />
    <form className="flex flex-col gap-2" onSubmit={(event) => void search(event)}>
      <label htmlFor={queryId} className="text-sm">{t.music.searchLabel}</label>
      <div className="flex flex-wrap gap-2">
        <Input id={queryId} value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1" />
        <Button type="submit" disabled={busy !== null || progress?.running !== false}>
          {busy === "search" && <LoaderCircle className="animate-spin" />}
          {busy === "search" ? t.music.searching : t.music.search}
        </Button>
      </div>
    </form>
    {progress?.running && <p role="status" className="text-sm text-muted-foreground">{t.music.pending}</p>}
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      {review?.state === "notFound" && <p role="status" className="text-sm text-muted-foreground">{t.music.notFound}</p>}
      {review?.error && <p role="alert" className="text-sm text-muted-foreground">{t.music.failed} {review.error}</p>}
      {review?.candidates.slice(0, limit).map((candidate) => {
        const current = preview.videoId === candidate.videoId
        const duration = candidate.duration === null ? null : `${Math.floor(candidate.duration / 60)}:${String(Math.floor(candidate.duration % 60)).padStart(2, "0")}`
        return <div key={candidate.videoId} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border p-3">
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-sm font-medium break-words">{candidate.title}</p>
            <p className="text-xs text-muted-foreground">{[candidate.channel, duration].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={blocked || busy !== null} onClick={() => {
              if (current) player.current?.stop()
              else void player.current?.listen(gameId, review.generation, candidate.videoId, config?.volume ?? 20)
            }}>
              {current && preview.loading ? <LoaderCircle className="animate-spin" /> : current && preview.playing ? <Pause /> : <Play />}
              {current && preview.loading ? t.music.loadingPreview : current && preview.playing ? t.music.stopPreview : t.music.listen}
            </Button>
            <Button disabled={busy !== null || progress?.running !== false} onClick={() => void choose(candidate.videoId)}>{busy === "save" ? t.music.saving : t.music.use}</Button>
          </div>
        </div>
      })}
      {review && review.candidates.length > limit && <Button variant="ghost" onClick={() => setLimit((value) => value + 5)}>{t.music.more}</Button>}
    </div>
    <p className="text-xs text-muted-foreground">{preview.failed ? t.music.unavailable : t.music.previewHint}</p>
    <DialogFooter className="flex-wrap">
      <Button variant="outline" disabled={busy !== null} onClick={() => void importTrack()}>{t.music.import}</Button>
      <Button variant="secondary" onClick={() => onOpenChange(false)}>{t.music.later}</Button>
    </DialogFooter>
  </>
}
