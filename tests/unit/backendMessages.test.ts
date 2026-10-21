import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { LANGUAGES, messagesFor } from "../../src/shared/i18n"
import { BACKEND_MESSAGES_FILE, backendMessagesJson } from "../../scripts/backend-messages.mjs"

describe("textos da parte em Rust (Tauri)", () => {
  it("o src-tauri/messages.json está igual aos dicionários (se falhar, rode npm run tauri:mensagens)", () => {
    expect(readFileSync(BACKEND_MESSAGES_FILE, "utf8")).toBe(backendMessagesJson(LANGUAGES, messagesFor))
  })

  it("cada função vira um modelo com os valores numerados", () => {
    const json = JSON.parse(backendMessagesJson(LANGUAGES, messagesFor)) as Record<string, { errors: Record<string, string> }>
    expect(json["pt-BR"].errors["statusNameTaken"]).toContain("{0}")
    expect(json["en"].errors["statusNameTaken"]).toContain("{0}")
  })
})
