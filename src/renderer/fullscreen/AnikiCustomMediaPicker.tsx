import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import type { Game } from "@shared/types"
import { useI18n } from "@/hooks/useI18n"

export interface AnikiCustomMediaPickerHandle { back: () => boolean }
type Target = "avatar" | "logo" | "globalSplash"
interface Props { target: Target; game?: Game; ref?: Ref<AnikiCustomMediaPickerHandle> }

/** Imagens escolhidas pelo usuário; a remoção confirma somente a cópia personalizada. */
export function AnikiCustomMediaPicker({ target, game, ref }: Props) {
  const { t } = useI18n()
  const labels = t.anikiCustomMedia
  const [url, setUrl] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  const busy = useRef(false)
  const generation = useRef(0)
  const cancel = useRef<HTMLButtonElement>(null)
  const removeButton = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  const title = target === "avatar" ? labels.avatarTitle : target === "logo" ? labels.logoTitle : labels.globalSplashTitle
  const pickLabel = target === "avatar" ? labels.pickAvatar : target === "logo" ? labels.pickLogo : labels.pickGlobalSplash
  const removeLabel = target === "avatar" ? labels.removeAvatar : target === "logo" ? labels.removeLogo : labels.removeGlobalSplash
  const empty = target === "avatar" ? labels.emptyAvatar : target === "logo" ? labels.emptyLogo : labels.emptyGlobalSplash
  const removable = !!url && (target !== "logo" || url.includes("/logo-local-"))
  const api = window.api.anikiCustomMedia

  useEffect(() => {
    mounted.current = true
    busy.current = true
    const request = ++generation.current
    setPending(true)
    setError(null)
    setConfirming(false)
    setUrl(null)
    const load = target === "avatar" ? api.getAvatar() : target === "globalSplash" ? api.getGlobalSplash() : Promise.resolve(game?.logoUrl ?? null)
    void load.then((next) => { if (mounted.current && request === generation.current) setUrl(next) })
      .catch((reason) => { if (mounted.current && request === generation.current) setError(String(reason)) })
      .finally(() => { if (mounted.current && request === generation.current) { busy.current = false; setPending(false) } })
    return () => { mounted.current = false; generation.current++; busy.current = false }
  }, [target, game?.id, game?.logoUrl, api])

  useEffect(() => {
    if (confirming) cancel.current?.focus()
    else if (wasConfirming.current) removeButton.current?.focus()
    wasConfirming.current = confirming
  }, [confirming])
  useImperativeHandle(ref, () => ({ back: () => {
    if (busy.current) return true
    if (confirming) { setConfirming(false); return true }
    return false
  } }), [confirming])

  const run = async (action: () => Promise<string | null | undefined>) => {
    if (busy.current) return
    busy.current = true
    const request = ++generation.current
    setPending(true)
    setError(null)
    try {
      const next = await action()
      if (mounted.current && request === generation.current && next !== undefined) { setUrl(next); setConfirming(false) }
    } catch (reason) {
      if (mounted.current && request === generation.current) setError(String(reason))
    } finally {
      if (mounted.current && request === generation.current) { busy.current = false; setPending(false) }
    }
  }
  const currentLogo = async () => (await window.api.library.get()).games.find((entry) => entry.id === game?.id)?.logoUrl ?? null
  const pick = async () => {
    if (target === "avatar") return (await api.pickAvatar()) ?? undefined
    if (target === "globalSplash") return (await api.pickGlobalSplash()) ?? undefined
    return game && await api.pickLogo(game.id) ? currentLogo() : undefined
  }
  const remove = async () => {
    if (target === "avatar") { await api.removeAvatar(); return null }
    if (target === "globalSplash") { await api.removeGlobalSplash(); return null }
    if (game) { await api.removeLogo(game.id); return currentLogo() }
    return undefined
  }

  return <div className="aniki-quick-options overflow-y-auto" data-testid="aniki-custom-media" data-target={target} aria-busy={pending}>
    <h2>{title}</h2>
    {confirming ? <section role="alertdialog" aria-label={labels.removeConfirm}>
      <h3 className="text-[28px]">{labels.removeConfirm}</h3>
      <p className="my-5 text-[22px]">{labels.removeDescription}</p>
      <div className="aniki-menu-items">
        <button ref={cancel} type="button" data-fs-default aria-disabled={pending} onClick={() => { if (!busy.current) setConfirming(false) }}>{t.common.cancel}</button>
        <button type="button" aria-disabled={pending} onClick={() => void run(remove)}>{removeLabel}</button>
      </div>
    </section> : <>
      {url ? <img src={url} alt="" className="my-5 max-h-[320px] max-w-full rounded-xl object-contain" /> : !pending && <p className="my-5 text-[22px]">{empty}</p>}
      <div className="aniki-menu-items">
        <button type="button" data-fs-default aria-disabled={pending || (target === "logo" && !game)} onClick={() => { if (target !== "logo" || game) void run(pick) }}>{pickLabel}</button>
        <button ref={removeButton} type="button" aria-disabled={pending || !removable} onClick={() => { if (!busy.current && removable) setConfirming(true) }}>{removeLabel}</button>
      </div>
    </>}
    {error && <p role="alert" className="mt-5 text-[22px]">{error}</p>}
  </div>
}
