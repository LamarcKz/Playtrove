import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { suggestFolderSetup } from "@shared/romFolders"
import type { RetroArchCore } from "@shared/types"
import {
  buildLaunchCommand,
  detectEmulators,
  fillMissingEmulators,
  getEmulatorPaths,
  listEmulators,
  listRetroArchCores,
  parseCoreInfo,
  romExtensions,
  setEmulatorPath,
  type DetectionSources,
} from "../../src/main/emulators"
import { makeTempDir, memoryDatabase, removeTempDirs } from "./helpers"

afterEach(removeTempDirs)

const PCSX2 = "C:\\Emuladores\\PCSX2\\pcsx2-qt.exe"
const PCSX2_ANTIGO = "C:\\Emuladores\\PCSX2-v2.9\\pcsx2-qt.exe"
const DUCKSTATION = "C:\\Emuladores\\DuckStation\\duckstation-qt-x64-ReleaseLTCG.exe"
const RETROARCH = "C:\\RetroArch-Win64\\retroarch.exe"

/** Um computador de mentira: atalhos, para onde eles apontam e os arquivos que existem. */
function fakeSources(shortcuts: Record<string, string>, files: string[]): DetectionSources {
  const existing = new Set(files)
  /** As pastas do computador de mentira, montadas a partir dos caminhos dos arquivos. */
  const folders = new Map<string, Map<string, boolean>>()
  const add = (folder: string, name: string, isDirectory: boolean) => {
    const key = folder.toLowerCase()
    if (!folders.has(key)) folders.set(key, new Map())
    folders.get(key)?.set(name, isDirectory)
  }
  for (const file of files) {
    const parts = file.split("\\")
    for (let index = parts.length - 1; index > 0; index--) {
      add(parts.slice(0, index).join("\\"), parts[index], index < parts.length - 1)
    }
  }

  return {
    shortcuts: () => Object.keys(shortcuts),
    readShortcut: (path) => shortcuts[path] ?? null,
    exists: (path) => existing.has(path),
    listDir: (path) =>
      [...(folders.get(path.toLowerCase()) ?? new Map<string, boolean>())].map(([name, isDirectory]) => ({ name, isDirectory })),
    env: {
      ProgramFiles: "C:\\Program Files",
      LOCALAPPDATA: "C:\\Users\\teste\\AppData\\Local",
      USERPROFILE: "C:\\Users\\teste",
    },
  }
}

describe("detecção dos emuladores", () => {
  it("acha pelos atalhos (ignorando atalhos quebrados) e pelos lugares comuns", () => {
    const sources = fakeSources(
      {
        "Menu/PCSX2 antigo.lnk": PCSX2_ANTIGO, // atalho quebrado: o executável não existe mais
        "Menu/PCSX2.lnk": PCSX2,
        "Desktop/DuckStation.lnk": DUCKSTATION,
        "Desktop/Discord.lnk": "C:\\Discord\\Discord.exe",
      },
      [PCSX2, DUCKSTATION, RETROARCH, "C:\\Discord\\Discord.exe"]
    )
    expect(detectEmulators(sources)).toEqual({ pcsx2: PCSX2, duckstation: DUCKSTATION, retroarch: RETROARCH })
  })

  it("não acha o que não existe", () => {
    expect(detectEmulators(fakeSources({ "Menu/PCSX2.lnk": PCSX2 }, []))).toEqual({})
  })

  it("acha um emulador portátil na pasta vizinha de outro, sem atalho nenhum", () => {
    const pcsx2 = "C:\\Jogos\\Emuladores\\PCSX2\\pcsx2-v2.8\\pcsx2-qt.exe"
    const rpcs3 = "C:\\Jogos\\Emuladores\\RPCS3\\rpcs3-v0.0.42\\rpcs3.exe"
    const sources = fakeSources({ "Menu/PCSX2.lnk": pcsx2 }, [pcsx2, rpcs3, "C:\\Jogos\\Emuladores\\leia-me.txt"])

    expect(detectEmulators(sources)).toEqual({ pcsx2, rpcs3 })
  })

  it("não vasculha pastas largas demais (Arquivos de Programas, pasta do usuário, raiz do disco)", () => {
    const pcsx2 = "C:\\Program Files\\PCSX2\\pcsx2-qt.exe"
    const rpcs3 = "C:\\Program Files\\Emuladores\\RPCS3\\rpcs3.exe"
    const sources = fakeSources({ "Menu/PCSX2.lnk": pcsx2 }, [pcsx2, rpcs3])

    expect(detectEmulators(sources)).toEqual({ pcsx2 })
  })

  it("preenche só os emuladores que ainda não funcionam", () => {
    const db = memoryDatabase()
    const escolhido = "D:\\Meu PCSX2\\pcsx2-qt.exe"
    setEmulatorPath(db, "pcsx2", escolhido) // escolhido pelo usuário: continua
    setEmulatorPath(db, "duckstation", "D:\\apagado\\duckstation-qt.exe") // não existe mais: troca
    const sources = fakeSources({ "Menu/PCSX2.lnk": PCSX2, "Menu/DuckStation.lnk": DUCKSTATION }, [escolhido, PCSX2, DUCKSTATION])

    fillMissingEmulators(db, sources)

    expect(getEmulatorPaths(db)).toEqual({ pcsx2: escolhido, duckstation: DUCKSTATION })
    expect(listEmulators(db, sources.exists).map((emulator) => [emulator.id, emulator.found])).toEqual([
      ["pcsx2", true],
      ["duckstation", true],
      ["retroarch", false],
      ["rpcs3", false],
    ])
  })
})

describe("RetroArch", () => {
  it("lê os arquivos .info dos cores", () => {
    const info = parseCoreInfo(
      '# comentário\r\ndisplay_name = "Nintendo - Game Boy Advance (mGBA)"\r\nsupported_extensions = "gb|gbc|gba"\r\nsystemname = "Game Boy Advance"\r\n'
    )
    expect(info).toMatchObject({
      display_name: "Nintendo - Game Boy Advance (mGBA)",
      supported_extensions: "gb|gbc|gba",
      systemname: "Game Boy Advance",
    })
  })

  it("lista os cores instalados; core sem .info fica com o nome do arquivo", () => {
    const root = makeTempDir({
      "retroarch.exe": "",
      "cores/mgba_libretro.dll": "",
      "cores/desmume_libretro.dll": "",
      "cores/leia-me.txt": "",
      "info/mgba_libretro.info":
        'display_name = "Nintendo - Game Boy Advance (mGBA)"\nsupported_extensions = "GB|gbc|gba"\nsystemname = "Game Boy Advance"\n',
    })
    expect(listRetroArchCores(join(root, "retroarch.exe"))).toEqual([
      { id: "desmume_libretro", name: "desmume_libretro", system: "", extensions: [] },
      { id: "mgba_libretro", name: "Nintendo - Game Boy Advance (mGBA)", system: "Game Boy Advance", extensions: ["gb", "gbc", "gba"] },
    ])
    expect(listRetroArchCores(join(makeTempDir(), "retroarch.exe"))).toEqual([])
  })

  it("extensões aceitas: as do emulador, ou as do core mais .zip e .7z", () => {
    expect(romExtensions("pcsx2", null)).toContain("iso")
    expect(romExtensions("duckstation", null)).toContain("cue")
    const core: RetroArchCore = { id: "mgba_libretro", name: "mGBA", system: "GBA", extensions: ["gba", "zip"] }
    expect(romExtensions("retroarch", core)).toEqual(["gba", "zip", "7z"])
  })
})

describe("comando para abrir um jogo", () => {
  it("PCSX2 e DuckStation fecham junto com o jogo (-batch), sem forçar tela cheia", () => {
    expect(buildLaunchCommand("pcsx2", PCSX2, "D:\\PS2\\Salto Estelar.iso", null)).toEqual({
      command: PCSX2,
      args: ["-batch", "--", "D:\\PS2\\Salto Estelar.iso"],
    })
    expect(buildLaunchCommand("duckstation", DUCKSTATION, "D:\\PS1\\Cidade Neon.cue", null)).toEqual({
      command: DUCKSTATION,
      args: ["-batch", "--", "D:\\PS1\\Cidade Neon.cue"],
    })
  })
  it("RPCS3 abre só o jogo (--no-gui) e aceita ISO e pasta de jogo", () => {
    const rpcs3 = "C:\\Emuladores\\RPCS3\\rpcs3.exe"
    expect(buildLaunchCommand("rpcs3", rpcs3, "D:\\PS3\\Manobras Radicais 3.iso", null)).toEqual({
      command: rpcs3,
      args: ["--no-gui", "D:\\PS3\\Manobras Radicais 3.iso"],
    })
    expect(romExtensions("rpcs3", null)).toEqual(["iso"])
  })

  it("RetroArch recebe o core da pasta dele", () => {
    expect(buildLaunchCommand("retroarch", RETROARCH, "D:\\GBA\\Runas de Ouro.gba", "mgba_libretro")).toEqual({
      command: RETROARCH,
      args: ["-L", join("C:\\RetroArch-Win64", "cores", "mgba_libretro.dll"), "D:\\GBA\\Runas de Ouro.gba"],
    })
  })
})

describe("sugestão para uma pasta nova (pelo nome dela)", () => {
  const cores = [
    { id: "desmume_libretro", name: "DeSmuME", system: "Nintendo DS", extensions: ["nds"] },
    { id: "mgba_libretro", name: "mGBA", system: "Game Boy Advance", extensions: ["gba"] },
  ]

  it("consoles conhecidos", () => {
    expect(suggestFolderSetup("PS2", cores)).toEqual({ emulatorId: "pcsx2", core: null, platform: "PlayStation 2" })
    expect(suggestFolderSetup("psx", cores)).toEqual({ emulatorId: "duckstation", core: null, platform: "PlayStation" })
    expect(suggestFolderSetup("PS1", cores)).toEqual({ emulatorId: "duckstation", core: null, platform: "PlayStation" })
    expect(suggestFolderSetup("GBA", cores)).toEqual({ emulatorId: "retroarch", core: "mgba_libretro", platform: "Game Boy Advance" })
    expect(suggestFolderSetup(" DS ", cores)).toEqual({ emulatorId: "retroarch", core: "desmume_libretro", platform: "Nintendo DS" })
  })
  it("prefere o melhor core instalado", () => {
    const withMelon = [...cores, { id: "melonds_libretro", name: "melonDS", system: "Nintendo DS", extensions: ["nds"] }]
    expect(suggestFolderSetup("NDS", withMelon).core).toBe("melonds_libretro")
  })
  it("nome desconhecido: RetroArch, o primeiro core e o nome da pasta", () => {
    expect(suggestFolderSetup("Jogos de Luta", cores)).toEqual({ emulatorId: "retroarch", core: "desmume_libretro", platform: "Jogos de Luta" })
    expect(suggestFolderSetup("Jogos de Luta", [])).toEqual({ emulatorId: "retroarch", core: null, platform: "Jogos de Luta" })
  })
})
