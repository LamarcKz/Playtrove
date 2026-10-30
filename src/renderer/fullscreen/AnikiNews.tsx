import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import { DEFAULT_ANIKI_NEWS, type AnikiNewsApi, type AnikiNewsLabels } from "@shared/anikiNews"
import { AnikiNewsReader, type AnikiNewsReaderState } from "@/lib/anikiNews"
import { AnikiNewsPreferences, type AnikiNewsPreferencesHandle } from "./AnikiNewsPreferences"
import "./AnikiNews.css"

const initialState: AnikiNewsReaderState = { source: "A", enabled: true, pending: true, snapshot: null, selectedId: null, error: null, config: null }
const imageSource = (value: string | null) => value && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : undefined

/** Leitor das duas fontes locais em cache; todo texto e todas as ações vêm por contratos explícitos. */
export interface AnikiNewsHandle { back(): boolean }
export function AnikiNews({ api, labels, locale, ref }: { api: AnikiNewsApi; labels: AnikiNewsLabels; locale: string; ref?: Ref<AnikiNewsHandle> }) {
  const reader = useRef<AnikiNewsReader | null>(null)
  const [state, setState] = useState(initialState)
  const [preferences, setPreferences] = useState(false)
  const preferencesRef = useRef<AnikiNewsPreferencesHandle>(null)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const articleRegion = useRef<HTMLElement>(null)
  useEffect(() => {
    const current = new AnikiNewsReader(api)
    reader.current = current
    const unsubscribe = current.subscribe(setState)
    void current.load("A")
    return () => { unsubscribe(); current.dispose(); if (reader.current === current) reader.current = null }
  }, [api])
  useEffect(() => { articleRegion.current?.scrollTo?.({ top: 0 }) }, [state.selectedId])
  useImperativeHandle(ref, () => ({ back: () => {
    if (!preferences) return false
    if (!preferencesRef.current?.back()) { setPreferences(false); requestAnimationFrame(() => settingsButton.current?.focus()) }
    return true
  } }), [preferences])
  const config = state.config ?? DEFAULT_ANIKI_NEWS
  const selected = state.snapshot?.items.find((item) => item.id === state.selectedId)
  const date = (value: string) => new Date(value).toLocaleDateString(locale)
  if (preferences) return <AnikiNewsPreferences ref={preferencesRef} config={config} labels={labels} onSave={async (draft) => { await reader.current?.saveConfig(draft) }}
    onCancel={() => { setPreferences(false); requestAnimationFrame(() => settingsButton.current?.focus()) }} />
  return <section className="aniki-news" data-testid="aniki-news" aria-label={labels.title} aria-busy={state.pending}>
    <header className="aniki-news-header">
      <h2>{labels.title}</h2>
      <nav role="tablist" aria-label={labels.title}>
        {(["A", "B"] as const).map((source) => <button type="button" role="tab" key={source} data-fs-default={source === "A" ? true : undefined}
          id={`aniki-news-tab-${source}`} aria-controls="aniki-news-content" aria-selected={state.source === source}
          onClick={() => { if (state.source !== source) void reader.current?.load(source) }}>
          {source === "A" ? config.sourceA.title : config.sourceB.title}
        </button>)}
      </nav>
      <button ref={settingsButton} type="button" disabled={state.pending && !state.config} onClick={() => { reader.current?.cancel(); setPreferences(true) }}>{labels.settings}</button>
      <button type="button" disabled={!state.enabled} onClick={() => state.pending ? reader.current?.cancel() : void reader.current?.load(state.source, true)}>
        {state.pending ? labels.cancel : labels.refresh}
      </button>
    </header>
    {state.error && <p className="aniki-news-notice" role="alert">{labels.errors[state.error]}</p>}
    {state.snapshot?.fromCache && state.snapshot.stale && <p className="aniki-news-notice" role="status">{labels.cached}</p>}
    {!state.enabled ? <p role="status">{labels.disabled}</p> : <div className="aniki-news-body" id="aniki-news-content" role="tabpanel" aria-labelledby={`aniki-news-tab-${state.source}`}>
      <div className="aniki-news-list" role="list" aria-label={state.snapshot?.title ?? labels.title}>
        {state.snapshot?.items.map((item) => <div role="listitem" key={item.id}>
          <button type="button" aria-pressed={item.id === state.selectedId} onClick={() => reader.current?.select(item.id)}>
            {imageSource(item.imageDataUrl) && <img src={imageSource(item.imageDataUrl)} alt="" loading="lazy" draggable={false} />}
            <span><time dateTime={item.publishedAt}>{date(item.publishedAt)}</time><strong>{item.title}</strong><span>{item.summary}</span></span>
          </button>
        </div>)}
        {!state.snapshot?.items.length && <p role="status">{state.pending ? labels.loading : labels.empty}</p>}
      </div>
      {selected && <article className="aniki-news-article" ref={articleRegion} data-fs-scroll tabIndex={0} aria-label={selected.title}>
        <time dateTime={selected.publishedAt}>{date(selected.publishedAt)}</time>
        <h3>{selected.title}</h3>
        {imageSource(selected.imageDataUrl) && <img src={imageSource(selected.imageDataUrl)} alt="" draggable={false} />}
        {selected.contentText.split(/\n{2,}/).filter(Boolean).map((text, index) => <p key={index}>{text}</p>)}
        {selected.url && <button type="button" onClick={() => void reader.current?.openOriginal()}>{labels.openOriginal}</button>}
      </article>}
    </div>}
  </section>
}
