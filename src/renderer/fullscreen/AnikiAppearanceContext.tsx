import { createContext, useContext, type ReactNode } from "react"
import type { FullscreenConfig } from "@shared/fullscreen"

type Appearance = Pick<FullscreenConfig, "controllerIconStyle" | "anikiAvatarIndex">
const AnikiAppearanceContext = createContext<Appearance>({ controllerIconStyle: "playstation", anikiAvatarIndex: null })

/** Uma configuração por shell; glifos e avatares não fazem consultas próprias à API. */
export function AnikiAppearanceProvider({ value, children }: { value: Appearance; children: ReactNode }) {
  return <AnikiAppearanceContext.Provider value={value}>{children}</AnikiAppearanceContext.Provider>
}

export function useAnikiAppearance() {
  return useContext(AnikiAppearanceContext)
}
