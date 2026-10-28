import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import type { GameMediaItem } from "@shared/gameMedia"
import type { Game } from "@shared/types"
import { useI18n } from "@/hooks/useI18n"

export interface AnikiGalleryHandle {
  /** Consome o voltar ao sair da ampliação ou da confirmação de remoção. */
  back: () => boolean
  navigate: (direction: "left" | "right") => boolean
}

/** Galeria de cópias internas: grade, imagem ampliada e remoção com confirmação. */
export function AnikiGallery({ game, ref }: { game: Game; ref?: Ref<AnikiGalleryHandle> }) {
  const { t } = useI18n()
  const [items, setItems] = useState<GameMediaItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const viewer = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const mounted = useRef(false)
  const busy = useRef(false)
  const generation = useRef(0)
  const index = Math.max(0, items.findIndex((item) => item.id === selected))
  const current = items[index]

  const run = useCallback(async (action: () => Promise<GameMediaItem[]>) => {
    if (busy.current) return
    busy.current = true
    const request = ++generation.current
    setPending(true)
    setError(null)
    try {
      const next = await action()
      if (mounted.current && request === generation.current) {
        setItems(next)
        setSelected((previous) => next.some((item) => item.id === previous) ? previous : next[0]?.id ?? null)
        if (!next.length) setExpanded(false)
        setConfirming(null)
      }
    } catch (reason) {
      if (mounted.current && request === generation.current) setError(String(reason))
    } finally {
      if (request === generation.current) {
        busy.current = false
        if (mounted.current) setPending(false)
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    busy.current = false
    generation.current++
    setItems([])
    setSelected(null)
    setExpanded(false)
    setConfirming(null)
    void run(() => window.api.gameMedia.list(game.id))
    return () => { mounted.current = false; generation.current++; busy.current = false }
  }, [game.id, run])

  useEffect(() => {
    if (confirming) cancel.current?.focus()
    else if (expanded) viewer.current?.focus()
    else if (selected) root.current?.querySelector<HTMLButtonElement>(`[data-media-id="${selected}"]`)?.focus()
  }, [expanded, confirming, selected])

  useImperativeHandle(ref, () => ({
    back: () => {
      if (busy.current) return true
      if (confirming) { setConfirming(null); return true }
      if (expanded) { setExpanded(false); return true }
      return false
    },
    navigate: (direction) => {
      if (!expanded || confirming) return false
      move(direction === "right" ? 1 : -1)
      return true
    },
  }), [confirming, expanded, items, index])

  const move = (step: number) => {
    if (busy.current || items.length < 2) return
    setSelected(items[(index + step + items.length) % items.length].id)
  }

  return <div ref={root} className="flex h-[1080px] flex-col gap-5 px-[100px] py-10" data-testid="aniki-gallery" aria-busy={pending}
    onKeyDown={(event) => {
      if (expanded && !confirming && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault()
        event.stopPropagation()
        move(event.key === "ArrowRight" ? 1 : -1)
      }
    }}>
    <header className="flex items-center justify-between gap-5 text-[36px]"><h2>{t.gameMedia.title}</h2><span className="truncate text-[28px]">{game.title}</span></header>
    {confirming ? <section className="fs-power-confirm m-auto max-w-[1000px]" role="alertdialog" aria-label={t.gameMedia.removeTitle}>
      <h3 className="text-[34px]">{t.gameMedia.removeTitle}</h3>
      <p className="mt-5 text-[26px]">{t.gameMedia.removeConfirm}</p>
      <div className="fs-dialog-actions">
        <button ref={cancel} type="button" data-fs-default aria-disabled={pending} onClick={() => { if (!busy.current) setConfirming(null) }}>{t.common.cancel}</button>
        <button type="button" aria-disabled={pending} onClick={() => void run(() => window.api.gameMedia.remove(game.id, confirming))}>{t.common.remove}</button>
      </div>
    </section> : <>
      <div className="aniki-trophies-tools flex-wrap">
        <button type="button" data-fs-default aria-disabled={pending} onClick={() => void run(() => window.api.gameMedia.import(game.id))}>{t.gameMedia.importImages}</button>
        <button type="button" aria-disabled={pending} onClick={() => void run(() => window.api.gameMedia.list(game.id))}>{t.gameMedia.refresh}</button>
        <button type="button" disabled={!current} aria-disabled={pending} onClick={() => { if (!busy.current) setExpanded(!expanded) }}>{expanded ? t.gameMedia.collapse : t.gameMedia.expand}</button>
        <button type="button" disabled={!current} aria-disabled={pending} onClick={() => { if (!busy.current && current) setConfirming(current.id) }}>{t.common.remove}</button>
      </div>
      {!items.length ? <p className="m-auto text-center text-[28px]">{pending ? t.common.loading : t.gameMedia.empty}</p> : expanded && current ?
        <button ref={viewer} type="button" className="min-h-0 flex-1 overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-[var(--aniki-light)]" aria-label={t.gameMedia.collapse} onClick={() => setExpanded(false)}>
          <img src={current.url} alt={t.gameMedia.imageLabel(index + 1, items.length)} className="h-full w-full object-contain" />
        </button> : <div className="grid min-h-0 flex-1 grid-cols-4 content-start gap-5 overflow-y-auto p-1" data-fs-scroll>
          {items.map((item, itemIndex) => <button type="button" key={item.id} data-media-id={item.id} aria-label={t.gameMedia.imageLabel(itemIndex + 1, items.length)} aria-pressed={current?.id === item.id}
            className="flex h-[230px] flex-col overflow-hidden rounded-xl bg-[var(--aniki-button-idle)] focus-visible:outline-2 focus-visible:outline-[var(--aniki-light)]" onFocus={() => setSelected(item.id)}
            onClick={() => { if (!busy.current) { setSelected(item.id); setExpanded(true) } }}>
            <img src={item.url} alt="" loading="lazy" className="min-h-0 w-full flex-1 object-contain" /><span className="p-2 text-[20px]">{t.gameMedia.imageLabel(itemIndex + 1, items.length)}</span>
          </button>)}
        </div>}
      <div className="aniki-trophies-tools items-center justify-center">
        <button type="button" disabled={items.length < 2} aria-disabled={pending} onClick={() => move(-1)}>{t.gameMedia.previous}</button>
        <output className="px-6 text-[26px]" aria-live="polite">{items.length ? t.gameMedia.imageLabel(index + 1, items.length) : t.gameMedia.count(0)}</output>
        <button type="button" disabled={items.length < 2} aria-disabled={pending} onClick={() => move(1)}>{t.gameMedia.next}</button>
      </div>
    </>}
    {error && <p role="alert" className="text-[24px]">{error}</p>}
  </div>
}
