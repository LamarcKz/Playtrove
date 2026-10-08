import { afterEach, describe, expect, it } from "vitest"
import { gradeForPoints, rarityOf } from "@shared/achievements"
import { createRaClient, raDate, type RaClient, type RaGameProgress } from "../../src/main/achievements/client"
import { consoleIdFor, matchRaGame, raMatchScore } from "../../src/main/achievements/matching"
import { saveGameProgress, saveRaAccount } from "../../src/main/achievements/store"
import { syncAchievements } from "../../src/main/achievements/sync"
import { getGameAchievements, getOverview, progressByGame } from "../../src/main/achievements/views"
import { addEmulatedGame, listGames } from "../../src/main/library"
import { MetadataStopError, type Fetch } from "../../src/main/metadata/http"
import { setSetting } from "../../src/main/settings"
import { makeTempDir, memoryDatabase, removeTempDirs } from "./helpers"

afterEach(removeTempDirs)

const ENDPOINTS = { api: "https://ra.test/API", media: "https://media.test" }
/** Sem imagens nos testes. */
const NO_IMAGES = { badge: () => null, trophyIcon: () => null }
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })

describe("raridade no estilo da PlayStation", () => {
  it("pelas faixas de porcentagem de jogadores", () => {
    expect(rarityOf(80)).toBe("comum")
    expect(rarityOf(50)).toBe("comum")
    expect(rarityOf(49.9)).toBe("rara")
    expect(rarityOf(15)).toBe("rara")
    expect(rarityOf(10)).toBe("muito-rara")
    expect(rarityOf(4.9)).toBe("ultrarrara")
    expect(rarityOf(0)).toBe("ultrarrara")
  })

  it("o tipo de troféu das conquistas vem dos pontos: bronze até 9, prata até 24, ouro com 25 ou mais", () => {
    expect([0, 5, 9, 10, 24, 25, 50, 100].map(gradeForPoints)).toEqual([
      "bronze",
      "bronze",
      "bronze",
      "prata",
      "prata",
      "ouro",
      "ouro",
      "ouro",
    ])
  })
})

describe("API do RetroAchievements", () => {
  it("lê o progresso de um jogo (as conquistas vêm num objeto indexado pelo id) e as datas em UTC", async () => {
    const calls: string[] = []
    const fetch: Fetch = async (url) => {
      calls.push(url)
      return json({
        ID: 77,
        Title: "Salto Estelar",
        NumDistinctPlayers: "200",
        Achievements: {
          "5": { ID: 5, Title: "Primeiro salto", Description: "Pule.", Points: 5, BadgeName: "1001", DisplayOrder: 1, NumAwarded: 150, DateEarned: "2026-09-20 21:30:00" },
          "6": { ID: 6, Title: "Chefe final", Description: "Vença.", Points: 25, BadgeName: "1002", DisplayOrder: 2, NumAwarded: 6 },
        },
      })
    }
    const progress = await createRaClient(fetch, ENDPOINTS, { username: "jogador", apiKey: "chave" }).gameProgress(77)

    expect(calls[0]).toBe("https://ra.test/API/API_GetGameInfoAndUserProgress.php?g=77&u=jogador&y=chave")
    expect(progress).toMatchObject({ id: 77, title: "Salto Estelar", numDistinctPlayers: 200 })
    expect(progress.achievements[0]).toMatchObject({ id: 5, earnedAt: "2026-09-20T21:30:00.000Z", earnedHardcoreAt: null })
    expect(progress.achievements[1].earnedAt).toBeNull()
  })

  it("chave recusada (401) para a atualização inteira", async () => {
    const client = createRaClient(async () => json({ message: "Unauthenticated." }, 401), ENDPOINTS, { username: "a", apiKey: "b" })
    await expect(client.consoles()).rejects.toBeInstanceOf(MetadataStopError)
  })

  it("usuário que não existe não passa na conferência (resposta vazia ou 404)", async () => {
    const empty = createRaClient(async () => json({}), ENDPOINTS, { username: "ninguem", apiKey: "b" })
    await expect(empty.validate()).rejects.toThrow('Não achei o usuário "ninguem"')
    const notFound = createRaClient(async () => json([], 404), ENDPOINTS, { username: "ninguem", apiKey: "b" })
    await expect(notFound.validate()).rejects.toThrow('Não achei o usuário "ninguem"')
  })

  it("datas com e sem fuso", () => {
    expect(raDate("2023-12-27 16:04:50")).toBe("2023-12-27T16:04:50.000Z")
    expect(raDate("2023-10-27T02:52:34+00:00")).toBe("2023-10-27T02:52:34.000Z")
    expect(raDate("")).toBeNull()
    expect(raDate(null)).toBeNull()
  })
})

describe("achar o console e o jogo", () => {
  const consoles = [
    { id: 1, name: "Genesis/Mega Drive" },
    { id: 3, name: "SNES/Super Famicom" },
    { id: 12, name: "PlayStation" },
    { id: 21, name: "PlayStation 2" },
  ]

  it("pelo nome do console, com os apelidos", () => {
    expect(consoleIdFor("PlayStation 2", consoles)).toBe(21)
    expect(consoleIdFor("PlayStation", consoles)).toBe(12)
    expect(consoleIdFor("Mega Drive", consoles)).toBe(1)
    expect(consoleIdFor("Super Nintendo", consoles)).toBe(3)
    // O PS3 não tem conquistas no RetroAchievements.
    expect(consoleIdFor("PlayStation 3", consoles)).toBeNull()
    expect(consoleIdFor(null, consoles)).toBeNull()
  })

  it("o número da série tem que bater (Tekken 3 não vira Tekken 2)", () => {
    expect(raMatchScore("Tekken 3", "Tekken 3")).toBe(3)
    expect(raMatchScore("Tekken 3", "Tekken 2")).toBe(0)
    expect(raMatchScore("Lenda Sombria VII (Disc 1)", "Lenda Sombria VII")).toBe(3)
    expect(raMatchScore("Corrida Noturna - Edição Turbo", "Corrida Noturna: Edição Turbo")).toBe(3)
    expect(raMatchScore("Legend of Zelda - A Link to the Past", "Legend of Zelda, The: A Link to the Past")).toBe(3)
    expect(raMatchScore("Castelo Sombrio", "Castelo Sombrio: Sinfonia da Noite")).toBe(2)
  })

  it("fora hacks, jogos caseiros e subsets; nomes com alternativas valem", () => {
    const catalog = [
      { id: 10, title: "~Hack~ Salto Estelar Turbo", numAchievements: 20 },
      { id: 11, title: "Salto Estelar [Subset - Bônus]", numAchievements: 5 },
      { id: 12, title: "Salto Estelar | Star Jump", numAchievements: 40 },
      { id: 13, title: "Salto Estelar 2", numAchievements: 30 },
    ]
    expect(matchRaGame("Salto Estelar", catalog)?.id).toBe(12)
    expect(matchRaGame("Star Jump", catalog)?.id).toBe(12)
    expect(matchRaGame("Jogo Que Não Existe", catalog)).toBeNull()
  })
})

/** Um RetroAchievements de mentira: o catálogo, o progresso de cada jogo e as recentes. */
function fakeClient(progress: Record<number, RaGameProgress>, recent: number[] = []): RaClient & { progressCalls: number[] } {
  const progressCalls: number[] = []
  return {
    progressCalls,
    validate: async () => undefined,
    consoles: async () => [{ id: 21, name: "PlayStation 2" }],
    catalog: async () => [
      { id: 77, title: "Salto Estelar", numAchievements: 3 },
      { id: 88, title: "Pista Real 4", numAchievements: 2 },
    ],
    gameProgress: async (id) => {
      progressCalls.push(id)
      return structuredClone(progress[id])
    },
    recentGameIds: async () => recent,
  }
}

function achievement(id: number, numAwarded: number, earnedAt: string | null = null) {
  return {
    id,
    title: `Conquista ${id}`,
    description: "Descrição",
    points: 10,
    badgeName: String(9000 + id),
    displayOrder: id,
    numAwarded,
    earnedAt,
    earnedHardcoreAt: null,
  }
}

describe("atualizar as conquistas", () => {
  function setup() {
    const db = memoryDatabase()
    const add = (title: string, platform: string) =>
      addEmulatedGame(db, { title, romPath: `D:\\Jogos\\${title}.iso`, platform, library: "PCSX2", emulatorId: "pcsx2", core: null }) as number
    const ids = {
      salto: add("Salto Estelar", "PlayStation 2"),
      pista: add("Pista Real 4", "PlayStation 2"),
      manobras: add("Manobras Radicais 3", "PlayStation 3"),
    }
    const progress: Record<number, RaGameProgress> = {
      77: { id: 77, title: "Salto Estelar", numDistinctPlayers: 100, achievements: [achievement(1, 90, "2026-09-20T10:00:00.000Z"), achievement(2, 30), achievement(3, 2)] },
      88: { id: 88, title: "Pista Real 4", numDistinctPlayers: 50, achievements: [achievement(4, 40, "2026-08-01T10:00:00.000Z"), achievement(5, 10, "2026-08-02T10:00:00.000Z")] },
    }
    // As insígnias não são baixadas nos testes (o servidor de mentira responde 404).
    const services = (client: RaClient) => ({ client, fetch: (async () => new Response(null, { status: 404 })) as Fetch, endpoints: ENDPOINTS, imagesDir: makeTempDir() })
    return { db, ids, progress, services }
  }

  it("primeira vez: acha os jogos pelo catálogo, guarda o progresso e não avisa nada antigo", async () => {
    const { db, ids, progress, services } = setup()
    const now = new Date(2026, 8, 24, 12, 0)
    const result = await syncAchievements(db, services(fakeClient(progress)), { full: true, since: null, now })

    expect(result).toEqual({ updatedGames: 2, newlyEarned: [] })
    const games = new Map(listGames(db).map((game) => [game.id, game]))
    expect(games.get(ids.salto)?.achievements).toEqual({ unlocked: 1, total: 3, platinum: false, source: "retroachievements" })
    expect(games.get(ids.pista)?.achievements).toEqual({ unlocked: 2, total: 2, platinum: true, source: "retroachievements" })
    // O PS3 não tem conquistas: fica sem.
    expect(games.get(ids.manobras)?.achievements).toBeNull()

    const salto = getGameAchievements(db, ids.salto, NO_IMAGES)
    expect(salto?.achievements.map((item) => [item.percent, item.rarity])).toEqual([
      [90, "comum"],
      [30, "rara"],
      [2, "ultrarrara"],
    ])
    expect(salto).toMatchObject({ unlocked: 1, total: 3, points: 10, totalPoints: 30, platinum: false })
  })

  it("depois: só os jogos com conquistas novas, e as novas viram aviso", async () => {
    const { db, ids, progress, services } = setup()
    await syncAchievements(db, services(fakeClient(progress)), { full: true, since: null, now: new Date(2026, 8, 24, 12, 0) })

    progress[77].achievements[1].earnedAt = "2026-09-24T12:03:00.000Z"
    const client = fakeClient(progress, [77])
    const result = await syncAchievements(db, services(client), {
      full: false,
      since: new Date(2026, 8, 24, 12, 0).toISOString(),
      now: new Date(2026, 8, 24, 12, 5),
    })

    expect(client.progressCalls).toEqual([77])
    expect(result).toEqual({ updatedGames: 1, newlyEarned: [2] })
    expect(progressByGame(db).get(ids.salto)).toEqual({ unlocked: 2, total: 3, platinum: false, source: "retroachievements" })
  })

  it("tirar a conta esconde as conquistas da biblioteca e da aba", async () => {
    const { db, ids, progress, services } = setup()
    setSetting(db, "raUsername", "jogador")
    await syncAchievements(db, services(fakeClient(progress)), { full: true, since: null, now: new Date(2026, 8, 24, 12, 0) })
    expect(progressByGame(db).size).toBe(2)

    saveRaAccount(db, null)
    expect(progressByGame(db).size).toBe(0)
    expect(listGames(db).find((game) => game.id === ids.salto)?.achievements).toBeNull()
    expect(getOverview(db, NO_IMAGES).games).toEqual([])
    expect(getGameAchievements(db, ids.salto, NO_IMAGES)).toBeNull()
  })

  it("jogos atualizados há mais de um dia entram na rodada (a raridade muda devagar)", async () => {
    const { db, progress, services } = setup()
    await syncAchievements(db, services(fakeClient(progress)), { full: true, since: null, now: new Date(2026, 8, 20, 12, 0) })

    const client = fakeClient(progress)
    const now = new Date(2026, 8, 24, 12, 0)
    await syncAchievements(db, services(client), { full: false, since: new Date(2026, 8, 24, 11, 55).toISOString(), now })
    expect(client.progressCalls.sort()).toEqual([77, 88])
  })

  it("a aba: totais, platinas, raridade das desbloqueadas, recentes e contagem por dia e por mês", async () => {
    const { db, ids, progress } = setup()
    const now = new Date(2026, 8, 24, 12, 0)
    // Direto no banco, sem o catálogo (os jogos já achados).
    db.prepare("UPDATE games SET ra_game_id = 77 WHERE id = ?").run(ids.salto)
    db.prepare("UPDATE games SET ra_game_id = 88 WHERE id = ?").run(ids.pista)
    saveGameProgress(db, progress[77], now)
    saveGameProgress(db, progress[88], now)

    const overview = getOverview(db, NO_IMAGES, now)
    expect(overview).toMatchObject({ unlocked: 3, total: 5, points: 30, platinums: 1 })
    expect(overview.games.map((game) => game.title)).toEqual(["Salto Estelar", "Pista Real 4"])
    // Os tipos saem dos pontos (10 pontos = prata), e a platina vale quando todas foram pegas.
    expect(overview.games[1].byGrade).toEqual({
      platina: { unlocked: 1, total: 1 },
      ouro: { unlocked: 0, total: 0 },
      prata: { unlocked: 2, total: 2 },
      bronze: { unlocked: 0, total: 0 },
    })
    expect(overview.games[0].byGrade.platina).toEqual({ unlocked: 0, total: 1 })
    expect(overview.recent.map((item) => item.id)).toEqual([1, 5, 4])
    expect(overview.byDay).toHaveLength(30)
    expect(overview.byDay.reduce((sum, day) => sum + day.count, 0)).toBe(1)
    expect(overview.byMonth.at(-1)).toEqual({ month: "2026-09", count: 1 })
    expect(overview.byMonth.at(-2)).toEqual({ month: "2026-08", count: 2 })
  })
})
