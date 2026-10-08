import { copyFileSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { saveGameProgress } from "../../src/main/achievements/store"
import { findTrophyDir, parseTropConf, parseTropUsr, tickToIso } from "../../src/main/achievements/trophyFiles"
import { syncTrophies } from "../../src/main/achievements/trophySync"
import { getGameAchievements, getOverview } from "../../src/main/achievements/views"
import { readPs3TrophySets } from "../../src/main/discs"
import { addEmulatedGame, listGames } from "../../src/main/library"
import { buildIso, buildParamSfo } from "../fakeDiscs"
import { buildTropConf, buildTropUsr, toTick, type FakeTrophy } from "../fakeTrophies"
import { makeTempDir, memoryDatabase, removeTempDirs } from "./helpers"

afterEach(removeTempDirs)

const SET = "NPWR99999_00"
const TROPHIES: FakeTrophy[] = [
  { id: 0, name: "Lenda das Pistas", detail: "Pegue todos os outros troféus.", grade: "P" },
  { id: 1, name: "Primeira manobra", detail: "Faça a sua primeira manobra.", grade: "B" },
  { id: 2, name: "Rei do half-pipe", detail: "Vença o campeonato de half-pipe.", grade: "S" },
  { id: 3, name: "Segredo da cidade", detail: "Ache a pista escondida.", grade: "G", hidden: true },
  { id: 4, name: "Pico nevado", detail: "Vença na montanha.", grade: "B", group: "001" },
]
const CONF = buildTropConf({
  id: SET,
  title: "Manobras Radicais 3",
  trophies: TROPHIES,
  groups: [{ id: "001", name: "Pacote Montanha & Neve" }],
})
const DAY = 24 * 60 * 60 * 1000
const NO_IMAGES = { badge: () => null, trophyIcon: () => null }

describe("arquivos de troféus do RPCS3", () => {
  it("TROPCONF.SFM: nome do jogo, tipo, ocultos e o pacote extra de cada troféu", () => {
    const set = parseTropConf(`\uFEFF${CONF}`)
    expect(set.title).toBe("Manobras Radicais 3")
    expect(set.trophies.map((trophy) => [trophy.id, trophy.grade])).toEqual([
      [0, "platina"],
      [1, "bronze"],
      [2, "prata"],
      [3, "ouro"],
      [4, "bronze"],
    ])
    expect(set.trophies[3]).toMatchObject({ name: "Segredo da cidade", hidden: true, group: null })
    expect(set.trophies[4]).toMatchObject({ detail: "Vença na montanha.", hidden: false, group: "Pacote Montanha & Neve" })
  })

  it("TROPUSR.DAT: os troféus pegos e quando (o relógio do PS3 conta desde o ano 1)", () => {
    const when = new Date("2026-09-20T21:30:00.000Z")
    const unlocks = parseTropUsr(buildTropUsr(5, { 1: when, 2: new Date(when.getTime() + 60_000) }))
    expect([...unlocks]).toEqual([
      [1, "2026-09-20T21:30:00.000Z"],
      [2, "2026-09-20T21:31:00.000Z"],
    ])
    expect(() => parseTropUsr(Buffer.from("não é um TROPUSR"))).toThrow()
  })

  it("datas que não fazem sentido (relógio errado no emulador) ficam sem data", () => {
    const now = new Date("2026-09-24T12:00:00.000Z")
    expect(tickToIso(0n, now)).toBeNull()
    expect(tickToIso(toTick(new Date("1999-01-01T00:00:00Z")), now)).toBeNull()
    expect(tickToIso(toTick(new Date("2030-01-01T00:00:00Z")), now)).toBeNull()
    expect(tickToIso(toTick(new Date("2026-09-24T11:00:00Z")), now)).toBe("2026-09-24T11:00:00.000Z")
  })

  it("a pasta dos troféus: o usuário ativo do RPCS3 e o dev_hdd0 do vfs.yml", () => {
    const exe = join("C:", "Emuladores", "RPCS3", "rpcs3.exe")
    const root = join("C:", "Emuladores", "RPCS3")
    const files = (map: Record<string, string>) => (path: string) => map[path] ?? null
    expect(findTrophyDir(exe, files({}))).toBe(join(root, "dev_hdd0", "home", "00000001", "trophy"))

    const settings = join(root, "GuiConfigs", "persistent_settings.dat")
    const vfs = join(root, "config", "vfs.yml")
    expect(
      findTrophyDir(exe, files({ [settings]: "[Playtime]\nBLUS30100=60000\n\n[Users]\nactive_user=00000002\n" }))
    ).toBe(join(root, "dev_hdd0", "home", "00000002", "trophy"))
    expect(findTrophyDir(exe, files({ [vfs]: '$(EmulatorDir): ""\n/dev_hdd0/: D:/PS3/hdd0/\n' }))).toBe(
      join("D:/PS3/hdd0/", "home", "00000001", "trophy")
    )
    expect(findTrophyDir(exe, files({ [vfs]: '$(EmulatorDir): ""\n/dev_hdd0/: $(EmulatorDir)outro_hdd0/\n' }))).toBe(
      join(root, "outro_hdd0", "home", "00000001", "trophy")
    )
  })

  it("o conjunto de troféus de um jogo: na pasta do jogo e na ISO (PS3_GAME/TROPDIR)", () => {
    const dir = makeTempDir({
      [`Pasta/PS3_GAME/TROPDIR/${SET}/TROPHY.TRP`]: "trp",
      "Pasta/PS3_GAME/USRDIR/EBOOT.BIN": "",
    })
    expect(readPs3TrophySets(join(dir, "Pasta", "PS3_GAME", "USRDIR", "EBOOT.BIN"))).toEqual([SET])

    const iso = join(dir, "Manobras Radicais 3 (USA).iso")
    writeFileSync(
      iso,
      buildIso([
        { path: ["PS3_GAME", "PARAM.SFO"], content: buildParamSfo({ TITLE_ID: "BLUS30100", TITLE: "Manobras Radicais 3" }) },
        { path: ["PS3_GAME", "TROPDIR", SET, "TROPHY.TRP"], content: Buffer.from("trp") },
      ])
    )
    expect(readPs3TrophySets(iso)).toEqual([SET])
    // Disco sem troféus, ou que não é de PS3: nada.
    writeFileSync(join(dir, "Outro.iso"), buildIso([{ path: ["SYSTEM.CNF"], content: Buffer.from("BOOT2 = cdrom0:\\SLUS_201.00;1") }]))
    expect(readPs3TrophySets(join(dir, "Outro.iso"))).toEqual([])
    expect(readPs3TrophySets(join(dir, "não existe.iso"))).toEqual([])
  })
})

describe("ler os troféus do RPCS3", () => {
  /** Um RPCS3 de mentira com o conjunto de troféus instalado e um jogo de PS3 na biblioteca. */
  function setup(romPath?: string) {
    const db = memoryDatabase()
    const trophyDir = makeTempDir()
    const setDir = join(trophyDir, SET)
    mkdirSync(setDir, { recursive: true })
    writeFileSync(join(setDir, "TROPCONF.SFM"), CONF)
    for (const trophy of TROPHIES) writeFileSync(join(setDir, `TROP${String(trophy.id).padStart(3, "0")}.PNG`), `imagem ${trophy.id}`)
    const games = makeTempDir({ [`Manobras/PS3_GAME/TROPDIR/${SET}/TROPHY.TRP`]: "", "Manobras/PS3_GAME/USRDIR/EBOOT.BIN": "" })
    const gameId = addEmulatedGame(db, {
      title: "Manobras Radicais 3",
      romPath: romPath ?? join(games, "Manobras", "PS3_GAME", "USRDIR", "EBOOT.BIN"),
      platform: "PlayStation 3",
      library: "RPCS3",
      emulatorId: "rpcs3",
      core: null,
    }) as number
    const imagesDir = makeTempDir()
    const services = { trophyDir, imagesDir, copyIcon: copyFileSync, readGameSets: readPs3TrophySets }
    let version = 0
    /** Grava o que foi pego (mudando a data do arquivo, como quando o RPCS3 grava de novo). */
    const writeUnlocks = (unlocked: Record<number, Date>) => {
      const file = join(setDir, "TROPUSR.DAT")
      writeFileSync(file, buildTropUsr(TROPHIES.length, unlocked))
      const time = new Date(Date.now() + ++version * 5000)
      utimesSync(file, time, time)
    }
    return { db, gameId, services, imagesDir, writeUnlocks }
  }

  it("primeira leitura: liga o jogo pelo disco, guarda os troféus e as imagens, sem aviso", () => {
    const { db, gameId, services, imagesDir, writeUnlocks } = setup()
    const now = new Date()
    writeUnlocks({ 1: new Date(now.getTime() - 3 * DAY), 2: new Date(now.getTime() - DAY) })

    expect(syncTrophies(db, services, now)).toEqual({ changed: true, newlyUnlocked: [] })
    expect(listGames(db).find((game) => game.id === gameId)?.achievements).toEqual({
      unlocked: 2,
      total: 5,
      platinum: false,
      source: "rpcs3",
    })
    expect(readdirSync(join(imagesDir, "trophies", SET)).sort()).toEqual(["0.png", "1.png", "2.png", "3.png", "4.png"])

    const trophies = getGameAchievements(db, gameId, { ...NO_IMAGES, trophyIcon: (set, id) => `${set}/${id}` })
    expect(trophies).toMatchObject({ source: "rpcs3", sourceTitle: "Manobras Radicais 3", unlocked: 2, total: 5, points: null })
    expect(trophies?.byGrade).toEqual({
      platina: { unlocked: 0, total: 1 },
      ouro: { unlocked: 0, total: 1 },
      prata: { unlocked: 1, total: 1 },
      bronze: { unlocked: 1, total: 2 },
    })
    expect(trophies?.achievements[3]).toMatchObject({ grade: "ouro", hidden: true, earnedAt: null, badgeUrl: `${SET}/3`, rarity: null })
    expect(trophies?.achievements[4]).toMatchObject({ group: "Pacote Montanha & Neve", key: `${SET}-4` })
  })

  it("depois: só relê o que mudou, e os troféus novos viram aviso (com a platina)", () => {
    const { db, gameId, services, writeUnlocks } = setup()
    const now = new Date()
    writeUnlocks({ 1: new Date(now.getTime() - 3 * DAY), 2: new Date(now.getTime() - DAY) })
    syncTrophies(db, services, now)
    expect(syncTrophies(db, services, now)).toEqual({ changed: false, newlyUnlocked: [] })

    // O jogo principal completo: o RPCS3 dá a platina junto (o pacote extra não conta).
    writeUnlocks({ 0: now, 1: new Date(now.getTime() - 3 * DAY), 2: new Date(now.getTime() - DAY), 3: now })
    const result = syncTrophies(db, services, now)
    expect(result.changed).toBe(true)
    expect(result.newlyUnlocked).toEqual([
      { setId: SET, id: 0 },
      { setId: SET, id: 3 },
    ])
    expect(listGames(db).find((game) => game.id === gameId)?.achievements).toEqual({
      unlocked: 4,
      total: 5,
      platinum: true,
      source: "rpcs3",
    })
  })

  it("sem o disco para ler, liga pelo nome do jogo no conjunto instalado", () => {
    const { db, gameId, services, writeUnlocks } = setup(join("D:", "Jogos", "PS3", "Manobras Radicais 3 (USA).iso"))
    writeUnlocks({})
    syncTrophies(db, services)
    expect(listGames(db).find((game) => game.id === gameId)?.achievements).toMatchObject({ unlocked: 0, total: 5 })
  })

  it("a aba junta as conquistas do RetroAchievements e os troféus do PS3", () => {
    const { db, services, writeUnlocks } = setup()
    const now = new Date(2026, 8, 24, 12, 0)
    writeUnlocks({ 1: new Date(2026, 8, 23, 20, 0), 2: new Date(2026, 8, 24, 9, 0) })
    syncTrophies(db, services, now)
    // Um jogo do RetroAchievements, com uma conquista pega no meio das duas dos troféus.
    const raGame = addEmulatedGame(db, {
      title: "Salto Estelar",
      romPath: join("D:", "Jogos", "Salto Estelar.iso"),
      platform: "PlayStation 2",
      library: "PCSX2",
      emulatorId: "pcsx2",
      core: null,
    }) as number
    db.prepare("UPDATE games SET ra_game_id = 77 WHERE id = ?").run(raGame)
    saveGameProgress(
      db,
      {
        id: 77,
        title: "Salto Estelar",
        numDistinctPlayers: 10,
        achievements: [
          { id: 1, title: "Primeiro salto", description: "", points: 5, badgeName: null, displayOrder: 1, numAwarded: 9, earnedAt: new Date(2026, 8, 24, 8, 0).toISOString(), earnedHardcoreAt: null },
          { id: 2, title: "Salto final", description: "", points: 10, badgeName: null, displayOrder: 2, numAwarded: 1, earnedAt: null, earnedHardcoreAt: null },
        ],
      },
      now
    )

    const overview = getOverview(db, NO_IMAGES, now)
    expect(overview).toMatchObject({ unlocked: 3, total: 7, points: 5, platinums: 0 })
    expect(overview.games.map((game) => [game.title, game.source])).toEqual([
      ["Manobras Radicais 3", "rpcs3"],
      ["Salto Estelar", "retroachievements"],
    ])
    expect(overview.games[0].byGrade).toEqual({
      platina: { unlocked: 0, total: 1 },
      ouro: { unlocked: 0, total: 1 },
      prata: { unlocked: 1, total: 1 },
      bronze: { unlocked: 1, total: 2 },
    })
    expect(overview.recent.map((item) => item.key)).toEqual([`${SET}-2`, "ra-1", `${SET}-1`])
    expect(overview.byDay.at(-1)).toEqual({ date: "2026-09-24", count: 2 })
  })
})
