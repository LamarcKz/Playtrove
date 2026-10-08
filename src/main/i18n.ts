import type Database from "better-sqlite3"
import { DEFAULT_LANGUAGE, isLanguage, languageFromSystem, messagesFor, type Language, type Messages } from "../shared/i18n"
import { getSetting, setSetting } from "./settings"

/**
 * O idioma do processo principal: o dos erros que vão para a tela, das janelas do Windows e dos
 * nomes dos status padrão. Fica na memória e muda junto com o da interface.
 */
let current: Language = DEFAULT_LANGUAGE

/** O idioma do app agora. */
export function getLanguage(): Language {
  return current
}

/** Os textos no idioma do app agora. */
export function t(): Messages {
  return messagesFor(current)
}

/** Troca o idioma só na memória (a abertura do app e os testes). */
export function setCurrentLanguage(language: Language): void {
  current = language
}

/**
 * Na abertura: o idioma escolhido em Configurações → Geral ou, se o usuário nunca escolheu, o do
 * Windows (que vale enquanto ele não escolher).
 */
export function loadLanguage(db: Database.Database, systemLocales: readonly string[]): Language {
  const saved = getSetting(db, "language")
  current = isLanguage(saved) ? saved : languageFromSystem(systemLocales)
  return current
}

/** Troca o idioma (Configurações → Geral) e guarda a escolha. */
export function saveLanguage(db: Database.Database, language: Language): void {
  setSetting(db, "language", language)
  current = language
}
