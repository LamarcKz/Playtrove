import { t } from "../i18n"

/** Função que faz pedidos pela internet: o net.fetch do Electron (os testes trocam por uma de mentira). */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/** Endereços dos serviços de metadados. */
export interface MetadataEndpoints {
  /** Token de acesso da Twitch (o IGDB usa as contas de desenvolvedor da Twitch). */
  twitchToken: string
  igdb: string
  /** Imagens do IGDB (capas, artes e telas do jogo). */
  igdbImages: string
  steamGridDb: string
  /** Capas oficiais do RetroArch (libretro-thumbnails). */
  libretroThumbnails: string
}

export const DEFAULT_ENDPOINTS: MetadataEndpoints = {
  twitchToken: "https://id.twitch.tv/oauth2/token",
  igdb: "https://api.igdb.com/v4",
  igdbImages: "https://images.igdb.com/igdb/image/upload",
  steamGridDb: "https://www.steamgriddb.com/api/v2",
  libretroThumbnails: "https://thumbnails.libretro.com",
}

/** Os mesmos serviços num servidor de mentira, para os testes do app não dependerem da internet. */
export function testEndpoints(base: string): MetadataEndpoints {
  return {
    twitchToken: `${base}/twitch/token`,
    igdb: `${base}/igdb`,
    igdbImages: `${base}/igdb-images`,
    steamGridDb: `${base}/sgdb`,
    libretroThumbnails: `${base}/libretro`,
  }
}

/**
 * Erro que para a leva inteira de downloads (chave errada, sem internet): todos os jogos
 * falhariam do mesmo jeito, então não adianta continuar.
 */
export class MetadataStopError extends Error {}

/** Faz um pedido. Sem conexão, o erro vira uma mensagem clara (e para a leva). */
export async function request(fetch: Fetch, url: string, init: RequestInit, service: string): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new MetadataStopError(t().errors.noConnection(service))
  }
}
