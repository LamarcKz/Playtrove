import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { DEFAULT_LANGUAGE, isLanguage, messagesFor, type Language } from "@shared/i18n"
import { I18nContext } from "@/hooks/useI18n"

/**
 * Dá o idioma e os textos para toda a interface (useI18n). O idioma começa com o que o main pôs no
 * endereço da janela (?lang=en), para a primeira tela já sair certa, e é conferido com o main logo
 * depois (a interface pode ter recarregado depois de uma troca).
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setCurrentLanguage] = useState<Language>(initialLanguage)

  useEffect(() => {
    let active = true
    window.api.app.getLanguage().then((current) => {
      if (active) setCurrentLanguage(current)
    })
    return () => {
      active = false
    }
  }, [])

  // O idioma da página, para os leitores de tela.
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const setLanguage = useCallback(async (next: Language) => {
    await window.api.app.setLanguage(next)
    setCurrentLanguage(next)
  }, [])

  const value = useMemo(() => ({ language, t: messagesFor(language), setLanguage }), [language, setLanguage])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** O idioma que veio no endereço da janela, ou o padrão. */
function initialLanguage(): Language {
  const fromUrl = new URLSearchParams(window.location.search).get("lang")
  return isLanguage(fromUrl) ? fromUrl : DEFAULT_LANGUAGE
}
