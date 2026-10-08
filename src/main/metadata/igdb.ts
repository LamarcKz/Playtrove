import { t } from "../i18n"
import { comparableName } from "./matching"
import { MetadataStopError, request, type Fetch, type MetadataEndpoints } from "./http"

/** Client ID e Client Secret de um aplicativo da Twitch (o IGDB usa as contas da Twitch). */
export interface IgdbCredentials {
  clientId: string
  clientSecret: string
}

/** Um jogo encontrado no IGDB, só com o que o app usa. */
export interface IgdbGame {
  id: number
  name: string
  summary: string | null
  /** AAAA-MM-DD. */
  releaseDate: string | null
  /** Os gêneros como o IGDB escreve, em inglês (a tela mostra no idioma do app: genreLabel()). */
  genres: string[]
  developers: string[]
  publishers: string[]
  coverImageId: string | null
  /** Artes oficiais e telas do jogo, para o fundo (as artes primeiro). */
  backgroundImageIds: string[]
}

/** Ids das plataformas no IGDB, pelo nome do console usado nas pastas de ROMs (e alguns apelidos). */
const IGDB_PLATFORMS: Record<string, number> = {
  playstation: 7,
  ps1: 7,
  psx: 7,
  "playstation 2": 8,
  ps2: 8,
  "playstation 3": 9,
  ps3: 9,
  "playstation portable": 38,
  psp: 38,
  "nintendo ds": 20,
  nds: 20,
  ds: 20,
  "game boy advance": 24,
  gba: 24,
  "game boy": 33,
  gb: 33,
  "game boy color": 22,
  gbc: 22,
  "super nintendo": 19,
  snes: 19,
  nes: 18,
  "nintendo 64": 4,
  n64: 4,
  "mega drive": 29,
  genesis: 29,
  "sega genesis": 29,
}

/** Id da plataforma no IGDB para o console do jogo, ou null se ele não for conhecido. */
export function igdbPlatformId(platform: string | null): number | null {
  return platform ? (IGDB_PLATFORMS[comparableName(platform)] ?? null) : null
}

/** Campos pedidos ao IGDB em cada busca. */
const FIELDS = [
  "name",
  "summary",
  "first_release_date",
  "genres.name",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "cover.image_id",
  "artworks.image_id",
  "screenshots.image_id",
].join(",")

/** Um jogo como o IGDB devolve (só os campos pedidos; todos podem faltar). */
interface IgdbGameResponse {
  id: number
  name: string
  summary?: string
  first_release_date?: number
  genres?: { name?: string }[]
  involved_companies?: { company?: { name?: string }; developer?: boolean; publisher?: boolean }[]
  cover?: { image_id?: string }
  artworks?: { image_id?: string }[]
  screenshots?: { image_id?: string }[]
}

/** Conexão com o IGDB. Guarda o token de acesso enquanto ele vale (uns 60 dias). */
export interface IgdbSession {
  /** Confere o Client ID e o Client Secret (pede um token novo). */
  validate: () => Promise<void>
  /** Procura jogos pelo nome, só na plataforma dada (se houver). Os mais relevantes vêm primeiro. */
  search: (term: string, platformId: number | null) => Promise<IgdbGame[]>
}

export function createIgdbSession(fetch: Fetch, endpoints: MetadataEndpoints, credentials: IgdbCredentials): IgdbSession {
  let token: string | null = null
  let expiresAt = 0

  async function getToken(renew = false): Promise<string> {
    if (token && !renew && Date.now() < expiresAt) return token
    const params = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "client_credentials",
    })
    const response = await request(fetch, `${endpoints.twitchToken}?${params}`, { method: "POST" }, "IGDB")
    if (response.status >= 400 && response.status < 500) {
      throw new MetadataStopError(t().errors.igdbWrongKeys)
    }
    if (!response.ok) throw new Error(t().errors.twitchError(response.status))
    const body = (await response.json()) as { access_token?: string; expires_in?: number }
    if (!body.access_token) throw new Error(t().errors.igdbNoToken)
    token = body.access_token
    // Renova um minuto antes de vencer.
    expiresAt = Date.now() + ((body.expires_in ?? 3600) - 60) * 1000
    return token
  }

  async function query(body: string, retry = true): Promise<IgdbGameResponse[]> {
    const response = await request(
      fetch,
      `${endpoints.igdb}/games`,
      {
        method: "POST",
        headers: { "Client-ID": credentials.clientId, Authorization: `Bearer ${await getToken()}`, Accept: "application/json" },
        body,
      },
      "IGDB"
    )
    // Token vencido ou revogado: pede outro e tenta mais uma vez.
    if (response.status === 401 && retry) {
      token = null
      return query(body, false)
    }
    if (response.status === 401 || response.status === 403) {
      throw new MetadataStopError(t().errors.igdbRefused)
    }
    if (!response.ok) throw new Error(t().errors.igdbError(response.status))
    return (await response.json()) as IgdbGameResponse[]
  }

  return {
    validate: async () => {
      await getToken(true)
    },
    search: async (term, platformId) => {
      const escaped = term.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      const where = platformId === null ? "" : ` where platforms = (${platformId});`
      const results = await query(`search "${escaped}"; fields ${FIELDS};${where} limit 10;`)
      return results.map(toIgdbGame)
    },
  }
}

/** Endereço de uma imagem do IGDB, no tamanho pedido (ex.: "t_cover_big", "t_1080p"). */
export function igdbImageUrl(endpoints: MetadataEndpoints, size: string, imageId: string): string {
  return `${endpoints.igdbImages}/${size}/${imageId}.jpg`
}

function toIgdbGame(game: IgdbGameResponse): IgdbGame {
  const companies = game.involved_companies ?? []
  const namesOf = (role: "developer" | "publisher") =>
    unique(companies.filter((item) => item[role]).map((item) => item.company?.name))
  const imageIds = (images: { image_id?: string }[] | undefined) => unique((images ?? []).map((image) => image.image_id))

  return {
    id: game.id,
    name: game.name,
    summary: game.summary?.trim() || null,
    releaseDate: game.first_release_date ? new Date(game.first_release_date * 1000).toISOString().slice(0, 10) : null,
    genres: unique((game.genres ?? []).map((genre) => genre.name)),
    developers: namesOf("developer"),
    publishers: namesOf("publisher"),
    coverImageId: game.cover?.image_id ?? null,
    backgroundImageIds: [...imageIds(game.artworks), ...imageIds(game.screenshots)],
  }
}

/** Tira os vazios e os repetidos, mantendo a ordem. */
function unique(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}
