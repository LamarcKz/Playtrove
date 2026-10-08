import { t } from "../i18n"
import type { ImageKind } from "../imageFiles"
import { MetadataStopError, request, type Fetch, type MetadataEndpoints } from "./http"

/** Um jogo encontrado no SteamGridDB. */
export interface SteamGridDbGame {
  id: number
  name: string
}

/** Conexão com o SteamGridDB (capas, fundos e ícones feitos pela comunidade). */
export interface SteamGridDbSession {
  /** Confere a chave (faz uma busca de teste). */
  validate: () => Promise<void>
  /** Procura jogos pelo nome. Os mais relevantes vêm primeiro. */
  search: (term: string) => Promise<SteamGridDbGame[]>
  /** Endereços da capa e do fundo mais votados do jogo (os que não existem ficam de fora). */
  images: (gameId: number) => Promise<Partial<Record<ImageKind, string>>>
}

/**
 * O que buscar de cada tipo de imagem. Capa: as de retrato (600x900 e parecidas). Fundo: os
 * "heroes", as faixas largas do topo da página do jogo. Nada de imagens NSFW ou de humor. Os ícones
 * não são usados: os de fãs variam demais, e o ícone da lista é um pedaço da capa.
 */
const IMAGE_QUERIES: Record<ImageKind, string> = {
  cover: "grids/game/{id}?dimensions=600x900,342x482,660x930&types=static&nsfw=false&humor=false",
  background: "heroes/game/{id}?types=static&nsfw=false&humor=false",
}

interface SteamGridDbResponse<T> {
  success: boolean
  data?: T
  errors?: string[]
}

export function createSteamGridDbSession(fetch: Fetch, endpoints: MetadataEndpoints, apiKey: string): SteamGridDbSession {
  async function get<T>(path: string): Promise<T | null> {
    const response = await request(
      fetch,
      `${endpoints.steamGridDb}/${path}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
      "SteamGridDB"
    )
    if (response.status === 401 || response.status === 403) {
      throw new MetadataStopError(t().errors.steamGridDbWrongKey)
    }
    // 404: o jogo não tem imagens desse tipo.
    if (response.status === 404) return null
    if (!response.ok) throw new Error(t().errors.steamGridDbError(response.status))
    const body = (await response.json()) as SteamGridDbResponse<T>
    if (!body.success) throw new Error(body.errors?.join(" ") || t().errors.steamGridDbRefused)
    return body.data ?? null
  }

  async function search(term: string): Promise<SteamGridDbGame[]> {
    const results = await get<{ id: number; name: string }[]>(`search/autocomplete/${encodeURIComponent(term)}`)
    return (results ?? []).map(({ id, name }) => ({ id, name }))
  }

  return {
    validate: async () => {
      await search("mario")
    },
    search,
    images: async (gameId) => {
      const found: Partial<Record<ImageKind, string>> = {}
      for (const kind of Object.keys(IMAGE_QUERIES) as ImageKind[]) {
        const images = await get<{ url?: string }[]>(IMAGE_QUERIES[kind].replace("{id}", String(gameId)))
        const url = images?.find((image) => image.url)?.url
        if (url) found[kind] = url
      }
      return found
    },
  }
}
