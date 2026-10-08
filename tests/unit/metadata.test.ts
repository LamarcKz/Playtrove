import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type Database from "better-sqlite3"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MetadataProgress } from "@shared/types"
import { imageExtension, imageUrl, saveGameImage } from "../../src/main/imageFiles"
import {
  addEmulatedGame,
  getMetadataTarget,
  listGames,
  listGamesWithoutMetadata,
  saveGameMetadata,
  setGameFavorite,
} from "../../src/main/library"
import { downloadGameMetadata, type MetadataServices } from "../../src/main/metadata/download"
import { MetadataStopError, testEndpoints, type Fetch } from "../../src/main/metadata/http"
import { createIgdbSession, igdbPlatformId } from "../../src/main/metadata/igdb"
import { libretroBoxartUrl } from "../../src/main/metadata/libretro"
import { comparableName, matchScore, pickBestMatch, searchTermFor } from "../../src/main/metadata/matching"
import { createMetadataQueue } from "../../src/main/metadata/queue"
import { createSteamGridDbSession } from "../../src/main/metadata/steamGridDb"
import { makeTempDir, memoryDatabase, removeTempDirs } from "./helpers"

afterEach(removeTempDirs)

const ENDPOINTS = testEndpoints("https://servidor")
const CREDENTIALS = { clientId: "id-certo", clientSecret: "segredo-certo" }
const SGDB_KEY = "chave-certa"
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])

/** Um jogo como o IGDB devolve. */
const SALTO_ESTELAR = {
  id: 1234,
  name: "Salto Estelar",
  summary: "A aventura continua.",
  first_release_date: Date.UTC(2003, 9, 14) / 1000,
  genres: [{ name: "Platform" }, { name: "Adventure" }, { name: "Gênero Novo" }],
  involved_companies: [
    { company: { name: "Estúdio Aurora" }, developer: true, publisher: false },
    { company: { name: "Editora Meridiano" }, developer: false, publisher: true },
    { company: { name: "Editora Meridiano" }, developer: false, publisher: true },
  ],
  cover: { image_id: "co1abc" },
  artworks: [{ image_id: "ar1" }],
  screenshots: [{ image_id: "sc1" }],
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })
const image = (type: string) => new Response(PNG, { headers: { "content-type": type } })

/** Uma internet de mentira: cada pedido vai para `route`, que devolve a resposta (ou lança, como sem conexão). */
function fakeFetch(route: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init })
    return route(new URL(url), init)
  }
  return { fetch, calls }
}

/** Os dois serviços respondendo como de verdade, com o Salto Estelar encontrado nos dois. */
function servicesWorld(overrides: Partial<Record<string, () => Response>> = {}) {
  return fakeFetch((url, init) => {
    const path = url.pathname
    const custom = overrides[path]
    if (custom) return custom()
    if (path === "/twitch/token") return json({ access_token: "token-1", expires_in: 5000000 })
    if (path === "/igdb/games") return json(String(init?.body).includes('"Salto Estelar"') ? [SALTO_ESTELAR] : [])
    if (path.startsWith("/sgdb/search/autocomplete/")) return json({ success: true, data: [{ id: 55, name: "Salto Estelar" }] })
    if (path === "/sgdb/grids/game/55") return json({ success: true, data: [{ url: "https://cdn.test/capa.png" }] })
    if (path === "/sgdb/heroes/game/55") return json({ success: true, data: [{ url: "https://cdn.test/fundo.jpg" }] })
    if (path === "/sgdb/icons/game/55") return json({ success: true, data: [] })
    if (url.host === "cdn.test") return image(path.endsWith(".png") ? "image/png" : "image/jpeg")
    if (path.startsWith("/igdb-images/")) return image("image/jpeg")
    return json({ erro: "não encontrado" }, 404)
  })
}

function makeServices(fetch: Fetch, imagesDir: string, only?: "igdb" | "steamGridDb"): MetadataServices {
  return {
    fetch,
    endpoints: ENDPOINTS,
    imagesDir,
    igdb: only === "steamGridDb" ? null : createIgdbSession(fetch, ENDPOINTS, CREDENTIALS),
    steamGridDb: only === "igdb" ? null : createSteamGridDbSession(fetch, ENDPOINTS, SGDB_KEY),
  }
}

/** Um banco com um jogo de PS2 (e o id dele). */
function databaseWithGame(title = "Salto Estelar", platform = "PlayStation 2"): { db: Database.Database; gameId: number } {
  const db = memoryDatabase()
  const gameId = addEmulatedGame(db, {
    title,
    romPath: `D:\\PS2\\${title}.iso`,
    platform,
    library: "PCSX2",
    emulatorId: "pcsx2",
    core: null,
  }) as number
  return { db, gameId }
}

describe("nome para a busca", () => {
  it("tira o disco e o ' - ' dos nomes de ROM", () => {
    expect(searchTermFor("Corrida Noturna - Edição Turbo")).toBe("Corrida Noturna Edição Turbo")
    expect(searchTermFor("Lenda Sombria VII (Disc 2)")).toBe("Lenda Sombria VII")
    expect(comparableName("Pokémon: FireRed & LeafGreen!")).toBe("pokemon firered and leafgreen")
  })
  it("compara nomes: igual, com subtítulo, parecido ou outro jogo", () => {
    expect(matchScore("Pokemon FireRed Version", "Pokémon FireRed Version")).toBe(3)
    expect(matchScore("Corrida Noturna Edição Turbo", "Corrida Noturna: Edição Turbo")).toBe(3)
    expect(matchScore("Pista Real 4", "Pista Real 4: The Real Driving Simulator")).toBe(2)
    expect(matchScore("Lenda Sombria 7", "Lenda Sombria VII")).toBe(1)
    expect(matchScore("Meu Jogo Caseiro", "Minecraft")).toBe(0)
  })
  it("escolhe o mais parecido; se nenhum parecer o mesmo jogo, nenhum", () => {
    const results = [{ name: "Salto Estelar: Renegado" }, { name: "Salto Estelar" }, { name: "Salto Estelar 3" }]
    expect(pickBestMatch("Salto Estelar", results)).toEqual({ name: "Salto Estelar" })
    expect(pickBestMatch("Salto Estelar", [{ name: "Ratchet & Clank" }])).toBeNull()
  })
})

describe("IGDB", () => {
  it("pede o token, busca só na plataforma do jogo e guarda os gêneros como o IGDB escreve", async () => {
    const { fetch, calls } = servicesWorld()
    const igdb = createIgdbSession(fetch, ENDPOINTS, CREDENTIALS)

    const [game] = await igdb.search("Salto Estelar", 8)

    expect(calls[0].url).toBe(
      "https://servidor/twitch/token?client_id=id-certo&client_secret=segredo-certo&grant_type=client_credentials"
    )
    expect(calls[1].init?.headers).toMatchObject({ "Client-ID": "id-certo", Authorization: "Bearer token-1" })
    expect(calls[1].init?.body).toContain('search "Salto Estelar";')
    expect(calls[1].init?.body).toContain("where platforms = (8);")
    expect(game).toEqual({
      id: 1234,
      name: "Salto Estelar",
      summary: "A aventura continua.",
      releaseDate: "2003-10-14",
      genres: ["Platform", "Adventure", "Gênero Novo"],
      developers: ["Estúdio Aurora"],
      publishers: ["Editora Meridiano"],
      coverImageId: "co1abc",
      backgroundImageIds: ["ar1", "sc1"],
    })

    // O token é reaproveitado na busca seguinte.
    await igdb.search("Outro", null)
    expect(calls.filter((call) => call.url.includes("/twitch/token"))).toHaveLength(1)
    expect(calls[2].init?.body).not.toContain("where")
  })

  it("aspas no nome não quebram a busca", async () => {
    const { fetch, calls } = servicesWorld()
    await createIgdbSession(fetch, ENDPOINTS, CREDENTIALS).search('Diga "Olá"', null)
    expect(calls[1].init?.body).toContain('search "Diga \\"Olá\\"";')
  })

  it("token vencido: pede outro e tenta de novo", async () => {
    let first = true
    const { fetch, calls } = servicesWorld({
      "/igdb/games": () => {
        if (first) {
          first = false
          return json({ message: "Authorization Failure" }, 401)
        }
        return json([SALTO_ESTELAR])
      },
    })
    expect(await createIgdbSession(fetch, ENDPOINTS, CREDENTIALS).search("Salto Estelar", null)).toHaveLength(1)
    expect(calls.filter((call) => call.url.includes("/twitch/token"))).toHaveLength(2)
  })

  it("chaves erradas e falta de internet param tudo, com mensagem clara", async () => {
    const wrong = servicesWorld({ "/twitch/token": () => json({ message: "invalid client" }, 400) })
    const validation = createIgdbSession(wrong.fetch, ENDPOINTS, CREDENTIALS).validate()
    await expect(validation).rejects.toBeInstanceOf(MetadataStopError)
    await expect(validation).rejects.toThrow("O Client ID ou o Client Secret do IGDB estão errados.")

    const offline: Fetch = () => Promise.reject(new TypeError("fetch failed"))
    await expect(createIgdbSession(offline, ENDPOINTS, CREDENTIALS).search("Salto Estelar", null)).rejects.toThrow(
      "Não deu para falar com o IGDB. Confira a conexão com a internet."
    )
  })

  it("plataformas do IGDB pelo nome do console", () => {
    expect(igdbPlatformId("PlayStation 2")).toBe(8)
    expect(igdbPlatformId("ps2")).toBe(8)
    expect(igdbPlatformId("PlayStation")).toBe(7)
    expect(igdbPlatformId("Nintendo DS")).toBe(20)
    expect(igdbPlatformId("Game Boy Advance")).toBe(24)
    expect(igdbPlatformId("Atari 2600")).toBeNull()
    expect(igdbPlatformId(null)).toBeNull()
  })
})

describe("SteamGridDB", () => {
  it("busca com a chave e pega a imagem mais votada de cada tipo", async () => {
    const { fetch, calls } = servicesWorld({ "/sgdb/heroes/game/55": () => json({ success: false }, 404) })
    const sgdb = createSteamGridDbSession(fetch, ENDPOINTS, SGDB_KEY)

    expect(await sgdb.search("Salto Estelar")).toEqual([{ id: 55, name: "Salto Estelar" }])
    expect(calls[0].url).toBe("https://servidor/sgdb/search/autocomplete/Salto%20Estelar")
    expect(calls[0].init?.headers).toMatchObject({ Authorization: "Bearer chave-certa" })

    // Sem fundo (404) e sem ícone (lista vazia): só a capa.
    expect(await sgdb.images(55)).toEqual({ cover: "https://cdn.test/capa.png" })
    expect(calls[1].url).toContain("/sgdb/grids/game/55?dimensions=600x900")
  })

  it("chave errada para tudo", async () => {
    const { fetch } = servicesWorld({ "/sgdb/search/autocomplete/mario": () => json({ success: false }, 401) })
    await expect(createSteamGridDbSession(fetch, ENDPOINTS, "chave-errada").validate()).rejects.toThrow(
      "A chave do SteamGridDB está errada."
    )
  })
})

describe("libretro-thumbnails", () => {
  it("monta o endereço da capa pelo console e pelo nome exato da ROM", () => {
    expect(libretroBoxartUrl(ENDPOINTS, "PlayStation 2", "D:\\PS2\\Corrida Noturna - Edição Turbo (USA).iso")).toBe(
      "https://servidor/libretro/Sony%20-%20PlayStation%202/Named_Boxarts/Corrida%20Noturna%20-%20Edi%C3%A7%C3%A3o%20Turbo%20(USA).png"
    )
    expect(libretroBoxartUrl(ENDPOINTS, "Nintendo DS", "D:\\DS\\Criaturas Lendárias - Edição Prata (USA).zip")).toBe(
      "https://servidor/libretro/Nintendo%20-%20Nintendo%20DS/Named_Boxarts/Criaturas%20Lend%C3%A1rias%20-%20Edi%C3%A7%C3%A3o%20Prata%20(USA).png"
    )
    // Os caracteres que não valem em nome de arquivo viram "_", como no RetroArch.
    expect(libretroBoxartUrl(ENDPOINTS, "ps1", "D:\\PS1\\Cripta Antiga II: A Volta (USA).cue")).toContain(
      "Cripta%20Antiga%20II_%20A%20Volta%20(USA).png"
    )
    // Console que não está lá (PlayStation 3) ou jogo sem ROM: não tem capa no libretro.
    expect(libretroBoxartUrl(ENDPOINTS, "PlayStation 3", "D:\\PS3\\Manobras Radicais 3.iso")).toBeNull()
    expect(libretroBoxartUrl(ENDPOINTS, "PlayStation 2", null)).toBeNull()
  })
})

describe("baixar os metadados de um jogo", () => {
  it("junta o IGDB e o SteamGridDB, guarda as imagens e grava no banco", async () => {
    const { db, gameId } = databaseWithGame()
    const imagesDir = makeTempDir()
    const { fetch } = servicesWorld()

    expect(await downloadGameMetadata(db, gameId, makeServices(fetch, imagesDir))).toBe(true)

    const game = listGames(db)[0]
    expect(game).toMatchObject({
      description: "A aventura continua.",
      genres: ["Platform", "Adventure", "Gênero Novo"],
      developers: ["Estúdio Aurora"],
      publishers: ["Editora Meridiano"],
      releaseDate: "2003-10-14",
    })
    expect(game.coverUrl).toBe(imageUrl(gameId, "cover.png", game.metadataUpdatedAt))
    expect(game.backgroundUrl).toBe(imageUrl(gameId, "background.jpg", game.metadataUpdatedAt))
    expect(readdirSync(join(imagesDir, String(gameId))).sort()).toEqual(["background.jpg", "cover.png"])
    expect(listGamesWithoutMetadata(db)).toEqual([])
  })

  it("sem imagens no SteamGridDB, a capa e o fundo vêm do IGDB", async () => {
    const { db, gameId } = databaseWithGame()
    const imagesDir = makeTempDir()
    const { fetch, calls } = servicesWorld({ "/sgdb/search/autocomplete/Salto%20Estelar": () => json({ success: true, data: [] }) })

    await downloadGameMetadata(db, gameId, makeServices(fetch, imagesDir))

    expect(calls.map((call) => call.url)).toContain("https://servidor/igdb-images/t_cover_big/co1abc.jpg")
    expect(calls.map((call) => call.url)).toContain("https://servidor/igdb-images/t_1080p/ar1.jpg")
    expect(readdirSync(join(imagesDir, String(gameId))).sort()).toEqual(["background.jpg", "cover.jpg"])
  })

  it("só o SteamGridDB configurado: busca pelo nome do jogo e baixa só as imagens", async () => {
    const { db, gameId } = databaseWithGame()
    const { fetch, calls } = servicesWorld()

    expect(await downloadGameMetadata(db, gameId, makeServices(fetch, makeTempDir(), "steamGridDb"))).toBe(true)

    expect(calls.some((call) => call.url.includes("/igdb"))).toBe(false)
    expect(listGames(db)[0]).toMatchObject({ description: null, genres: [] })
    expect(listGames(db)[0].coverUrl).not.toBeNull()
  })

  it("jogo não encontrado: tenta sem a plataforma, marca a data e não apaga o que já havia", async () => {
    const { db, gameId } = databaseWithGame("Meu Jogo Caseiro")
    saveGameMetadata(
      db,
      gameId,
      { description: "Descrição antiga", genres: null, developers: null, publishers: null, releaseDate: null, igdbId: null, sgdbId: null, images: {} },
      "2026-01-01T00:00:00.000Z"
    )
    const { fetch, calls } = servicesWorld({
      "/sgdb/search/autocomplete/Meu%20Jogo%20Caseiro": () => json({ success: true, data: [{ id: 9, name: "Minecraft" }] }),
    })

    expect(await downloadGameMetadata(db, gameId, makeServices(fetch, makeTempDir()))).toBe(false)

    const igdbCalls = calls.filter((call) => call.url.endsWith("/igdb/games"))
    expect(igdbCalls).toHaveLength(2)
    expect(igdbCalls[0].init?.body).toContain("where platforms = (8);")
    expect(igdbCalls[1].init?.body).not.toContain("where")
    const game = listGames(db)[0]
    expect(game.description).toBe("Descrição antiga")
    expect(game.metadataUpdatedAt).not.toBe("2026-01-01T00:00:00.000Z")
  })

  it("nenhuma capa disponível não apaga a que o jogo já tinha", async () => {
    const { db, gameId } = databaseWithGame()
    const imagesDir = makeTempDir()
    await downloadGameMetadata(db, gameId, makeServices(servicesWorld().fetch, imagesDir))

    const naoAchou = () => new Response("não achei", { status: 404 })
    const broken = servicesWorld({ "/capa.png": naoAchou, "/igdb-images/t_cover_big/co1abc.jpg": naoAchou })
    await downloadGameMetadata(db, gameId, makeServices(broken.fetch, imagesDir))

    expect(existsSync(join(imagesDir, String(gameId), "cover.png"))).toBe(true)
    expect(listGames(db)[0].coverUrl).toContain("/cover.png?v=")
  })

  it("a capa vem do libretro-thumbnails quando existe; sem ela, do SteamGridDB e depois do IGDB", async () => {
    const libretro = "/libretro/Sony%20-%20PlayStation%202/Named_Boxarts/Salto%20Estelar.png"

    // 1. Com a capa no libretro-thumbnails (achada pelo nome exato da ROM).
    const comLibretro = servicesWorld({ [libretro]: () => image("image/png") })
    const primeiro = databaseWithGame()
    await downloadGameMetadata(primeiro.db, primeiro.gameId, makeServices(comLibretro.fetch, makeTempDir()))
    const pedidos = comLibretro.calls.map((call) => new URL(call.url).pathname)
    expect(pedidos).toContain(libretro)
    // A capa veio do libretro: o SteamGridDB nem foi baixado.
    expect(comLibretro.calls.map((call) => call.url)).not.toContain("https://cdn.test/capa.png")

    // 2. Sem ela, vale a do SteamGridDB.
    const semLibretro = servicesWorld()
    const segundo = databaseWithGame()
    await downloadGameMetadata(segundo.db, segundo.gameId, makeServices(semLibretro.fetch, makeTempDir()))
    expect(semLibretro.calls.map((call) => call.url)).toContain("https://cdn.test/capa.png")

    // 3. Jogo sem ROM (o libretro não se aplica) e sem SteamGridDB: sobra a do IGDB.
    const soIgdb = servicesWorld()
    const terceiro = databaseWithGame()
    soIgdb.calls.length = 0
    await downloadGameMetadata(terceiro.db, terceiro.gameId, makeServices(soIgdb.fetch, makeTempDir(), "igdb"))
    expect(soIgdb.calls.map((call) => call.url)).toContain("https://servidor/igdb-images/t_cover_big/co1abc.jpg")
  })
})

describe("fila de downloads", () => {
  /** Roda a fila até ela parar e devolve o último andamento. */
  function runQueue(db: Database.Database, services: MetadataServices | null, gameIds: number[]) {
    const updates: MetadataProgress[] = []
    const onGameUpdated = vi.fn()
    const finished = new Promise<MetadataProgress>((resolve) => {
      const queue = createMetadataQueue({
        getDatabase: () => db,
        getServices: () => services,
        onGameUpdated,
        onProgress: (progress) => {
          updates.push(progress)
          if (!progress.running) resolve(progress)
        },
      })
      queue.enqueue(gameIds)
    })
    return { finished, updates, onGameUpdated }
  }

  it("um jogo de cada vez: encontrados, não encontrados e erros", async () => {
    const db = memoryDatabase()
    const add = (title: string) =>
      addEmulatedGame(db, { title, romPath: `D:\\${title}.iso`, platform: "PlayStation 2", library: "PCSX2", emulatorId: "pcsx2", core: null }) as number
    const ids = [add("Salto Estelar"), add("Meu Jogo Caseiro"), add("Jogo Problemático")]
    const { fetch } = fakeFetch((url, init) => {
      if (url.pathname === "/twitch/token") return json({ access_token: "t", expires_in: 5000000 })
      if (String(init?.body).includes("Problemático")) return json({}, 500)
      return json(String(init?.body).includes('"Salto Estelar"') ? [SALTO_ESTELAR] : [])
    })

    const { finished, updates, onGameUpdated } = runQueue(db, makeServices(fetch, makeTempDir(), "igdb"), ids)
    const result = await finished

    expect(result).toEqual({
      running: false,
      done: 3,
      total: 3,
      current: null,
      found: 1,
      notFound: ["Meu Jogo Caseiro"],
      errors: ["Jogo Problemático: O IGDB respondeu com o erro 500."],
    })
    expect(updates[0]).toMatchObject({ running: true, total: 3, done: 0 })
    expect(updates.some((update) => update.current === "Salto Estelar")).toBe(true)
    expect(onGameUpdated).toHaveBeenCalledTimes(2)
  })

  it("sem internet, para a leva inteira", async () => {
    const { db, gameId } = databaseWithGame()
    const other = addEmulatedGame(db, {
      title: "Outro",
      romPath: "D:\\Outro.iso",
      platform: "PlayStation 2",
      library: "PCSX2",
      emulatorId: "pcsx2",
      core: null,
    }) as number
    const offline: Fetch = () => Promise.reject(new TypeError("fetch failed"))

    const result = await runQueue(db, makeServices(offline, makeTempDir()), [gameId, other]).finished

    expect(result).toMatchObject({ done: 1, total: 1, found: 0 })
    expect(result.errors).toEqual(["Não deu para falar com o IGDB. Confira a conexão com a internet."])
  })

  it("sem nenhum serviço configurado, avisa", async () => {
    const { db, gameId } = databaseWithGame()
    const result = await runQueue(db, null, [gameId]).finished
    expect(result.errors).toEqual(["Configure o IGDB ou o SteamGridDB em Configurações → Metadados."])
  })

  it("não repete jogos que já estão na fila (nem o que está sendo baixado)", async () => {
    const { db, gameId } = databaseWithGame()
    let finish: (progress: MetadataProgress) => void = () => undefined
    const finished = new Promise<MetadataProgress>((resolve) => (finish = resolve))
    const queue = createMetadataQueue({
      getDatabase: () => db,
      getServices: () => makeServices(servicesWorld().fetch, makeTempDir()),
      onGameUpdated: () => undefined,
      onProgress: (progress) => {
        if (!progress.running) finish(progress)
      },
    })
    expect(queue.enqueue([gameId, gameId, 999])).toBe(2)
    expect(queue.enqueue([999, gameId])).toBe(0)
    const result = await finished
    expect(result).toMatchObject({ done: 2, total: 2, found: 1, errors: ["Jogo 999: Jogo não encontrado."] })
  })
})

describe("imagens e dados no banco", () => {
  it("endereço, extensão e troca da imagem de um tipo", () => {
    expect(imageUrl(12, "cover.png", "2026-09-19T10:00:00.000Z")).toBe(
      "playtrove-img://images/12/cover.png?v=2026-09-19T10%3A00%3A00.000Z"
    )
    expect(imageExtension("image/png; charset=binary")).toBe("png")
    expect(imageExtension("image/jpeg")).toBe("jpg")
    expect(imageExtension("text/html")).toBeNull()
    expect(imageExtension(null)).toBeNull()

    const dir = makeTempDir()
    saveGameImage(dir, 3, "cover", PNG, "png")
    saveGameImage(dir, 3, "background", PNG, "png")
    expect(saveGameImage(dir, 3, "cover", PNG, "jpg")).toBe("cover.jpg")
    expect(readdirSync(join(dir, "3")).sort()).toEqual(["background.png", "cover.jpg"])
  })

  it("favorito, jogos sem metadados e o que a busca precisa saber", () => {
    const { db, gameId } = databaseWithGame()
    setGameFavorite(db, gameId, true)
    expect(listGames(db)[0].favorite).toBe(true)
    setGameFavorite(db, gameId, false)
    expect(listGames(db)[0].favorite).toBe(false)
    expect(() => setGameFavorite(db, 999, true)).toThrow("Jogo não encontrado.")

    expect(getMetadataTarget(db, gameId)).toEqual({
      title: "Salto Estelar",
      platform: "PlayStation 2",
      romPath: "D:\\PS2\\Salto Estelar.iso",
    })
    expect(listGamesWithoutMetadata(db)).toEqual([gameId])
  })
})
