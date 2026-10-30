import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import { DEFAULT_ANIKI_NEWS, type AnikiNewsConfig, type AnikiNewsError, type AnikiNewsLabels } from "@shared/anikiNews"
import { anikiNewsError } from "@/lib/anikiNews"
import { FullscreenKeyboard } from "./FullscreenKeyboard"

export interface AnikiNewsPreferencesHandle { back(): boolean }
type Field = { source: "sourceA" | "sourceB"; key: "title" | "url"; title: string }

export function AnikiNewsPreferences({ config, labels, onSave, onCancel, ref }: {
  config: AnikiNewsConfig
  labels: AnikiNewsLabels
  onSave(config: AnikiNewsConfig): Promise<void>
  onCancel(): void
  ref?: Ref<AnikiNewsPreferencesHandle>
}) {
  const [draft, setDraft] = useState(() => structuredClone(config))
  const [field, setField] = useState<Field | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AnikiNewsError | null>(null)
  const saving = useRef(false)
  const scope = useRef<HTMLElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const alive = useRef(false)
  useEffect(() => { alive.current = true; scope.current?.querySelector<HTMLButtonElement>("button")?.focus(); return () => { alive.current = false } }, [])
  useEffect(() => { if (field) scope.current?.querySelector<HTMLButtonElement>(".fs-keyboard button")?.focus(); else returnFocus.current?.focus() }, [field])
  useImperativeHandle(ref, () => ({ back: () => {
    if (saving.current) return true
    if (field) { setField(null); return true }
    return false
  } }), [field])
  const save = async () => {
    if (saving.current) return
    saving.current = true; setPending(true); setError(null)
    try { await onSave(draft); if (alive.current) onCancel() }
    catch (reason) { if (alive.current) setError(anikiNewsError(reason)) }
    finally { saving.current = false; if (alive.current) setPending(false) }
  }
  return <section className="aniki-news-preferences" ref={scope} aria-label={labels.settings} aria-busy={pending} data-testid="aniki-news-preferences">
    {field ? <FullscreenKeyboard title={field.title} initial={draft[field.source][field.key]} onCancel={() => setField(null)} onApply={(value) => {
      setDraft((current) => ({ ...current, [field.source]: { ...current[field.source], [field.key]: value } })); setField(null)
    }} /> : <>
      <h2>{labels.settings}</h2>
      <div className="aniki-menu-items" data-fs-scroll tabIndex={0}>
        <button type="button" data-fs-default disabled={pending} aria-pressed={draft.enabled} onClick={() => setDraft((current) => ({ ...current, enabled: !current.enabled }))}>{labels.enabled}</button>
        {(["sourceA", "sourceB"] as const).map((source) => <section key={source}>
          <h3>{labels[source]}</h3>
          {(["title", "url"] as const).map((key) => <button type="button" key={key} disabled={pending} onClick={(event) => {
            returnFocus.current = event.currentTarget
            setField({ source, key, title: `${labels[source]} · ${key === "title" ? labels.feedTitle : labels.feedUrl}` })
          }}><strong>{key === "title" ? labels.feedTitle : labels.feedUrl}</strong><span>{draft[source][key]}</span></button>)}
        </section>)}
      </div>
      {error && <p role="alert">{labels.errors[error]}</p>}
      <div className="aniki-news-preferences-actions">
        <button type="button" disabled={pending} onClick={() => setDraft(structuredClone(DEFAULT_ANIKI_NEWS))}>{labels.restoreDefaults}</button>
        <button type="button" disabled={pending} onClick={onCancel}>{labels.cancel}</button>
        <button type="button" disabled={pending} onClick={() => void save()}>{labels.save}</button>
      </div>
    </>}
  </section>
}
