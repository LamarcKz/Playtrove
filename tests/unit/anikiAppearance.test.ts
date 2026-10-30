import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AnikiAvatar } from "../../src/renderer/fullscreen/AnikiAvatar"
import { AnikiGlyph } from "../../src/renderer/fullscreen/AnikiGlyph"

describe("aparência do pacote Aniki", () => {
  it("resolve os botões da variante escolhida pelo protocolo do pacote", () => {
    const html = renderToStaticMarkup(createElement(AnikiGlyph, { button: "cross", iconStyle: "xbox-dark" }))
    expect(html).toContain('src="http://playtrove-theme.localhost/aniki/Images/Buttons/Controller/Xbox/Xbox%20Dark/Button-A.png"')
  })

  it("mantém os símbolos legíveis no estilo nativo sem pedir uma imagem", () => {
    const html = renderToStaticMarkup(createElement(AnikiGlyph, { button: "circle", iconStyle: "native" }))
    expect(html).toContain("○")
    expect(html).not.toContain("<img")
  })

  it("usa a imagem padrão do pacote para o primeiro avatar", () => {
    const html = renderToStaticMarkup(createElement(AnikiAvatar, { avatar: "crown", size: 56, anikiAvatarIndex: 1 }))
    expect(html).toContain('src="http://playtrove-theme.localhost/aniki/Themes%20Option/3.Avatar/Avatar.png"')
  })

  it("usa o último avatar do pacote sem trocar o avatar próprio salvo", () => {
    const html = renderToStaticMarkup(createElement(AnikiAvatar, { avatar: "crown", size: 56, anikiAvatarIndex: 61 }))
    expect(html).toContain('src="http://playtrove-theme.localhost/aniki/Themes%20Option/3.Avatar/Avatar%20(61).png"')
    expect(html).toContain("aniki-avatar-crown")
  })

  it("continua renderizando o avatar próprio sem imagem do pacote", () => {
    const html = renderToStaticMarkup(createElement(AnikiAvatar, { avatar: "crown", size: 56 }))
    expect(html).toContain("lucide-crown")
    expect(html).not.toContain("<img")
  })
})
