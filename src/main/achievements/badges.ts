import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { IMAGE_PROTOCOL, imageExtension, MAX_IMAGE_BYTES } from "../imageFiles"
import { MetadataStopError, type Fetch } from "../metadata/http"
import type { RaEndpoints } from "./client"

/**
 * As insígnias das conquistas ficam em <imagens>/achievements/: a colorida (123.png) para as
 * desbloqueadas e a apagada (123_lock.png) para as que faltam, como o RetroAchievements publica.
 * A interface mostra pelo mesmo protocolo das capas.
 */

const FOLDER = "achievements"

/** O nome do arquivo da insígnia: colorida se desbloqueada; apagada se não. */
function badgeFile(badgeName: string, earned: boolean): string {
  return `${badgeName}${earned ? "" : "_lock"}.png`
}

/** Endereço da insígnia para a interface, ou null se ela ainda não foi baixada. */
export function badgeUrl(imagesDir: string, badgeName: string | null, earned: boolean): string | null {
  if (!badgeName) return null
  const file = badgeFile(badgeName, earned)
  return existsSync(join(imagesDir, FOLDER, file)) ? `${IMAGE_PROTOCOL}://images/${FOLDER}/${file}` : null
}

/** Quantas insígnias baixam ao mesmo tempo. */
const PARALLEL = 4

/**
 * Baixa as insígnias que faltam no disco (a colorida das desbloqueadas e a apagada das outras). Uma
 * que falhar fica para a próxima vez; sem internet, para tudo sem erro (as imagens não são essenciais).
 */
export async function downloadBadges(
  fetch: Fetch,
  endpoints: RaEndpoints,
  imagesDir: string,
  achievements: { badgeName: string | null; earned: boolean }[]
): Promise<number> {
  const dir = join(imagesDir, FOLDER)
  const missing = [
    ...new Set(
      achievements
        .filter((item) => item.badgeName && /^[\w-]+$/.test(item.badgeName))
        .map((item) => badgeFile(item.badgeName as string, item.earned))
        .filter((file) => !existsSync(join(dir, file)))
    ),
  ]
  if (missing.length === 0) return 0
  mkdirSync(dir, { recursive: true })

  let saved = 0
  let stopped = false
  async function download(file: string) {
    if (stopped) return
    try {
      const response = await fetch(`${endpoints.media}/Badge/${file}`)
      if (!response.ok || !imageExtension(response.headers.get("content-type"))) return
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return
      writeFileSync(join(dir, file), bytes)
      saved++
    } catch (error) {
      // Sem conexão: não adianta tentar as outras agora.
      if (error instanceof MetadataStopError || error instanceof TypeError) stopped = true
    }
  }
  for (let index = 0; index < missing.length; index += PARALLEL) {
    await Promise.all(missing.slice(index, index + PARALLEL).map(download))
  }
  return saved
}
