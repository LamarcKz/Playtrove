import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parseParamSfo, ps3GameFolder, readDiscSerial, readPs3Title, serialFromSystemCnf } from "../../src/main/discs"
import { buildIso, buildParamSfo, toRawBin } from "../fakeDiscs"
import { makeTempDir, removeTempDirs } from "./helpers"

afterEach(removeTempDirs)

describe("código do jogo no SYSTEM.CNF", () => {
  it("lê o código de PS2 e de PS1 e ignora o resto", () => {
    expect(serialFromSystemCnf("BOOT2 = cdrom0:\\SLUS_201.00;1\nVER = 1.00\nVMODE = NTSC")).toBe("SLUS-20100")
    expect(serialFromSystemCnf("BOOT = cdrom:\\SLUS_001.00;1\nTCB = 4\nEVENT = 10")).toBe("SLUS-00100")
    expect(serialFromSystemCnf("BOOT2 = cdrom0:\\SCES_511.00;1")).toBe("SCES-51100")
    expect(serialFromSystemCnf("nada aqui")).toBeNull()
  })
})

describe("ler o disco", () => {
  it("ISO de PS2: o código vem do SYSTEM.CNF", () => {
    const dir = makeTempDir()
    const iso = join(dir, "Jogo (USA).iso")
    writeFileSync(iso, buildIso([{ path: ["SYSTEM.CNF"], content: Buffer.from("BOOT2 = cdrom0:\\SLUS_201.00;1\r\n", "latin1") }]))
    expect(readDiscSerial(iso)).toBe("SLUS-20100")
  })

  it("BIN/CUE de PS1 (setores de 2352 bytes)", () => {
    const dir = makeTempDir()
    const disc = buildIso([{ path: ["SYSTEM.CNF"], content: Buffer.from("BOOT = cdrom:\\SLUS_002.00;1\r\n", "latin1") }])
    writeFileSync(join(dir, "Jogo (USA).bin"), toRawBin(disc, 2))
    writeFileSync(join(dir, "Jogo (USA).cue"), 'FILE "Jogo (USA).bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n')
    expect(readDiscSerial(join(dir, "Jogo (USA).cue"))).toBe("SLUS-00200")
    expect(readDiscSerial(join(dir, "Jogo (USA).bin"))).toBe("SLUS-00200")
  })

  it("ISO de PS3: o código vem do PARAM.SFO", () => {
    const dir = makeTempDir()
    const iso = join(dir, "Manobras Radicais 3 (USA).iso")
    const sfo = buildParamSfo({ TITLE_ID: "BLUS30100", TITLE: "Manobras Radicais 3" })
    writeFileSync(iso, buildIso([{ path: ["PS3_GAME", "PARAM.SFO"], content: sfo }]))
    expect(readDiscSerial(iso)).toBe("BLUS30100")
  })

  it("pasta de jogo de PS3 (EBOOT.BIN): código e nome vêm do PARAM.SFO", () => {
    const dir = makeTempDir({ "Manobras Radicais 3 [BLUS30100]/PS3_GAME/USRDIR/EBOOT.BIN": "" })
    const game = join(dir, "Manobras Radicais 3 [BLUS30100]")
    writeFileSync(join(game, "PS3_GAME", "PARAM.SFO"), buildParamSfo({ TITLE_ID: "BLUS30100", TITLE: "Manobras Radicais 3" }))
    const eboot = join(game, "PS3_GAME", "USRDIR", "EBOOT.BIN")

    expect(ps3GameFolder(eboot)).toBe(game)
    expect(ps3GameFolder(join(dir, "outro.iso"))).toBeNull()
    expect(readDiscSerial(eboot)).toBe("BLUS30100")
    expect(readPs3Title(eboot)).toBe("Manobras Radicais 3")
  })

  it("formatos que o app não abre (comprimidos) e arquivos estranhos não quebram", () => {
    const dir = makeTempDir({ "Jogo.chd": "qualquer coisa", "Jogo.iso": "isto não é um disco" })
    expect(readDiscSerial(join(dir, "Jogo.chd"))).toBeNull()
    expect(readDiscSerial(join(dir, "Jogo.iso"))).toBeNull()
    expect(readDiscSerial(join(dir, "não existe.iso"))).toBeNull()
  })

  it("PARAM.SFO: textos e números", () => {
    const sfo = parseParamSfo(buildParamSfo({ TITLE_ID: "BLUS30100", TITLE: "Manobras Radicais 3" }))
    expect(sfo).toMatchObject({ TITLE_ID: "BLUS30100", TITLE: "Manobras Radicais 3" })
  })
})
