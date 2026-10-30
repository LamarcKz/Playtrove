import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AnikiAppearanceContext, CustomAvatarCache } from "../../src/renderer/fullscreen/AnikiAppearanceContext"
import { AnikiAvatar } from "../../src/renderer/fullscreen/AnikiAvatar"

describe("cache da imagem personalizada do avatar", () => {
  it("compartilha a leitura entre consumidores e remontagens do renderer", async () => {
    const cache = new CustomAvatarCache()
    let calls = 0
    let complete!: (url: string | null) => void
    const pending = new Promise<string | null>((resolve) => { complete = resolve })
    const load = () => { calls++; return pending }
    const first = cache.read(load)
    const second = cache.read(load)
    complete("http://playtrove-img.localhost/profile/avatar-local-1-1.png")
    expect(await first).toBe("http://playtrove-img.localhost/profile/avatar-local-1-1.png")
    expect(await second).toBe("http://playtrove-img.localhost/profile/avatar-local-1-1.png")
    expect(await cache.read(load)).toBe("http://playtrove-img.localhost/profile/avatar-local-1-1.png")
    expect(calls).toBe(1)
  })

  it("um evento de troca ou remoção invalida a resposta pendente anterior", async () => {
    const cache = new CustomAvatarCache()
    let complete!: (url: string | null) => void
    const first = cache.read(() => new Promise<string | null>((resolve) => { complete = resolve }))
    cache.receive("http://playtrove-img.localhost/profile/avatar-local-2-1.jpg")
    complete("http://playtrove-img.localhost/profile/avatar-local-1-1.png")
    expect(await first).toBe("http://playtrove-img.localhost/profile/avatar-local-2-1.jpg")
    cache.receive(null)
    expect(await cache.read(() => Promise.resolve("imagem antiga"))).toBeNull()
  })

  it("uma leitura que falha pode ser repetida sem guardar um falso resultado vazio", async () => {
    const cache = new CustomAvatarCache()
    await expect(cache.read(() => Promise.reject(new Error("falha simulada")))).rejects.toThrow("falha simulada")
    expect(await cache.read(() => Promise.resolve(null))).toBeNull()
  })

  it("uma falha antiga também não apaga a imagem recebida pelo evento", async () => {
    const cache = new CustomAvatarCache()
    let reject!: (reason: Error) => void
    const pending = cache.read(() => new Promise<string | null>((_resolve, fail) => { reject = fail }))
    cache.receive("http://playtrove-img.localhost/profile/avatar-local-3-1.webp")
    reject(new Error("consulta antiga"))
    expect(await pending).toBe("http://playtrove-img.localhost/profile/avatar-local-3-1.webp")
  })
})

describe("prévia de avatar com perfil personalizado", () => {
  const customAvatarUrl = "http://playtrove-img.localhost/profile/avatar-local-1-1.png"
  const render = (index?: number | null) => renderToStaticMarkup(createElement(AnikiAppearanceContext.Provider, {
    value: { controllerIconStyle: "playstation", anikiAvatarIndex: null, profileAvatar: "custom", customAvatarUrl },
    children: createElement(AnikiAvatar, { avatar: "custom", size: 56, anikiAvatarIndex: index }),
  }))

  it("um índice explícito do pacote tem prioridade na prévia sem trocar o perfil", () => {
    const html = render(61)
    expect(html).toContain("Avatar%20(61).png")
    expect(html).not.toContain("src=\"" + customAvatarUrl)
  })

  it("usa a cópia personalizada quando o índice resolvido é null", () => {
    expect(render(null)).toContain("src=\"" + customAvatarUrl)
    expect(render()).toContain("src=\"" + customAvatarUrl)
  })
})
