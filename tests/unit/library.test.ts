import { describe, expect, it } from "vitest"
import {
  createStatus,
  deleteStatus,
  getLibrary,
  getStatusRules,
  listGames,
  listStatuses,
  renameStatus,
  reorderStatuses,
  setGameStatus,
  setStatusRules,
} from "../../src/main/library"
import { DEFAULT_STATUSES, runMigrations } from "../../src/main/migrations"
import { seedSampleGames } from "../../src/main/sampleGames"
import { memoryDatabase } from "./helpers"

const statusId = (db: ReturnType<typeof memoryDatabase>, name: string) =>
  listStatuses(db).find((status) => status.name === name)!.id

describe("migrações", () => {
  it("banco novo: os 9 status na ordem e as regras (jogo novo → Planejo jogar; primeiro jogo → Jogando)", () => {
    const db = memoryDatabase()
    expect(listStatuses(db).map((status) => status.name)).toEqual(DEFAULT_STATUSES)
    expect(listStatuses(db).map((status) => status.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    const rules = getStatusRules(db)
    expect(rules.newGameStatusId).toBe(statusId(db, "Planejo jogar"))
    expect(rules.firstPlayStatusId).toBe(statusId(db, "Jogando"))
    expect(db.pragma("user_version", { simple: true })).toBe(8)
  })
  it("rodar de novo não duplica nada", () => {
    const db = memoryDatabase()
    runMigrations(db)
    expect(listStatuses(db)).toHaveLength(DEFAULT_STATUSES.length)
  })
})

describe("jogos", () => {
  it("jogos de exemplo: 12, em ordem alfabética, e só quando a biblioteca está vazia", () => {
    const db = memoryDatabase()
    seedSampleGames(db)
    seedSampleGames(db)
    const games = listGames(db)
    expect(games).toHaveLength(12)
    expect(games[0].title).toBe("Cavaleiros de Pixel")
    expect(games.map((game) => game.title)).toEqual([...games.map((game) => game.title)].sort((a, b) => a.localeCompare(b, "pt-BR")))
    const mar = games.find((game) => game.title === "Mar de Estrelas")!
    expect(mar).toMatchObject({ favorite: true, playtimeMinutes: 12040, platform: "PlayStation 2", library: "PCSX2" })
    expect(mar.statusId).toBe(statusId(db, "Platinado"))
  })
  it("muda o status de um jogo", () => {
    const db = memoryDatabase()
    seedSampleGames(db)
    const game = listGames(db)[0]
    setGameStatus(db, game.id, statusId(db, "Zerado"))
    expect(listGames(db)[0].statusId).toBe(statusId(db, "Zerado"))
    expect(() => setGameStatus(db, game.id, 999)).toThrow("Status não encontrado")
    expect(() => setGameStatus(db, 999, statusId(db, "Zerado"))).toThrow("Jogo não encontrado")
  })
  it("getLibrary junta jogos, status e regras", () => {
    const db = memoryDatabase()
    seedSampleGames(db)
    const library = getLibrary(db)
    expect(library.games).toHaveLength(12)
    expect(library.statuses).toHaveLength(9)
    expect(library.rules.newGameStatusId).toBe(statusId(db, "Planejo jogar"))
  })
})

describe("status", () => {
  it("cria no fim, tirando espaços extras", () => {
    const db = memoryDatabase()
    const status = createStatus(db, "  Quero   rejogar ")
    expect(status).toMatchObject({ name: "Quero rejogar", position: 9 })
    expect(listStatuses(db).at(-1)!.name).toBe("Quero rejogar")
  })
  it("não aceita nome vazio, longo demais ou repetido (sem ligar para maiúsculas e acentos)", () => {
    const db = memoryDatabase()
    expect(() => createStatus(db, "   ")).toThrow("precisa de um nome")
    expect(() => createStatus(db, "x".repeat(41))).toThrow("até 40 letras")
    expect(() => createStatus(db, "ZERADO")).toThrow('Já existe um status chamado "ZERADO"')
    expect(() => renameStatus(db, statusId(db, "Jogando"), "zerado")).toThrow("Já existe")
  })
  it("renomeia (inclusive só mudando maiúsculas do próprio nome)", () => {
    const db = memoryDatabase()
    const id = statusId(db, "Planejo jogar")
    renameStatus(db, id, "Planejo Jogar")
    renameStatus(db, id, "Quero jogar")
    expect(listStatuses(db)[0]).toMatchObject({ id, name: "Quero jogar" })
  })
  it("muda a ordem, exigindo todos os status uma vez cada", () => {
    const db = memoryDatabase()
    const ids = listStatuses(db).map((status) => status.id)
    reorderStatuses(db, [...ids].reverse())
    expect(listStatuses(db).map((status) => status.name)).toEqual([...DEFAULT_STATUSES].reverse())
    expect(() => reorderStatuses(db, ids.slice(1))).toThrow("todos os status")
    expect(() => reorderStatuses(db, [ids[0], ...ids.slice(0, -1)])).toThrow("todos os status")
  })
  it("apagar passa os jogos e as regras para outro status e refaz as posições", () => {
    const db = memoryDatabase()
    seedSampleGames(db)
    const planejo = statusId(db, "Planejo jogar")
    const jogando = statusId(db, "Jogando")
    const antes = listGames(db).filter((game) => game.statusId === planejo).length
    expect(antes).toBe(2)

    deleteStatus(db, planejo, jogando)

    expect(listStatuses(db).map((status) => status.name)).not.toContain("Planejo jogar")
    expect(listStatuses(db).map((status) => status.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(listGames(db).filter((game) => game.statusId === jogando)).toHaveLength(3 + antes)
    expect(getStatusRules(db).newGameStatusId).toBe(jogando)
  })
  it("não apaga para ele mesmo, nem o último status", () => {
    const db = memoryDatabase()
    const ids = listStatuses(db).map((status) => status.id)
    expect(() => deleteStatus(db, ids[0], ids[0])).toThrow("Escolha outro status")
    for (const id of ids.slice(1)) deleteStatus(db, id, ids[0])
    expect(listStatuses(db)).toHaveLength(1)
    expect(() => deleteStatus(db, ids[0], 999)).toThrow("Status não encontrado")
  })
  it("regras automáticas só aceitam status que existem", () => {
    const db = memoryDatabase()
    const zerado = statusId(db, "Zerado")
    setStatusRules(db, { newGameStatusId: zerado, firstPlayStatusId: zerado })
    expect(getStatusRules(db)).toEqual({ newGameStatusId: zerado, firstPlayStatusId: zerado })
    expect(() => setStatusRules(db, { newGameStatusId: 999, firstPlayStatusId: zerado })).toThrow("Status não encontrado")
  })
})
