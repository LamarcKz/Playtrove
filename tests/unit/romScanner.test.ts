import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { setEmulatorPath } from "../../src/main/emulators"
import { getStatusRules, listGames } from "../../src/main/library"
import {
  addRomFolder,
  findPs3Games,
  findRoms,
  listRomFolders,
  removeRomFolder,
  scanRomFolders,
  titleForRom,
  titleFromFileName,
} from "../../src/main/romScanner"
import { buildParamSfo } from "../fakeDiscs"
import { makeTempDir, memoryDatabase, removeTempDirs } from "./helpers"

afterEach(removeTempDirs)

/** Nomes dos arquivos encontrados, com "/" (para comparar igual em qualquer sistema). */
const relative = (root: string, paths: string[]) => paths.map((path) => path.slice(root.length + 1).replaceAll("\\", "/"))

describe("titleFromFileName", () => {
  it("tira a extensão e as etiquetas do padrão Redump/No-Intro", () => {
    expect(titleFromFileName("Pista Real 4 (Europe, Australia) (En,Fr,De,Es,It).iso")).toBe("Pista Real 4")
    expect(titleFromFileName("Salto Estelar (USA) (En,Ja,Fr,De,Es,It,Ko).iso")).toBe("Salto Estelar")
    expect(titleFromFileName("Criaturas Lendárias - Edição Fogo (USA, Europe).zip")).toBe("Criaturas Lendárias - Edição Fogo")
    expect(titleFromFileName("Corrida Noturna - Edição Turbo (USA) [SLUS-20100].iso")).toBe(
      "Corrida Noturna - Edição Turbo"
    )
    expect(titleFromFileName("Cidade Neon (USA).cue")).toBe("Cidade Neon")
  })
  it("mantém o número do disco", () => {
    expect(titleFromFileName("Lenda Sombria VII (USA) (Disc 2).cue")).toBe("Lenda Sombria VII (Disc 2)")
  })
  it("troca _ por espaço e, se sobrar nada, usa o nome do arquivo", () => {
    expect(titleFromFileName("super_mario_world.sfc")).toBe("super mario world")
    expect(titleFromFileName("(USA).iso")).toBe("(USA)")
  })
})

describe("findRoms", () => {
  it("acha as ROMs nas subpastas e ignora outras extensões (sem diferenciar maiúsculas)", () => {
    const root = makeTempDir(["Salto Estelar.iso", "CL4/CORRIDA LUNAR 4.ISO", "leia-me.txt", "capa.jpg"])
    expect(relative(root, findRoms(root, ["iso"]))).toEqual(["CL4/CORRIDA LUNAR 4.ISO", "Salto Estelar.iso"])
  })
  it("jogos de PS1: fica só o .cue quando há .bin na mesma pasta", () => {
    const root = makeTempDir([
      "Cidade Neon/Cidade Neon (USA).cue",
      "Cidade Neon/Cidade Neon (USA) (Track 1).bin",
      "Cidade Neon/Cidade Neon (USA) (Track 2).bin",
      "Avulso/Jogo sem cue.bin",
    ])
    expect(relative(root, findRoms(root, ["cue", "bin"]))).toEqual(["Avulso/Jogo sem cue.bin", "Cidade Neon/Cidade Neon (USA).cue"])
  })
  it("desce até 4 subpastas", () => {
    const root = makeTempDir(["a/b/c/d/ok.iso", "a/b/c/d/e/fundo-demais.iso"])
    expect(relative(root, findRoms(root, ["iso"]))).toEqual(["a/b/c/d/ok.iso"])
  })
})

describe("pastas de ROMs", () => {
  it("valida a pasta antes de adicionar", () => {
    const db = memoryDatabase()
    const root = makeTempDir()
    expect(() => addRomFolder(db, { path: join(root, "nao-existe"), emulatorId: "pcsx2", core: null, platform: "PS2" })).toThrow(
      "Essa pasta não existe"
    )
    expect(() => addRomFolder(db, { path: root, emulatorId: "retroarch", core: null, platform: "GBA" })).toThrow("core")
    expect(() => addRomFolder(db, { path: root, emulatorId: "pcsx2", core: null, platform: "  " })).toThrow("console")
    expect(() => addRomFolder(db, { path: root, emulatorId: "xyz" as "pcsx2", core: null, platform: "PS2" })).toThrow(
      "Escolha um emulador"
    )
    addRomFolder(db, { path: root, emulatorId: "pcsx2", core: "ignorado", platform: " PlayStation 2 " })
    expect(listRomFolders(db)).toEqual([{ id: 1, path: root, emulatorId: "pcsx2", core: null, platform: "PlayStation 2" }])
    expect(() => addRomFolder(db, { path: root, emulatorId: "pcsx2", core: null, platform: "PS2" })).toThrow("já está na lista")
  })

  it("procurar coloca os jogos novos na biblioteca, e procurar de novo não duplica", () => {
    const db = memoryDatabase()
    const root = makeTempDir(["Salto Estelar (USA).iso", "Pista Real 4 (Europe).iso"])
    const folder = addRomFolder(db, { path: root, emulatorId: "pcsx2", core: null, platform: "PlayStation 2" })

    expect(scanRomFolders(db)).toEqual({ added: ["Pista Real 4", "Salto Estelar"], addedIds: [1, 2], alreadyInLibrary: 0, errors: [] })
    const games = listGames(db)
    expect(games.map((game) => game.title)).toEqual(["Pista Real 4", "Salto Estelar"])
    expect(games[0]).toMatchObject({
      platform: "PlayStation 2",
      library: "PCSX2",
      emulatorId: "pcsx2",
      romPath: join(root, "Pista Real 4 (Europe).iso"),
      statusId: getStatusRules(db).newGameStatusId,
      playtimeMinutes: 0,
      lastPlayedAt: null,
    })

    expect(scanRomFolders(db, [folder.id])).toEqual({ added: [], addedIds: [], alreadyInLibrary: 2, errors: [] })
    expect(listGames(db)).toHaveLength(2)
  })

  it("tirar a pasta não tira os jogos; pasta apagada do disco vira aviso", () => {
    const db = memoryDatabase()
    const root = makeTempDir(["Salto Estelar.iso"])
    const folder = addRomFolder(db, { path: root, emulatorId: "pcsx2", core: null, platform: "PlayStation 2" })
    scanRomFolders(db)

    rmSync(root, { recursive: true, force: true })
    expect(scanRomFolders(db).errors).toEqual([`A pasta ${root} não existe mais.`])

    removeRomFolder(db, folder.id)
    expect(listRomFolders(db)).toEqual([])
    expect(listGames(db)).toHaveLength(1)
  })

  it("RetroArch: usa as extensões do core da pasta (mais .zip e .7z)", () => {
    const db = memoryDatabase()
    const retroarch = makeTempDir({
      "retroarch.exe": "",
      "cores/mgba_libretro.dll": "",
      "info/mgba_libretro.info": 'display_name = "Nintendo - Game Boy Advance (mGBA)"\nsupported_extensions = "gb|gbc|gba"\n',
    })
    setEmulatorPath(db, "retroarch", join(retroarch, "retroarch.exe"))
    const roms = makeTempDir(["Criaturas Lendárias - Edição Fogo (USA, Europe).zip", "Runas de Ouro.gba", "Jogo de PS2.iso"])
    addRomFolder(db, { path: roms, emulatorId: "retroarch", core: "mgba_libretro", platform: "Game Boy Advance" })

    expect(scanRomFolders(db).added).toEqual(["Criaturas Lendárias - Edição Fogo", "Runas de Ouro"])
    expect(listGames(db)[0]).toMatchObject({ library: "RetroArch", emulatorId: "retroarch", platform: "Game Boy Advance" })
  })

  it("RetroArch: core que não está instalado vira aviso", () => {
    const db = memoryDatabase()
    const roms = makeTempDir(["Runas de Ouro.gba"])
    addRomFolder(db, { path: roms, emulatorId: "retroarch", core: "mgba_libretro", platform: "Game Boy Advance" })
    const result = scanRomFolders(db)
    expect(result.added).toEqual([])
    expect(result.errors[0]).toContain("O core mgba_libretro não foi encontrado")
  })
})

describe("jogos de PS3 (RPCS3)", () => {
  it("acha as ISOs e as pastas de jogo, e o nome vem do disco", () => {
    const root = makeTempDir({
      "Manobras Radicais 3 (USA).iso": "",
      "Jogo Extraído [BLUS12345]/PS3_GAME/USRDIR/EBOOT.BIN": "",
      "Jogo Extraído [BLUS12345]/PS3_GAME/ICON0.PNG": "",
      "Outra pasta/leia-me.txt": "",
    })
    writeFileSync(
      join(root, "Jogo Extraído [BLUS12345]", "PS3_GAME", "PARAM.SFO"),
      buildParamSfo({ TITLE_ID: "BLUS12345", TITLE: "Jogo de Verdade" })
    )

    const games = findPs3Games(root)
    expect(relative(root, games)).toEqual(["Jogo Extraído [BLUS12345]/PS3_GAME/USRDIR/EBOOT.BIN", "Manobras Radicais 3 (USA).iso"])
    expect(titleForRom(games[0])).toBe("Jogo de Verdade")
    expect(titleForRom(games[1])).toBe("Manobras Radicais 3")
  })

  it("a varredura usa esses jogos e os coloca na biblioteca como PlayStation 3", () => {
    const db = memoryDatabase()
    const root = makeTempDir({ "Manobras Radicais 3 (USA).iso": "", "Corrida Lunar 5/PS3_GAME/USRDIR/EBOOT.BIN": "" })
    addRomFolder(db, { path: root, emulatorId: "rpcs3", core: null, platform: "PlayStation 3" })

    expect(scanRomFolders(db).added).toEqual(["Corrida Lunar 5", "Manobras Radicais 3"])
    expect(listGames(db)[0]).toMatchObject({ library: "RPCS3", emulatorId: "rpcs3", platform: "PlayStation 3" })
  })
})
