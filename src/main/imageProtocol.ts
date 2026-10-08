import { join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { app, net, protocol } from "electron"
import { IMAGE_PROTOCOL } from "./imageFiles"

/** Pasta das imagens dos jogos: <dados do app>/images/<id do jogo>/cover.png, icon.png... */
export function getImagesDir(): string {
  return join(app.getPath("userData"), "images")
}

/**
 * Faz o protocolo das imagens funcionar como um endereço comum (igual ao http). Precisa rodar antes
 * de o app ficar pronto.
 */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: IMAGE_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ])
}

/**
 * Responde aos pedidos de imagem da interface (playtrove-img://images/12/cover.png) com o arquivo
 * da pasta de imagens. Segurança: nada fora dessa pasta é entregue, nem com "..".
 */
export function handleImageProtocol(): void {
  const root = resolve(getImagesDir())
  protocol.handle(IMAGE_PROTOCOL, (request) => {
    const url = new URL(request.url)
    const file = resolve(root, decodeURIComponent(url.pathname).replace(/^[/\\]+/, ""))
    if (url.host !== "images" || !file.startsWith(root + sep)) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}
