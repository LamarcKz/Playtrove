import { existsSync, readdirSync, statSync } from "node:fs"
import { extname, join } from "node:path"
import type Database from "better-sqlite3"
import type { EmulatorId, RetroArchCore, RomFolder, ScanResult } from "../shared/types"
import { ps3GameFolder, readPs3Title } from "./discs"
import { getEmulatorPaths, getPreset, isEmulatorId, listRetroArchCores, romExtensions } from "./emulators"
import { t } from "./i18n"
import { addEmulatedGame } from "./library"

/** Até quantas subpastas a varredura desce (ex.: PS1/Jogo/jogo.cue são 2). */
const MAX_DEPTH = 4

/**
 * Nome do jogo a partir do nome do arquivo, no padrão Redump/No-Intro: tira a extensão e as
 * etiquetas entre parênteses e colchetes, como (USA), (En,Fr,De) e [SLUS-20300].
 * O número do disco fica, para jogos com vários discos: "Jogo (Disc 2)".
 * Ex.: "Pista Real 4 (Europe, Australia) (En,Fr,De,Es,It).iso" → "Pista Real 4".
 */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "")
  const cleaned = base
    .replace(/\s*[[(]([^\])]*)[\])]/g, (_tag, inside: string) => (/^disc \d+$/i.test(inside.trim()) ? ` (${inside.trim()})` : ""))
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned || base
}

/**
 * Os jogos de PS3 de uma pasta: as ISOs e as pastas de jogo extraídas (aquelas com
 * PS3_GAME/USRDIR/EBOOT.BIN, que é o arquivo que o RPCS3 abre).
 */
export function findPs3Games(folder: string, depth = 0): string[] {
  const games: string[] = []
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (!entry.isDirectory()) {
      if (extname(entry.name).toLowerCase() === ".iso") games.push(path)
      continue
    }
    const eboot = join(path, "PS3_GAME", "USRDIR", "EBOOT.BIN")
    if (existsSync(eboot)) games.push(eboot)
    else if (depth < MAX_DEPTH) games.push(...findPs3Games(path, depth + 1))
  }
  return games.sort((a, b) => a.localeCompare(b, "pt-BR"))
}

/** O nome do jogo pelo arquivo. Nos jogos de PS3 em pasta, o nome vem do próprio disco. */
export function titleForRom(romPath: string): string {
  const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path
  const ps3Folder = ps3GameFolder(romPath)
  if (ps3Folder) return readPs3Title(romPath) ?? titleFromFileName(fileName(ps3Folder))
  return titleFromFileName(fileName(romPath))
}

/**
 * Os arquivos de ROM de uma pasta e das subpastas dela, com as extensões aceitas.
 * Um .bin com um .cue na mesma pasta fica de fora: quem abre o jogo é o .cue (jogos de PS1).
 */
export function findRoms(folder: string, extensions: string[], depth = 0): string[] {
  const accepted = new Set(extensions.map((ext) => ext.toLowerCase()))
  const entries = readdirSync(folder, { withFileTypes: true })
  const hasCue = entries.some((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".cue")

  const roms: string[] = []
  for (const entry of entries) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) roms.push(...findRoms(path, extensions, depth + 1))
      continue
    }
    const ext = extname(entry.name).slice(1).toLowerCase()
    if (!accepted.has(ext)) continue
    if (ext === "bin" && hasCue) continue
    roms.push(path)
  }
  return roms.sort((a, b) => a.localeCompare(b, "pt-BR"))
}

// ---------------------------------------------------------------- pastas de ROMs (tabela rom_folders)

interface RomFolderRow {
  id: number
  path: string
  emulator_id: EmulatorId
  core: string | null
  platform: string
}

/** As pastas de ROMs configuradas. */
export function listRomFolders(db: Database.Database): RomFolder[] {
  const rows = db.prepare("SELECT * FROM rom_folders ORDER BY path").all() as RomFolderRow[]
  return rows.map((row) => ({ id: row.id, path: row.path, emulatorId: row.emulator_id, core: row.core, platform: row.platform }))
}

/** Adiciona uma pasta de ROMs, conferindo se ela existe e se a configuração faz sentido. */
export function addRomFolder(db: Database.Database, folder: Omit<RomFolder, "id">): RomFolder {
  const { errors } = t()
  if (!isEmulatorId(folder.emulatorId)) throw new Error(errors.chooseEmulator)
  if (!existsSync(folder.path) || !statSync(folder.path).isDirectory()) throw new Error(errors.folderMissing)
  if (folder.emulatorId === "retroarch" && !folder.core) throw new Error(errors.chooseCore)
  const platform = folder.platform.trim()
  if (!platform) throw new Error(errors.typeConsole)
  const exists = db.prepare("SELECT 1 FROM rom_folders WHERE path = ?").get(folder.path)
  if (exists) throw new Error(errors.folderAlreadyAdded)

  const core = folder.emulatorId === "retroarch" ? folder.core : null
  const { lastInsertRowid } = db
    .prepare("INSERT INTO rom_folders (path, emulator_id, core, platform) VALUES (?, ?, ?, ?)")
    .run(folder.path, folder.emulatorId, core, platform)
  return { id: Number(lastInsertRowid), path: folder.path, emulatorId: folder.emulatorId, core, platform }
}

/** Tira uma pasta da lista (os jogos dela continuam na biblioteca). */
export function removeRomFolder(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM rom_folders WHERE id = ?").run(id)
}

/**
 * Procura jogos nas pastas (todas, ou só as dos ids pedidos) e coloca os novos na biblioteca.
 * Jogos que já estão (mesmo arquivo de ROM) não entram de novo.
 */
export function scanRomFolders(db: Database.Database, ids?: number[]): ScanResult {
  const result: ScanResult = { added: [], addedIds: [], alreadyInLibrary: 0, errors: [] }
  const folders = listRomFolders(db).filter((folder) => !ids || ids.includes(folder.id))
  const retroarchPath = getEmulatorPaths(db).retroarch
  let cores: RetroArchCore[] | null = null

  for (const folder of folders) {
    if (!existsSync(folder.path)) {
      result.errors.push(t().errors.folderGone(folder.path))
      continue
    }
    let core: RetroArchCore | null = null
    if (folder.emulatorId === "retroarch") {
      cores ??= retroarchPath && existsSync(retroarchPath) ? listRetroArchCores(retroarchPath) : []
      core = cores.find((item) => item.id === folder.core) ?? null
      if (!core) {
        result.errors.push(t().errors.coreMissing(folder.core ?? "", folder.path))
        continue
      }
    }

    const library = getPreset(folder.emulatorId).name
    // O RPCS3 abre ISOs e pastas de jogo; os outros, arquivos com as extensões que eles aceitam.
    const roms =
      folder.emulatorId === "rpcs3" ? findPs3Games(folder.path) : findRoms(folder.path, romExtensions(folder.emulatorId, core))
    for (const romPath of roms) {
      const title = titleForRom(romPath)
      const id = addEmulatedGame(db, {
        title,
        romPath,
        platform: folder.platform,
        library,
        emulatorId: folder.emulatorId,
        core: folder.core,
      })
      if (id === null) {
        result.alreadyInLibrary++
      } else {
        result.added.push(title)
        result.addedIds.push(id)
      }
    }
  }
  return result
}
