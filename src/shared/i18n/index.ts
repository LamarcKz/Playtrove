/**
 * Os idiomas do app (pedido do usuário em 2026-09-27): português do Brasil e inglês. Todo texto que
 * aparece na tela sai daqui, do dicionário do idioma escolhido, tanto na interface quanto no
 * processo principal (os erros e as janelas do Windows).
 */
import { en } from "./en"
import { ptBR, type Messages } from "./ptBR"

export type { Messages }

export type Language = "pt-BR" | "en"

/** Os idiomas para escolher em Configurações → Geral, cada um com o nome na própria língua. */
export const LANGUAGES: readonly { id: Language; name: string }[] = [
  { id: "pt-BR", name: "Português (Brasil)" },
  { id: "en", name: "English" },
]

/** O idioma de quando não dá para saber o do Windows. */
export const DEFAULT_LANGUAGE: Language = "pt-BR"

const MESSAGES: Record<Language, Messages> = { "pt-BR": ptBR, en }

/** Os textos de um idioma. */
export function messagesFor(language: Language): Messages {
  return MESSAGES[language]
}

/** É um dos idiomas do app? */
export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && Object.hasOwn(MESSAGES, value)
}

/**
 * O idioma pelo do Windows (a lista de idiomas preferidos, do principal para os outros), para
 * quando o usuário ainda não escolheu: Windows em português → português; em qualquer outra língua,
 * inglês (escolha do usuário em 2026-09-27).
 */
export function languageFromSystem(locales: readonly string[]): Language {
  const main = locales[0]
  if (!main) return DEFAULT_LANGUAGE
  return main.toLowerCase().startsWith("pt") ? "pt-BR" : "en"
}

/** Um status que vem com o app: o nome dele muda com o idioma, até o usuário renomear. */
export type StatusPreset = keyof Messages["statusPresets"]

/** É um dos status que vêm com o app? */
export function isStatusPreset(value: unknown): value is StatusPreset {
  return typeof value === "string" && Object.hasOwn(ptBR.statusPresets, value)
}

/** O nome de um gênero do IGDB no idioma (os que o dicionário não tem aparecem como vieram). */
export function genreLabel(genre: string, t: Messages): string {
  return Object.hasOwn(t.genres, genre) ? t.genres[genre] : genre
}
