import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { GameOverlayState } from "../../src/shared/gameOverlay"
import { AnikiOverlayShortcutStatus } from "../../src/renderer/fullscreen/AnikiSettings"

const state: GameOverlayState = { enabled: true, open: false, isFocused: false, gameId: null, keyboardShortcutAvailable: false, controllerShortcutAvailable: false }
const render = (value: GameOverlayState | null) => renderToStaticMarkup(createElement(AnikiOverlayShortcutStatus, { state: value }))

describe("disponibilidade dos atalhos do centro de controle", () => {
  it("não avisa antes de receber o estado nem com a preferência desativada", () => {
    expect(render(null)).not.toContain('role="alert"')
    expect(render({ ...state, enabled: false })).not.toContain('role="alert"')
  })

  it("avisa somente quando o serviço está habilitado e o teclado está indisponível", () => {
    expect(render(state)).toContain('role="alert"')
    expect(render({ ...state, keyboardShortcutAvailable: true })).not.toContain('role="alert"')
  })

  it("não presume que o controle está disponível antes do relatório válido", () => {
    const without = render({ ...state, keyboardShortcutAvailable: true })
    const withController = render({ ...state, keyboardShortcutAvailable: true, controllerShortcutAvailable: true })
    expect(without.match(/role="status"/g)).toHaveLength(1)
    expect(withController.match(/role="status"/g)).toHaveLength(2)
  })
})
