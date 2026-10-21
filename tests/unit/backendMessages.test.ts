import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { LANGUAGES, messagesFor } from "../../src/shared/i18n"
import { EXTERNAL_LINKS } from "../../src/shared/ipc"
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

describe("o que o Rust repete da parte compartilhada", () => {
  it("os sites que o Rust abre são os mesmos de EXTERNAL_LINKS (src-tauri/src/links.rs)", () => {
    const source = readFileSync("src-tauri/src/links.rs", "utf8")
    const block = /pub const EXTERNAL_LINKS[^=]*= \[([\s\S]*?)\];/.exec(source)?.[1] ?? ""
    const links = Object.fromEntries([...block.matchAll(/\("(\w+)", "([^"]+)"\)/g)].map((match) => [match[1], match[2]]))
    expect(links).toEqual(EXTERNAL_LINKS)
  })
})
