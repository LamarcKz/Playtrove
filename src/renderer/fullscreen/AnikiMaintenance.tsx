import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import { useI18n } from "@/hooks/useI18n"

export interface AnikiMaintenanceHandle {
  back: () => boolean
}

/** Manutenção das preferências da tela cheia, com arquivo próprio do Playtrove e reset confirmado. */
export function AnikiMaintenance({ ref }: { ref?: Ref<AnikiMaintenanceHandle> }) {
  const { t } = useI18n()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const mounted = useRef(false)
  const busy = useRef(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const restore = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (confirming) cancel.current?.focus()
    else if (wasConfirming.current) restore.current?.focus()
    wasConfirming.current = confirming
  }, [confirming])
  useImperativeHandle(ref, () => ({ back: () => {
    if (busy.current) return true
    if (confirming) { setConfirming(false); return true }
    return false
  } }), [confirming])

  const run = async (action: () => Promise<boolean>, completed: string) => {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const changed = await action()
      if (mounted.current && changed) { setNotice(completed); setConfirming(false) }
    } catch (reason) {
      if (mounted.current) setError(String(reason))
    } finally {
      busy.current = false
      if (mounted.current) setPending(false)
    }
  }

  return <div className="aniki-quick-options overflow-y-auto" data-testid="aniki-maintenance" aria-busy={pending}>
    <h2>{t.fullscreenProfiles.title}</h2>
    {confirming ? <section role="alertdialog" aria-label={t.fullscreenProfiles.resetTitle}>
      <h3 className="text-[28px]">{t.fullscreenProfiles.resetTitle}</h3>
      <p className="my-5 text-[22px]">{t.fullscreenProfiles.resetDescription}</p>
      <div className="aniki-menu-items">
        <button ref={cancel} type="button" data-fs-default aria-disabled={pending} onClick={() => { if (!busy.current) setConfirming(false) }}>{t.common.cancel}</button>
        <button type="button" aria-disabled={pending} onClick={() => void run(async () => { await window.api.fullscreenProfiles.reset(); return true }, t.fullscreenProfiles.resetDone)}>{t.fullscreenProfiles.reset}</button>
      </div>
    </section> : <>
      <p className="mb-5 text-[22px]">{t.fullscreenProfiles.description}</p>
      <div className="aniki-menu-items">
        <button type="button" data-fs-default aria-disabled={pending} onClick={() => void run(() => window.api.fullscreenProfiles.export(), t.fullscreenProfiles.exportDone)}>{t.fullscreenProfiles.export}</button>
        <button type="button" aria-disabled={pending} onClick={() => void run(async () => (await window.api.fullscreenProfiles.import()) !== null, t.fullscreenProfiles.importDone)}>{t.fullscreenProfiles.import}</button>
        <button ref={restore} type="button" aria-disabled={pending} onClick={() => { if (!busy.current) { setError(null); setNotice(null); setConfirming(true) } }}>{t.fullscreenProfiles.reset}</button>
      </div>
    </>}
    {error && <p role="alert" className="mt-5 text-[22px]">{error}</p>}
    {notice && <p role="status" className="mt-5 text-[22px]">{notice}</p>}
  </div>
}
