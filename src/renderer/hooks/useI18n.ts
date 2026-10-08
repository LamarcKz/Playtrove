import { createContext, useContext } from "react"
import { DEFAULT_LANGUAGE, messagesFor, type Language, type Messages } from "@shared/i18n"

/** O idioma da interface e os textos nele. */
export interface I18n {
  language: Language
  /** Os textos no idioma escolhido (ex.: t.pages.library). */
  t: Messages
  /** Troca o idioma do app na hora e guarda a escolha (Configurações → Geral). */
  setLanguage: (language: Language) => Promise<void>
}

export const I18nContext = createContext<I18n>({
  language: DEFAULT_LANGUAGE,
  t: messagesFor(DEFAULT_LANGUAGE),
  setLanguage: async () => undefined,
})

/** O idioma e os textos da interface. Precisa do I18nProvider (no App.tsx). */
export function useI18n(): I18n {
  return useContext(I18nContext)
}
