import { t } from "../i18n"
import { MetadataStopError, request, type Fetch } from "../metadata/http"

/**
 * A API do RetroAchievements (https://api-docs.retroachievements.org). Cada pedido leva a Web API
 * Key do usuário (parâmetro `y`); chave errada volta como 401. Só leitura: quem desbloqueia as
 * conquistas são os emuladores.
 */

/** Endereços da API e das imagens do RetroAchievements. */
export interface RaEndpoints {
  api: string
  media: string
}

export const RA_ENDPOINTS: RaEndpoints = {
  api: "https://retroachievements.org/API",
  media: "https://media.retroachievements.org",
}

/** Os mesmos serviços no servidor de mentira dos testes do app. */
export function raTestEndpoints(base: string): RaEndpoints {
  return { api: `${base}/ra/API`, media: `${base}/ra-media` }
}

/** A conta do usuário: o nome e a Web API Key (de retroachievements.org → Configurações → Keys). */
export interface RaAccount {
  username: string
  apiKey: string
}

export interface RaConsole {
  id: number
  name: string
}

export interface RaCatalogGame {
  id: number
  title: string
  numAchievements: number
}

export interface RaAchievement {
  id: number
  title: string
  description: string
  points: number
  badgeName: string | null
  displayOrder: number
  /** Quantos jogadores desbloquearam (no modo normal ou no hardcore). */
  numAwarded: number
  earnedAt: string | null
  earnedHardcoreAt: string | null
}

export interface RaGameProgress {
  id: number
  title: string
  numDistinctPlayers: number
  achievements: RaAchievement[]
}

export interface RaClient {
  /** Confere a conta (a chave e o nome). Lança um erro com o motivo se algo estiver errado. */
  validate(): Promise<void>
  consoles(): Promise<RaConsole[]>
  /** Os jogos com conquistas de um console (lista grande: o app guarda e só busca de novo de vez em quando). */
  catalog(consoleId: number): Promise<RaCatalogGame[]>
  gameProgress(raGameId: number): Promise<RaGameProgress>
  /** Os jogos das conquistas desbloqueadas nos últimos `minutes` minutos. */
  recentGameIds(minutes: number): Promise<number[]>
}

export function createRaClient(fetch: Fetch, endpoints: RaEndpoints, account: RaAccount): RaClient {
  /** Faz um pedido à API. Com `missingAsNull`, "não encontrado" volta como null em vez de erro. */
  async function get(endpoint: string, params: Record<string, string | number>, missingAsNull = false): Promise<unknown> {
    const query = new URLSearchParams(Object.entries(params).map(([name, value]): [string, string] => [name, String(value)]))
    query.set("y", account.apiKey)
    const response = await request(fetch, `${endpoints.api}/${endpoint}.php?${query}`, {}, "RetroAchievements")
    if (response.status === 401 || response.status === 403) {
      throw new MetadataStopError(t().errors.raWrongKey)
    }
    if (response.status === 429) {
      throw new MetadataStopError(t().errors.raRateLimited)
    }
    // 404: não existe; 422: o nome nem é um nome de usuário válido lá.
    if (missingAsNull && (response.status === 404 || response.status === 422)) return null
    if (!response.ok) throw new Error(t().errors.raError(response.status))
    return response.json()
  }

  return {
    async validate() {
      const profile = (await get("API_GetUserProfile", { u: account.username }, true)) as Record<string, unknown> | null
      if (!profile || typeof profile !== "object" || !profile["User"]) {
        throw new Error(t().errors.raUserNotFound(account.username))
      }
    },

    async consoles() {
      const list = await get("API_GetConsoleIDs", { a: 1, g: 1 })
      return asArray(list).map((item) => ({ id: num(item["ID"]), name: str(item["Name"]) }))
    },

    async catalog(consoleId) {
      const list = await get("API_GetGameList", { i: consoleId, f: 1 })
      return asArray(list).map((item) => ({
        id: num(item["ID"]),
        title: str(item["Title"]),
        numAchievements: num(item["NumAchievements"]),
      }))
    },

    async gameProgress(raGameId) {
      const game = (await get("API_GetGameInfoAndUserProgress", { g: raGameId, u: account.username })) as Record<
        string,
        unknown
      >
      // "Achievements" vem como um objeto indexado pelo id (ou como lista vazia, sem conquistas).
      const achievements = Object.values((game["Achievements"] as Record<string, Record<string, unknown>>) ?? {})
      return {
        id: num(game["ID"]) || raGameId,
        title: str(game["Title"]),
        numDistinctPlayers: num(game["NumDistinctPlayers"]),
        achievements: achievements.map((item) => ({
          id: num(item["ID"]),
          title: str(item["Title"]),
          description: str(item["Description"]),
          points: num(item["Points"]),
          badgeName: str(item["BadgeName"]) || null,
          displayOrder: num(item["DisplayOrder"]),
          numAwarded: num(item["NumAwarded"]),
          earnedAt: raDate(item["DateEarned"]),
          earnedHardcoreAt: raDate(item["DateEarnedHardcore"]),
        })),
      }
    },

    async recentGameIds(minutes) {
      const list = await get("API_GetUserRecentAchievements", { u: account.username, m: Math.max(1, Math.round(minutes)) })
      return [...new Set(asArray(list).map((item) => num(item["GameID"])).filter((id) => id > 0))]
    },
  }
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value.filter((item) => item && typeof item === "object") as Record<string, unknown>[]) : []
}

function num(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

/**
 * As datas do RetroAchievements: "2023-12-27 16:04:50" (UTC, sem fuso) ou ISO com fuso. Devolve ISO,
 * ou null se não houver.
 */
export function raDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const text = value.trim()
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(" ", "T")}Z`
  const time = Date.parse(withZone)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}
