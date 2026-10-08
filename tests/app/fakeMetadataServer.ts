import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { makePng, type Rgb } from "../fakePng"

/**
 * Um IGDB, um SteamGridDB, um libretro-thumbnails e um RetroAchievements de mentira, rodando neste
 * computador, para os testes do app não dependerem da internet nem de chaves de verdade. O app
 * aponta para cá pela variável PLAYTROVE_METADATA_TEST_SERVER (só fora do app instalado).
 */

export const IGDB_CLIENT_ID = "id-de-teste"
export const IGDB_CLIENT_SECRET = "segredo-de-teste"
export const STEAMGRIDDB_KEY = "chave-de-teste"
const TOKEN = "token-de-teste"

/** Os jogos que os serviços "conhecem" (os outros não são encontrados). */
const IGDB_GAMES: Record<string, object> = {
  "mar de estrelas": {
    id: 101,
    name: "Mar de Estrelas",
    summary: "Uma viagem pelos mares do espaço, de planeta em planeta.",
    first_release_date: Date.UTC(2003, 9, 14) / 1000,
    genres: [{ name: "Adventure" }, { name: "Role-playing (RPG)" }],
    involved_companies: [
      { company: { name: "Estúdio Aurora" }, developer: true, publisher: false },
      { company: { name: "Editora Cometa" }, developer: false, publisher: true },
    ],
  },
  "rally extremo 3": {
    id: 102,
    name: "Rally Extremo 3",
    summary: "Corridas na lama, na neve e no deserto.",
    first_release_date: Date.UTC(2005, 2, 1) / 1000,
    genres: [{ name: "Racing" }, { name: "Simulator" }],
    involved_companies: [{ company: { name: "Pista Games" }, developer: true, publisher: true }],
    // Sem nada no SteamGridDB: a capa e o fundo vêm daqui.
    cover: { image_id: "capa102" },
    screenshots: [{ image_id: "tela102" }],
  },
  "salto estelar": {
    id: 103,
    name: "Salto Estelar",
    summary: "Um herói, um salto e uma cidade inteira para atravessar.",
    first_release_date: Date.UTC(2003, 9, 14) / 1000,
    genres: [{ name: "Platform" }],
    involved_companies: [{ company: { name: "Estúdio Aurora" }, developer: true, publisher: false }],
  },
}

/** Jogos do SteamGridDB, com as cores das imagens de cada um (em cima e embaixo, em degradê). */
const STEAMGRIDDB_GAMES: { id: number; name: string; cover: [Rgb, Rgb]; background: [Rgb, Rgb]; icon: [Rgb, Rgb] }[] = [
  { id: 201, name: "Mar de Estrelas", cover: [[40, 90, 200], [10, 20, 60]], background: [[90, 40, 160], [20, 10, 50]], icon: [[250, 160, 40], [200, 80, 20]] },
  { id: 203, name: "Salto Estelar", cover: [[230, 120, 30], [90, 40, 10]], background: [[30, 140, 90], [10, 40, 30]], icon: [[240, 200, 60], [150, 110, 20]] },
]

/** As ROMs que "têm" capa no libretro-thumbnails de mentira. */
const LIBRETRO_BOXARTS = ["Salto Estelar (USA)"]

// ---------------------------------------------------------------- RetroAchievements

export const RA_USERNAME = "JogadorTeste"
export const RA_API_KEY = "chave-ra-de-teste"

/** Uma conquista: `daysAgo` = desbloqueada há tantos dias (null = ainda falta). */
interface FakeAchievement {
  id: number
  title: string
  description: string
  points: number
  /** Quantos jogadores desbloquearam (a raridade sai disso e dos jogadores do jogo). */
  awarded: number
  daysAgo: number | null
  hardcore?: boolean
}

interface FakeRaGame {
  id: number
  consoleId: number
  title: string
  players: number
  achievements: FakeAchievement[]
}

const RA_CONSOLES = [
  { ID: 12, Name: "PlayStation" },
  { ID: 21, Name: "PlayStation 2" },
  { ID: 5, Name: "Game Boy Advance" },
  { ID: 18, Name: "Nintendo DS" },
  { ID: 3, Name: "SNES/Super Famicom" },
]

/**
 * Os jogos com conquistas, com os nomes dos jogos de exemplo do app. Mar de Estrelas: 3 de 6, de
 * todas as raridades; Rally Extremo 3: 2 de 4 (o 2 existe para conferir que um não vira o outro);
 * Neon Madrugada: platina; Cidadela Sombria: nenhuma. O hack nunca pode ser escolhido.
 * No total, 8 de 15 desbloqueadas e 80 pontos.
 */
const RA_GAMES: FakeRaGame[] = [
  {
    id: 3001,
    consoleId: 21,
    title: "Mar de Estrelas",
    players: 1000,
    achievements: [
      { id: 30011, title: "Primeira viagem", description: "Saia do planeta natal.", points: 5, awarded: 900, daysAgo: 40, hardcore: true },
      { id: 30012, title: "Navegador", description: "Visite cinco planetas.", points: 10, awarded: 600, daysAgo: 3 },
      { id: 30013, title: "Tempestade solar", description: "Atravesse a tempestade solar.", points: 10, awarded: 300, daysAgo: 1 },
      { id: 30014, title: "Colecionador de cometas", description: "Junte 100 cometas.", points: 25, awarded: 100, daysAgo: null },
      { id: 30015, title: "Mapa completo", description: "Descubra todos os planetas.", points: 25, awarded: 80, daysAgo: null },
      { id: 30016, title: "Sem arranhões", description: "Termine o jogo sem perder a nave.", points: 50, awarded: 20, daysAgo: null },
    ],
  },
  {
    id: 3002,
    consoleId: 21,
    title: "Rally Extremo 3",
    players: 400,
    achievements: [
      { id: 30021, title: "Primeira vitória", description: "Vença uma corrida.", points: 5, awarded: 320, daysAgo: 2 },
      { id: 30022, title: "Lama até o pescoço", description: "Vença no pântano.", points: 10, awarded: 120, daysAgo: 2 },
      { id: 30023, title: "Rei da neve", description: "Vença todas as corridas na neve.", points: 25, awarded: 40, daysAgo: null },
      { id: 30024, title: "Volta perfeita", description: "Faça uma volta sem bater.", points: 50, awarded: 12, daysAgo: null },
    ],
  },
  {
    id: 3003,
    consoleId: 21,
    title: "Rally Extremo 2",
    players: 300,
    achievements: [{ id: 30031, title: "Pódio", description: "Termine entre os três primeiros.", points: 5, awarded: 200, daysAgo: null }],
  },
  {
    id: 3004,
    consoleId: 12,
    title: "Neon Madrugada",
    players: 200,
    achievements: [
      { id: 30041, title: "Primeiro turno", description: "Termine a primeira noite.", points: 5, awarded: 180, daysAgo: 10 },
      { id: 30042, title: "Hora do rush", description: "Entregue 50 pedidos.", points: 10, awarded: 90, daysAgo: 8 },
      { id: 30043, title: "Madrugada inteira", description: "Termine o jogo.", points: 25, awarded: 16, daysAgo: 5, hardcore: true },
    ],
  },
  {
    id: 3005,
    consoleId: 5,
    title: "Cidadela Sombria",
    players: 50,
    achievements: [
      { id: 30051, title: "Portão aberto", description: "Abra o portão da cidadela.", points: 5, awarded: 40, daysAgo: null },
      { id: 30052, title: "Torre final", description: "Chegue ao topo da torre.", points: 25, awarded: 5, daysAgo: null },
    ],
  },
  {
    id: 3009,
    consoleId: 21,
    title: "~Hack~ Mar de Estrelas: Edição Turbo",
    players: 10,
    achievements: [{ id: 30091, title: "Turbo", description: "Ligue o turbo.", points: 5, awarded: 5, daysAgo: 1 }],
  },
]

/** A data no formato do RetroAchievements ("2026-09-24 21:30:00", em UTC). */
const raText = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ")

/** O RetroAchievements de mentira: o que foi desbloqueado muda com `unlock` (conquista nova, agora). */
function createRaState() {
  const startedAt = Date.now()
  const unlockedNow = new Map<number, Date>()
  const earnedAt = (achievement: FakeAchievement): Date | null =>
    unlockedNow.get(achievement.id) ??
    (achievement.daysAgo === null ? null : new Date(startedAt - achievement.daysAgo * 24 * 60 * 60 * 1000))
  return { earnedAt, unlock: (id: number) => unlockedNow.set(id, new Date()) }
}

type RaState = ReturnType<typeof createRaState>

export interface FakeMetadataServer {
  url: string
  /** Pedidos recebidos (método e caminho), para os testes conferirem. */
  requests: string[]
  /** Desbloqueia agora uma conquista no RetroAchievements de mentira (como se o emulador tivesse avisado o site). */
  unlockAchievement: (id: number) => void
  close: () => Promise<void>
}

export async function startFakeMetadataServer(): Promise<FakeMetadataServer> {
  const requests: string[] = []
  const ra = createRaState()
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    void handle(request, response, base, ra).catch(() => send(response, 500, { erro: "falhou" }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url: base,
    requests,
    unlockAchievement: (id) => void ra.unlock(id),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

async function handle(request: IncomingMessage, response: ServerResponse, base: string, ra: RaState): Promise<void> {
  const url = new URL(request.url ?? "/", base)
  const path = url.pathname
  const body = await readBody(request)

  if (path.startsWith("/ra/API/")) return handleRetroAchievements(url, response, ra)
  const badge = /^\/ra-media\/Badge\/(\d+)(_lock)?\.png$/.exec(path)
  if (badge) {
    // Colorida (uma cor por insígnia) ou apagada, como o RetroAchievements publica.
    const hue: Rgb[] = [[230, 170, 50], [70, 150, 230], [200, 80, 160], [80, 190, 120]]
    const color = hue[Number(badge[1]) % hue.length]
    const top: Rgb = badge[2] ? [95, 95, 100] : color
    const bottom: Rgb = badge[2] ? [45, 45, 50] : [color[0] / 3, color[1] / 3, color[2] / 3]
    return sendPng(response, makePng(64, 64, top, bottom))
  }

  if (path === "/twitch/token") {
    const valid =
      url.searchParams.get("client_id") === IGDB_CLIENT_ID && url.searchParams.get("client_secret") === IGDB_CLIENT_SECRET
    return valid ? send(response, 200, { access_token: TOKEN, expires_in: 5000000 }) : send(response, 400, { message: "invalid client" })
  }

  if (path === "/igdb/games") {
    if (request.headers["client-id"] !== IGDB_CLIENT_ID || request.headers.authorization !== `Bearer ${TOKEN}`) {
      return send(response, 401, { message: "Authorization Failure" })
    }
    const term = /search "((?:[^"\\]|\\.)*)"/.exec(body)?.[1] ?? ""
    const game = IGDB_GAMES[term.toLowerCase()]
    return send(response, 200, game ? [game] : [])
  }

  if (path.startsWith("/sgdb/")) {
    if (request.headers.authorization !== `Bearer ${STEAMGRIDDB_KEY}`) {
      return send(response, 401, { success: false, errors: ["Invalid API key"] })
    }
    const search = /^\/sgdb\/search\/autocomplete\/(.+)$/.exec(path)
    if (search) {
      const term = decodeURIComponent(search[1]).toLowerCase()
      const found = STEAMGRIDDB_GAMES.filter((game) => game.name.toLowerCase() === term || term === "mario")
      return send(response, 200, { success: true, data: found.map(({ id, name }) => ({ id, name })) })
    }
    const images = /^\/sgdb\/(grids|heroes|icons)\/game\/(\d+)$/.exec(path)
    if (images) {
      const kind = { grids: "cover", heroes: "background", icons: "icon" }[images[1]]
      const game = STEAMGRIDDB_GAMES.find((item) => item.id === Number(images[2]))
      return send(response, 200, { success: true, data: game ? [{ url: `${base}/cdn/${game.id}-${kind}.png` }] : [] })
    }
  }

  // As capas do libretro-thumbnails, pelo nome exato da ROM (só as que este "servidor" tem).
  const libretro = /^\/libretro\/(.+)\/Named_Boxarts\/(.+)\.png$/.exec(path)
  if (libretro) {
    const name = decodeURIComponent(libretro[2])
    if (!LIBRETRO_BOXARTS.includes(name)) return send(response, 404, { erro: "não encontrado" })
    return sendPng(response, makePng(120, 170, [40, 160, 90], [10, 50, 30]))
  }

  // As imagens: geradas na hora, em degradê (capa em retrato, fundo largo, ícone quadrado).
  const cdn = /^\/cdn\/(\d+)-(cover|background|icon)\.png$/.exec(path)
  if (cdn) {
    const game = STEAMGRIDDB_GAMES.find((item) => item.id === Number(cdn[1]))
    const kind = cdn[2] as "cover" | "background" | "icon"
    if (!game) return send(response, 404, { erro: "não encontrado" })
    const size = { cover: [120, 180], background: [384, 124], icon: [64, 64] }[kind]
    return sendPng(response, makePng(size[0], size[1], game[kind][0], game[kind][1]))
  }
  if (path.startsWith("/igdb-images/")) {
    const cover = path.includes("t_cover_big")
    return sendPng(response, cover ? makePng(120, 180, [200, 60, 60], [60, 10, 10]) : makePng(320, 180, [60, 60, 70], [20, 20, 25]))
  }

  send(response, 404, { erro: "não encontrado" })
}

/** A API do RetroAchievements: a chave vai no parâmetro `y` e, errada, dá 401 (como no site). */
function handleRetroAchievements(url: URL, response: ServerResponse, ra: RaState): void {
  if (url.searchParams.get("y") !== RA_API_KEY) return send(response, 401, { message: "Unauthenticated." })
  const isUser = (url.searchParams.get("u") ?? "").toLowerCase() === RA_USERNAME.toLowerCase()

  switch (url.pathname.slice("/ra/API/".length)) {
    case "API_GetUserProfile.php":
      return isUser ? send(response, 200, { User: RA_USERNAME, TotalPoints: 80 }) : send(response, 404, [])

    case "API_GetConsoleIDs.php":
      return send(response, 200, RA_CONSOLES.map((console) => ({ ...console, Active: true, IsGameSystem: true })))

    case "API_GetGameList.php": {
      const games = RA_GAMES.filter((game) => game.consoleId === Number(url.searchParams.get("i")))
      return send(
        response,
        200,
        games.map((game) => ({ ID: game.id, Title: game.title, ConsoleID: game.consoleId, NumAchievements: game.achievements.length }))
      )
    }

    case "API_GetGameInfoAndUserProgress.php": {
      const game = RA_GAMES.find((item) => item.id === Number(url.searchParams.get("g")))
      if (!game || !isUser) return send(response, 404, {})
      // As conquistas vêm num objeto indexado pelo id, como no site.
      const achievements = game.achievements.map((achievement, index) => {
        const earned = ra.earnedAt(achievement)
        return [
          String(achievement.id),
          {
            ID: achievement.id,
            Title: achievement.title,
            Description: achievement.description,
            Points: achievement.points,
            BadgeName: String(achievement.id),
            DisplayOrder: index + 1,
            NumAwarded: achievement.awarded,
            ...(earned ? { DateEarned: raText(earned) } : {}),
            ...(earned && achievement.hardcore ? { DateEarnedHardcore: raText(earned) } : {}),
          },
        ]
      })
      return send(response, 200, {
        ID: game.id,
        Title: game.title,
        ConsoleID: game.consoleId,
        NumDistinctPlayers: game.players,
        NumAchievements: game.achievements.length,
        Achievements: Object.fromEntries(achievements),
      })
    }

    case "API_GetUserRecentAchievements.php": {
      const since = Date.now() - Number(url.searchParams.get("m") ?? 60) * 60 * 1000
      const recent = RA_GAMES.flatMap((game) =>
        game.achievements.flatMap((achievement) => {
          const earned = ra.earnedAt(achievement)
          return earned && earned.getTime() >= since
            ? [{ Date: raText(earned), AchievementID: achievement.id, Title: achievement.title, GameID: game.id, GameTitle: game.title }]
            : []
        })
      )
      return send(response, 200, recent)
    }
  }
  send(response, 404, { erro: "não encontrado" })
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk: string) => (body += chunk))
    request.on("end", () => resolve(body))
  })
}

function send(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(data))
}

function sendPng(response: ServerResponse, png: Buffer): void {
  response.writeHead(200, { "content-type": "image/png" })
  response.end(png)
}
