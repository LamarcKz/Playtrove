import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** Protocolo que a interface usa para mostrar as imagens dos jogos (respondido em imageProtocol.ts). */
export const IMAGE_PROTOCOL = "playtrove-img"

/** As imagens de um jogo: capa (retrato) e fundo (paisagem). O ícone da lista é um pedaço da capa. */
export type ImageKind = "cover" | "background"

/** Maior imagem aceita, em bytes (as capas e fundos costumam ter até uns 5 MB). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** Tipos de imagem aceitos e a extensão de arquivo de cada um. */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
}

/**
 * Endereço de uma imagem de jogo para a interface, ex.: playtrove-img://images/12/cover.png?v=...
 * O `version` (a data do download) muda quando a imagem é trocada, para a tela não mostrar a antiga.
 */
export function imageUrl(gameId: number, fileName: string, version: string | null): string {
  const query = version ? `?v=${encodeURIComponent(version)}` : ""
  return `${IMAGE_PROTOCOL}://images/${gameId}/${encodeURIComponent(fileName)}${query}`
}

/** Extensão de arquivo para o tipo da imagem (cabeçalho Content-Type), ou null se não for uma imagem aceita. */
export function imageExtension(contentType: string | null): string | null {
  const mime = contentType?.split(";")[0].trim().toLowerCase() ?? ""
  return EXTENSIONS[mime] ?? null
}

/**
 * Grava uma imagem do jogo na pasta dele (ex.: images/12/cover.png), apagando a anterior do mesmo
 * tipo (que pode ter outra extensão). Devolve o nome do arquivo.
 */
export function saveGameImage(
  imagesDir: string,
  gameId: number,
  kind: ImageKind,
  bytes: Uint8Array,
  extension: string
): string {
  const dir = join(imagesDir, String(gameId))
  mkdirSync(dir, { recursive: true })
  for (const file of readdirSync(dir)) {
    if (file.startsWith(`${kind}.`)) rmSync(join(dir, file), { force: true })
  }
  const fileName = `${kind}.${extension}`
  writeFileSync(join(dir, fileName), bytes)
  return fileName
}
