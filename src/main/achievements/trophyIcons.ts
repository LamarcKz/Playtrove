import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { nativeImage } from "electron"
import { IMAGE_PROTOCOL } from "../imageFiles"
import { trophyIconFile } from "./trophyFiles"

/**
 * As imagens dos troféus do PS3 ficam em <imagens>/trophies/<conjunto>/<id>.png: o app copia da
 * pasta do RPCS3 (diminuídas) e a interface mostra pelo mesmo protocolo das capas.
 */

const FOLDER = "trophies"

/** Tamanho das imagens guardadas (as do jogo têm 240×240; a tela usa no máximo 48). */
const ICON_SIZE = 96

/** A pasta das imagens de um conjunto de troféus. */
export function trophyIconsDir(imagesDir: string, setId: string): string {
  return join(imagesDir, FOLDER, setId)
}

/** Endereço da imagem de um troféu para a interface, ou null se ela não foi copiada. */
export function trophyIconUrl(imagesDir: string, setId: string, trophyId: number): string | null {
  return existsSync(join(trophyIconsDir(imagesDir, setId), `${trophyId}.png`))
    ? `${IMAGE_PROTOCOL}://images/${FOLDER}/${setId}/${trophyId}.png`
    : null
}

/** Copia as imagens que ainda não estão na pasta do app (uma que falhar fica com o troféu desenhado). */
export function copyTrophyIcons(
  setDir: string,
  iconsDir: string,
  trophyIds: number[],
  copyIcon: (source: string, target: string) => void
): void {
  mkdirSync(iconsDir, { recursive: true })
  for (const id of trophyIds) {
    const source = trophyIconFile(setDir, id)
    const target = join(iconsDir, `${id}.png`)
    if (existsSync(target) || !existsSync(source)) continue
    try {
      copyIcon(source, target)
    } catch (error) {
      console.error(`[troféus] não deu para copiar a imagem ${source}:`, error)
    }
  }
}

/** Copia a imagem de um troféu diminuída (o PNG do jogo tem uns 100 KB; a cópia, poucos KB). */
export function copyTrophyIconResized(source: string, target: string): void {
  const image = nativeImage.createFromPath(source)
  if (image.isEmpty()) return
  writeFileSync(target, image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: "best" }).toPNG())
}
