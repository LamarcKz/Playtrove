import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { FullscreenConfig } from "@shared/fullscreen"

/** Cache único do renderer; respostas anteriores nunca substituem uma imagem recém-escolhida. */
export class CustomAvatarCache {
  private loaded = false
  private url: string | null = null
  private pending: Promise<string | null> | null = null
  private revision = 0

  read(load: () => Promise<string | null>): Promise<string | null> {
    if (this.loaded) return Promise.resolve(this.url)
    if (this.pending) return this.pending
    const revision = this.revision
    const pending = load().then((url) => {
      if (revision === this.revision) { this.url = url; this.loaded = true }
      return this.url
    }, (error: unknown) => {
      if (revision !== this.revision && this.loaded) return this.url
      throw error
    }).finally(() => { if (this.pending === pending) this.pending = null })
    this.pending = pending
    return pending
  }
  receive(url: string | null) {
    this.revision++
    this.url = url
    this.loaded = true
  }
}

const avatarCache = new CustomAvatarCache()
type Appearance = Pick<FullscreenConfig, "controllerIconStyle" | "anikiAvatarIndex"> & { profileAvatar?: FullscreenConfig["profileAvatar"] }
export const AnikiAppearanceContext = createContext<Appearance & { customAvatarUrl: string | null }>({ controllerIconStyle: "playstation", anikiAvatarIndex: null, customAvatarUrl: null })

/** Uma configuração por shell; glifos e avatares não fazem consultas próprias à API. */
export function AnikiAppearanceProvider({ value, children }: { value: Appearance; children: ReactNode }) {
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null)
  useEffect(() => window.api.anikiCustomMedia.onAvatarChange((url) => {
    avatarCache.receive(url)
    setCustomAvatarUrl(url)
  }), [])
  useEffect(() => {
    if (value.profileAvatar !== "custom") return
    let active = true
    const api = window.api.anikiCustomMedia
    void avatarCache.read(api.getAvatar).then((url) => { if (active) setCustomAvatarUrl(url) }).catch(() => { if (active) setCustomAvatarUrl(null) })
    return () => { active = false }
  }, [value.profileAvatar])
  return <AnikiAppearanceContext.Provider value={{ ...value, customAvatarUrl: value.profileAvatar === "custom" ? customAvatarUrl : null }}>{children}</AnikiAppearanceContext.Provider>
}

export function useAnikiAppearance() {
  return useContext(AnikiAppearanceContext)
}
