import type Database from "better-sqlite3"
import { imageExtension, MAX_IMAGE_BYTES, saveGameImage, type ImageKind } from "../imageFiles"
import { getMetadataTarget, saveGameMetadata, type GameMetadata } from "../library"
import type { Fetch, MetadataEndpoints } from "./http"
import { igdbImageUrl, igdbPlatformId, type IgdbGame, type IgdbSession } from "./igdb"
import { libretroBoxartUrl } from "./libretro"
import { pickBestMatch, searchTermFor } from "./matching"
import type { SteamGridDbSession } from "./steamGridDb"

/**
 * Os serviços configurados agora (o IGDB e o SteamGridDB podem faltar; o libretro-thumbnails não
 * precisa de chave e vale sempre) e onde guardar as imagens.
 */
export interface MetadataServices {
  fetch: Fetch
  endpoints: MetadataEndpoints
  igdb: IgdbSession | null
  steamGridDb: SteamGridDbSession | null
  /** Pasta das imagens dos jogos (uma subpasta por jogo). */
  imagesDir: string
}

/**
 * Baixa os metadados e as imagens de um jogo e grava tudo no banco:
 * 1. IGDB: descrição, gêneros, desenvolvedora, publicadora e lançamento (buscando só na plataforma
 *    do jogo; sem resultado, em todas);
 * 2. capa: a oficial do libretro-thumbnails (pelo nome exato da ROM, nos jogos de emulador); se não
 *    houver, a do SteamGridDB (buscando pelo nome oficial que veio do IGDB); por fim, a do IGDB;
 * 3. fundo: o do SteamGridDB; se não houver, uma arte ou tela do jogo do IGDB.
 * Devolve true se o jogo foi encontrado em algum lugar.
 */
export async function downloadGameMetadata(db: Database.Database, gameId: number, services: MetadataServices): Promise<boolean> {
  const game = getMetadataTarget(db, gameId)
  const term = searchTermFor(game.title)

  let igdbGame: IgdbGame | null = null
  if (services.igdb) {
    const platformId = igdbPlatformId(game.platform)
    let results = await services.igdb.search(term, platformId)
    if (results.length === 0 && platformId !== null) results = await services.igdb.search(term, null)
    igdbGame = pickBestMatch(term, results)
  }

  let sgdbId: number | null = null
  let sgdbImages: Partial<Record<ImageKind, string>> = {}
  if (services.steamGridDb) {
    const name = igdbGame?.name ?? term
    const match = pickBestMatch(name, await services.steamGridDb.search(name))
    if (match) {
      sgdbId = match.id
      sgdbImages = await services.steamGridDb.images(match.id)
    }
  }

  // Cada imagem tem uma ordem de fontes: vale a primeira que baixar.
  const libretroCover = libretroBoxartUrl(services.endpoints, game.platform, game.romPath)
  const igdbBackground = igdbGame?.backgroundImageIds[0]
  const candidates: Record<ImageKind, (string | null | undefined)[]> = {
    cover: [
      libretroCover,
      sgdbImages.cover,
      igdbGame?.coverImageId ? igdbImageUrl(services.endpoints, "t_cover_big", igdbGame.coverImageId) : null,
    ],
    background: [sgdbImages.background, igdbBackground ? igdbImageUrl(services.endpoints, "t_1080p", igdbBackground) : null],
  }
  const images: GameMetadata["images"] = {}
  let foundOnLibretro = false
  for (const kind of Object.keys(candidates) as ImageKind[]) {
    for (const url of candidates[kind]) {
      const file = url ? await downloadImage(services, url, gameId, kind) : null
      if (!file) continue
      images[kind] = file
      if (url === libretroCover) foundOnLibretro = true
      break
    }
  }

  saveGameMetadata(
    db,
    gameId,
    {
      description: igdbGame?.summary ?? null,
      genres: igdbGame?.genres ?? null,
      developers: igdbGame?.developers ?? null,
      publishers: igdbGame?.publishers ?? null,
      releaseDate: igdbGame?.releaseDate ?? null,
      igdbId: igdbGame?.id ?? null,
      sgdbId,
      images,
    },
    new Date().toISOString()
  )
  return igdbGame !== null || sgdbId !== null || foundOnLibretro
}

/**
 * Baixa uma imagem e guarda na pasta do jogo. Se não der (link quebrado, não é imagem, grande
 * demais), devolve null: o jogo fica com a imagem que já tinha.
 */
async function downloadImage(
  services: MetadataServices,
  url: string,
  gameId: number,
  kind: ImageKind
): Promise<string | null> {
  try {
    const response = await services.fetch(url)
    const contentType = response.headers.get("content-type")
    // Tipo de imagem conhecido: vale ele. Sem tipo (ou "binário"): vale a extensão do endereço.
    // Qualquer outro tipo (ex.: uma página de erro) não é imagem.
    const extension = imageExtension(contentType) ?? (isGenericType(contentType) ? extensionFromUrl(url) : null)
    if (!response.ok || !extension) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null
    return saveGameImage(services.imagesDir, gameId, kind, bytes, extension)
  } catch {
    return null
  }
}

/** O servidor não disse que tipo de arquivo é? */
function isGenericType(contentType: string | null): boolean {
  const mime = contentType?.split(";")[0].trim().toLowerCase() ?? ""
  return mime === "" || mime === "application/octet-stream" || mime === "binary/octet-stream"
}

/** Extensão pelo fim do endereço, para servidores que não dizem o tipo da imagem. */
function extensionFromUrl(url: string): string | null {
  const match = /\.(png|jpe?g|webp|gif|ico)(?:$|\?)/i.exec(url)
  if (!match) return null
  const extension = match[1].toLowerCase()
  return extension === "jpeg" ? "jpg" : extension
}
