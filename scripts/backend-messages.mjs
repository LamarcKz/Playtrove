// Gera o src-tauri/messages.json: as partes dos dicionários (src/shared/i18n) que a parte em Rust usa
// (os nomes dos status padrão, os erros e as janelas do Windows), nos dois idiomas. Assim os textos
// continuam num lugar só. Rodar depois de mudar essas partes: npm run tauri:mensagens
// (o tests/unit/backendMessages.test.ts avisa quando o arquivo ficou para trás).
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** As partes do dicionário que o Rust usa. */
export const BACKEND_SECTIONS = ["statusPresets", "errors", "dialogs", "repair"]

/** Onde o Rust lê os textos (src-tauri/src/i18n.rs). */
export const BACKEND_MESSAGES_FILE = resolve("src-tauri/messages.json")

/**
 * Uma parte do dicionário no formato do Rust: os textos ficam como estão, e cada função vira um modelo
 * com {0}, {1}... no lugar dos valores (ex.: `(name) => \`O status ${name} já existe\`` vira
 * "O status {0} já existe").
 */
function toTemplate(value) {
  if (typeof value === "string") return value
  if (typeof value === "function") return value(...Array.from({ length: value.length }, (_, index) => `{${index}}`))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toTemplate(item)]))
}

/** O conteúdo do messages.json, a partir dos idiomas e dos dicionários do app. */
export function backendMessagesJson(languages, messagesFor) {
  const messages = Object.fromEntries(
    languages.map(({ id }) => [id, Object.fromEntries(BACKEND_SECTIONS.map((section) => [section, toTemplate(messagesFor(id)[section])]))])
  )
  return `${JSON.stringify(messages, null, 2)}\n`
}

async function main() {
  // Os dicionários são TypeScript: o Vite carrega do jeito que o app usa.
  const { createServer } = await import("vite")
  const server = await createServer({
    configFile: false,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
    // Só carrega os dicionários: sem procurar as dependências da interface.
    optimizeDeps: { noDiscovery: true, entries: [] },
  })
  try {
    const { LANGUAGES, messagesFor } = await server.ssrLoadModule("/src/shared/i18n/index.ts")
    writeFileSync(BACKEND_MESSAGES_FILE, backendMessagesJson(LANGUAGES, messagesFor))
    console.log(`Textos do Rust atualizados em ${BACKEND_MESSAGES_FILE}`)
  } finally {
    await server.close()
  }
}

// Só roda quando este arquivo é chamado direto (npm run tauri:mensagens), e não quando é importado nos testes.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main()
