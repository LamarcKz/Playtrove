import { describe, expect, it } from "vitest"
import { suggestFolderSetup } from "@shared/romFolders"

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
  it("PSP, GameCube, Wii e 3DS vão para o PPSSPP, o Dolphin e o Azahar", () => {
    expect(suggestFolderSetup("PSP", cores)).toEqual({ emulatorId: "ppsspp", core: null, platform: "PlayStation Portable" })
    expect(suggestFolderSetup("GameCube", cores)).toEqual({ emulatorId: "dolphin", core: null, platform: "GameCube" })
    expect(suggestFolderSetup("GC", cores)).toEqual({ emulatorId: "dolphin", core: null, platform: "GameCube" })
    expect(suggestFolderSetup("Wii", cores)).toEqual({ emulatorId: "dolphin", core: null, platform: "Wii" })
    expect(suggestFolderSetup("3DS", cores)).toEqual({ emulatorId: "azahar", core: null, platform: "Nintendo 3DS" })
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
