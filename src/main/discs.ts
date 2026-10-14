import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import { isTrophySetId } from "./achievements/trophyFiles"

/**
 * Leitura dos discos dos jogos (só o necessário, sem carregar o arquivo inteiro): o código do jogo
 * (ex.: SLUS-20100), que é como o PCSX2, o DuckStation e o RPCS3 identificam cada jogo nos
 * registros de tempo jogado, o nome dos jogos de PS3 e os conjuntos de troféus deles.
 */

/** Setor lógico de um CD/DVD (ISO 9660). */
const SECTOR = 2048

/** Um disco aberto: lê setores lógicos de 2048 bytes. */
interface DiscImage {
  readSector: (lba: number, count?: number) => Buffer
  close: () => void
}

/** Formatos de GameCube e Wii que o Dolphin abre e que têm o código do jogo legível (as ISOs também). */
const GAMECUBE_WII_FILES = new Set([".gcm", ".rvz", ".wia", ".wbfs", ".ciso"])
/** Formatos de 3DS com o cabeçalho NCSD ou NCCH (os comprimidos, .zcci e afins, ficam de fora). */
const NINTENDO_3DS_FILES = new Set([".3ds", ".cci", ".cxi", ".app"])

/**
 * O código do jogo no disco, que é como os emuladores identificam cada jogo nos registros de tempo:
 * - PS1 e PS2: do arquivo SYSTEM.CNF (BOOT = cdrom:\SLUS_001.00;1 → SLUS-00100);
 * - PS3: do PARAM.SFO (TITLE_ID, ex.: BLUS30100), na ISO ou na pasta do jogo (EBOOT.BIN);
 * - PSP: do PARAM.SFO (DISC_ID, ex.: ULUS10041), na ISO (PSP_GAME/PARAM.SFO) ou no EBOOT.PBP;
 * - GameCube e Wii: os 6 primeiros caracteres do disco (ex.: GALE01), na ISO e no RVZ, WIA, WBFS e CISO;
 * - 3DS: o id do programa, em hexadecimal (ex.: 0004000000055D00), no .3ds/.cci e no .cxi.
 * Devolve null quando não dá para ler (formato comprimido, como CHD e CSO, ou disco estranho).
 */
export function readDiscSerial(romPath: string): string | null {
  try {
    const ps3Folder = ps3GameFolder(romPath)
    if (ps3Folder) {
      const sfo = join(ps3Folder, "PS3_GAME", "PARAM.SFO")
      return existsSync(sfo) ? stringField(parseParamSfo(readFileSync(sfo)), "TITLE_ID") : null
    }
    const extension = extname(romPath).toLowerCase()
    if (extension === ".pbp") return readPbpDiscId(romPath)
    if (NINTENDO_3DS_FILES.has(extension)) return read3dsProgramId(romPath)
    if (GAMECUBE_WII_FILES.has(extension)) return readGameCubeWiiId(romPath)
    const disc = openDiscImage(romPath)
    if (!disc) return null
    try {
      const systemCnf = readIsoFile(disc, ["SYSTEM.CNF"])
      if (systemCnf) return serialFromSystemCnf(systemCnf.toString("latin1"))
      const ps3 = readIsoFile(disc, ["PS3_GAME", "PARAM.SFO"])
      if (ps3) return stringField(parseParamSfo(ps3), "TITLE_ID")
      const psp = readIsoFile(disc, ["PSP_GAME", "PARAM.SFO"])
      if (psp) return stringField(parseParamSfo(psp), "DISC_ID")
    } finally {
      disc.close()
    }
    // As ISOs de GameCube e Wii não são ISO 9660: o código fica logo no começo do disco.
    return extension === ".iso" ? readGameCubeWiiId(romPath) : null
  } catch {
    return null
  }
}

/** O DISC_ID de um jogo de PSP em EBOOT.PBP (o formato dos jogos da PSN): o PARAM.SFO vem dentro dele. */
function readPbpDiscId(romPath: string): string | null {
  const header = readBytes(romPath, 0, 0x28)
  if (header.toString("latin1", 0, 4) !== "\0PBP") return null
  const start = header.readUInt32LE(0x08)
  const end = header.readUInt32LE(0x0c)
  if (end <= start || end - start > 64 * 1024) return null
  return stringField(parseParamSfo(readBytes(romPath, start, end - start)), "DISC_ID")
}

/**
 * O código de um disco de GameCube ou Wii (ex.: GALE01). Cada formato guarda uma cópia do começo do
 * disco num lugar: a ISO, no começo; o RVZ e o WIA, no cabeçalho deles (0x58); o WBFS, depois do
 * primeiro setor dele; e o CISO, depois do mapa de blocos (0x8000). O disco é conferido pela marca
 * do GameCube (0x1C) ou do Wii (0x18).
 */
function readGameCubeWiiId(romPath: string): string | null {
  const start = readBytes(romPath, 0, 0x20)
  const magic = start.toString("latin1", 0, 4)
  const offset =
    magic === "RVZ\x01" || magic === "WIA\x01" ? 0x58 : magic === "WBFS" ? 2 ** start[8] : magic === "CISO" ? 0x8000 : 0
  const header = offset === 0 ? start : readBytes(romPath, offset, 0x20)
  const isGameCube = header.readUInt32BE(0x1c) === 0xc2339f3d
  const isWii = header.readUInt32BE(0x18) === 0x5d1c9ea3
  if (!isGameCube && !isWii) return null
  const id = header.toString("latin1", 0, 6)
  return /^[A-Z0-9]{6}$/.test(id) ? id : null
}

/**
 * O id do programa de um jogo de 3DS, em hexadecimal (ex.: 0004000000055D00): no cabeçalho NCCH, que
 * no .cxi fica no começo e no .3ds/.cci, na primeira partição (a tabela do NCSD diz onde, em blocos
 * de 0x200 bytes).
 */
function read3dsProgramId(romPath: string): string | null {
  const start = readBytes(romPath, 0, 0x200)
  const ncch = start.toString("latin1", 0x100, 0x104) === "NCSD" ? start.readUInt32LE(0x120) * 0x200 : 0
  const header = ncch === 0 ? start : readBytes(romPath, ncch, 0x200)
  if (header.toString("latin1", 0x100, 0x104) !== "NCCH") return null
  const id = header.readBigUInt64LE(0x118)
  return id === 0n ? null : id.toString(16).toUpperCase().padStart(16, "0")
}

/** Lê `length` bytes de um arquivo a partir de `position` (menos, se o arquivo acabar antes). */
function readBytes(path: string, position: number, length: number): Buffer {
  const fd = openSync(path, "r")
  try {
    const buffer = Buffer.alloc(length)
    return buffer.subarray(0, readSync(fd, buffer, 0, length, position))
  } finally {
    closeSync(fd)
  }
}

/** O nome de um jogo de PS3 em pasta (EBOOT.BIN), pelo PARAM.SFO; null se não for um. */
export function readPs3Title(romPath: string): string | null {
  const folder = ps3GameFolder(romPath)
  if (!folder) return null
  try {
    return stringField(parseParamSfo(readFileSync(join(folder, "PS3_GAME", "PARAM.SFO"))), "TITLE")
  } catch {
    return null
  }
}

/**
 * Os conjuntos de troféus de um jogo de PS3 (as pastas de PS3_GAME/TROPDIR, ex.: NPWR01234_00), na
 * ISO ou na pasta do jogo. É assim que o app sabe quais troféus do RPCS3 são de qual jogo.
 */
export function readPs3TrophySets(romPath: string): string[] {
  try {
    const folder = ps3GameFolder(romPath)
    if (folder) {
      const dir = join(folder, "PS3_GAME", "TROPDIR")
      return existsSync(dir) ? readdirSync(dir).map((name) => name.toUpperCase()).filter(isTrophySetId) : []
    }
    if (extname(romPath).toLowerCase() !== ".iso") return []
    const disc = openDiscImage(romPath)
    if (!disc) return []
    try {
      const dir = findIsoEntry(disc, ["PS3_GAME", "TROPDIR"])
      if (!dir?.isDirectory) return []
      return listDirectory(disc, dir)
        .filter((record) => record.isDirectory && isTrophySetId(record.name))
        .map((record) => record.name)
    } finally {
      disc.close()
    }
  } catch {
    return []
  }
}

/** A pasta de um jogo de PS3 extraído, se a ROM for o EBOOT.BIN dele (…/PS3_GAME/USRDIR/EBOOT.BIN). */
export function ps3GameFolder(romPath: string): string | null {
  if (basename(romPath).toUpperCase() !== "EBOOT.BIN") return null
  const usrdir = dirname(romPath)
  const ps3Game = dirname(usrdir)
  if (basename(usrdir).toUpperCase() !== "USRDIR" || basename(ps3Game).toUpperCase() !== "PS3_GAME") return null
  return dirname(ps3Game)
}

/** "BOOT2 = cdrom0:\SLUS_201.00;1" → "SLUS-20100". */
export function serialFromSystemCnf(text: string): string | null {
  const boot = /^\s*BOOT2?\s*=\s*(.+)$/im.exec(text)?.[1]
  if (!boot) return null
  const file = boot
    .trim()
    .split(/[\\/:]/)
    .pop()
    ?.replace(/;\d+$/, "")
  const match = file ? /^([A-Z]{4})[_-]?(\d{3})\.?(\d{2})$/i.exec(file) : null
  return match ? `${match[1].toUpperCase()}-${match[2]}${match[3]}` : null
}

/** Os campos de um PARAM.SFO (arquivo de informações dos jogos de PS3 e PSP). */
export function parseParamSfo(buffer: Buffer): Record<string, string | number> {
  if (buffer.readUInt32LE(0) !== 0x46535000) throw new Error("Não é um PARAM.SFO.")
  const keyTable = buffer.readUInt32LE(8)
  const dataTable = buffer.readUInt32LE(12)
  const entries = buffer.readUInt32LE(16)
  const fields: Record<string, string | number> = {}
  for (let index = 0; index < entries; index++) {
    const base = 20 + index * 16
    const keyStart = keyTable + buffer.readUInt16LE(base)
    const key = buffer.toString("utf8", keyStart, buffer.indexOf(0, keyStart))
    const format = buffer.readUInt16LE(base + 2)
    const length = buffer.readUInt32LE(base + 4)
    const dataStart = dataTable + buffer.readUInt32LE(base + 12)
    fields[key] =
      format === 0x0404
        ? buffer.readUInt32LE(dataStart)
        : buffer.toString("utf8", dataStart, dataStart + length).replace(/\0+$/, "")
  }
  return fields
}

function stringField(fields: Record<string, string | number>, key: string): string | null {
  const value = fields[key]
  return typeof value === "string" && value ? value : null
}

// ---------------------------------------------------------------- imagens de disco

/**
 * Abre uma imagem de disco para leitura dos setores:
 * - .iso: setores de 2048 bytes;
 * - .cue: a primeira faixa do .bin que ele indica (MODE1/2352 ou MODE2/2352);
 * - .bin sozinho: descobre o formato pela marca de sincronismo do setor.
 * Formatos comprimidos (.chd, .cso, .zip...) ficam de fora.
 */
function openDiscImage(romPath: string): DiscImage | null {
  const extension = extname(romPath).toLowerCase()
  if (extension === ".iso") return rawImage(romPath, 2048, 0)
  if (extension === ".cue") {
    const cue = readFileSync(romPath, "latin1")
    const file = /^\s*FILE\s+"([^"]+)"/im.exec(cue)?.[1]
    const mode = /^\s*TRACK\s+\d+\s+(MODE1|MODE2)\/2352/im.exec(cue)?.[1]?.toUpperCase()
    if (!file || !mode) return null
    return rawImage(join(dirname(romPath), file), 2352, mode === "MODE1" ? 16 : 24)
  }
  if (extension === ".bin") {
    const header = Buffer.alloc(16)
    const fd = openSync(romPath, "r")
    readSync(fd, header, 0, 16, 0)
    closeSync(fd)
    const isRaw = header.subarray(0, 12).equals(Buffer.from([0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0]))
    if (!isRaw) return rawImage(romPath, 2048, 0)
    return rawImage(romPath, 2352, header[15] === 1 ? 16 : 24)
  }
  return null
}

/** Uma imagem "crua": cada setor tem `sectorSize` bytes, e os 2048 de dados começam em `dataOffset`. */
function rawImage(path: string, sectorSize: number, dataOffset: number): DiscImage {
  const fd = openSync(path, "r")
  return {
    readSector: (lba, count = 1) => {
      const out = Buffer.alloc(SECTOR * count)
      for (let index = 0; index < count; index++) {
        readSync(fd, out, index * SECTOR, SECTOR, (lba + index) * sectorSize + dataOffset)
      }
      return out
    },
    close: () => closeSync(fd),
  }
}

/** Um registro de diretório do ISO 9660. */
interface DirectoryRecord {
  name: string
  lba: number
  size: number
  isDirectory: boolean
}

/** Lê um arquivo do disco pelo caminho (ex.: ["PS3_GAME", "PARAM.SFO"]); null se ele não existir. */
function readIsoFile(disc: DiscImage, path: string[]): Buffer | null {
  const file = findIsoEntry(disc, path)
  if (!file || file.isDirectory || file.size > 1024 * 1024) return null
  return disc.readSector(file.lba, Math.ceil(file.size / SECTOR)).subarray(0, file.size)
}

/** Acha um arquivo ou pasta do disco pelo caminho; null se não existir (ou se não for ISO 9660). */
function findIsoEntry(disc: DiscImage, path: string[]): DirectoryRecord | null {
  const volume = disc.readSector(16)
  if (volume.toString("latin1", 1, 6) !== "CD001") return null
  let current: DirectoryRecord | null = parseRecord(volume, 156)
  for (const part of path) {
    if (!current?.isDirectory) return null
    current = listDirectory(disc, current).find((record) => record.name === part.toUpperCase()) ?? null
  }
  return current
}

/** Os registros de um diretório (sem as entradas "." e ".."). */
function listDirectory(disc: DiscImage, directory: DirectoryRecord): DirectoryRecord[] {
  const sectors = Math.min(Math.ceil(directory.size / SECTOR), 64)
  const data = disc.readSector(directory.lba, sectors)
  const records: DirectoryRecord[] = []
  let offset = 0
  while (offset < data.length) {
    const length = data[offset]
    if (length === 0) {
      // Registros não atravessam setores: pula para o começo do próximo.
      offset = (Math.floor(offset / SECTOR) + 1) * SECTOR
      continue
    }
    const record = parseRecord(data, offset)
    if (record.name !== " " && record.name !== "") records.push(record)
    offset += length
  }
  return records
}

function parseRecord(buffer: Buffer, offset: number): DirectoryRecord {
  const nameLength = buffer[offset + 32]
  const rawName = buffer.toString("latin1", offset + 33, offset + 33 + nameLength)
  return {
    name: rawName.replace(/;\d+$/, "").replace(/\.$/, "").toUpperCase(),
    lba: buffer.readUInt32LE(offset + 2),
    size: buffer.readUInt32LE(offset + 10),
    isDirectory: (buffer[offset + 25] & 2) !== 0,
  }
}
