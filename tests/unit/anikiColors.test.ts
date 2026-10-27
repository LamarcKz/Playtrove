import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ANIKI_COLOR_PRESETS } from "../../src/shared/anikiColors"
import { dynamicPalette } from "../../src/renderer/lib/dynamicColors"

const ROOT = join(__dirname, "..", "..")

// As paletas são as mesmas na interface, no Rust (que valida) e no CSS (que pinta).
describe("paletas do Aniki", () => {
  it("as listas da interface e do Rust são iguais e cada paleta tem cores no CSS", () => {
    const rust = readFileSync(join(ROOT, "src-tauri", "src", "fullscreen.rs"), "utf-8")
    const list = /COLOR_PRESETS: \[&str; \d+\] = \[([^\]]+)\]/.exec(rust)![1]
    const ids = ANIKI_COLOR_PRESETS.map((preset) => preset.id)
    expect([...list.matchAll(/"([a-z-]+)"/g)].map((match) => match[1])).toEqual(ids)
    expect(ids).toHaveLength(41)
    const css = readFileSync(join(ROOT, "src", "renderer", "styles", "anikiColors.css"), "utf-8")
    for (const id of ids.slice(1)) expect(css).toContain(`[data-aniki-color="${id}"]`)
  })
})

describe("cor dinâmica", () => {
  it("monta os tons a partir do destaque, como o Helper", () => {
    const palette = dynamicPalette("#3c78dc")
    expect(palette["--aniki-accent"]).toBe("#3c78dc")
    expect(palette["--aniki-topbar-top"]).toBe("#3264b8")
    expect(palette["--aniki-secondary-end"]).toBe("#0e1c34")
    expect(palette["--aniki-focus-right"]).toMatch(/^#[0-9a-f]{6}d0$/)
    expect(dynamicPalette("azul")).toEqual({})
  })
})
