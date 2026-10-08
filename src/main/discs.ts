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

/**
 * O código do jogo no disco:
 * - PS1 e PS2: do arquivo SYSTEM.CNF (BOOT = cdrom:\SLUS_001.00;1 → SLUS-00100);
 * - PS3: do PARAM.SFO (TITLE_ID, ex.: BLUS30100), na ISO ou na pasta do jogo (EBOOT.BIN).
 * Devolve null quando não dá para ler (formato comprimido, como CHD e CSO, ou disco estranho).
 */
export function readDiscSerial(romPath: string): string | null {
  try {
    const ps3Folder = ps3GameFolder(romPath)
    if (ps3Folder) {
      const sfo = join(ps3Folder, "PS3_GAME", "PARAM.SFO")
      return existsSync(sfo) ? stringField(parseParamSfo(readFileSync(sfo)), "TITLE_ID") : null
    }
    const disc = openDiscImage(romPath)
    if (!disc) return null
    try {
      const systemCnf = readIsoFile(disc, ["SYSTEM.CNF"])
      if (systemCnf) return serialFromSystemCnf(systemCnf.toString("latin1"))
      const sfo = readIsoFile(disc, ["PS3_GAME", "PARAM.SFO"])
      return sfo ? stringField(parseParamSfo(sfo), "TITLE_ID") : null
    } finally {
      disc.close()
    }
  } catch {
    return null
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
