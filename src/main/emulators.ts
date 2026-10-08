import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import type Database from "better-sqlite3"
import type { EmulatorId, EmulatorInfo, RetroArchCore } from "../shared/types"
import { t } from "./i18n"

/** O que o app sabe sobre cada emulador. */
interface EmulatorPreset {
  id: EmulatorId
  name: string
  /** Consoles que ele roda, para mostrar na tela (null: vários, um core para cada, como o RetroArch). */
  platforms: string | null
  /** Nome do executável, para reconhecer o emulador (ex.: nos atalhos do menu Iniciar). */
  executable: RegExp
  /** Onde ele costuma ficar quando é instalado (e não portátil). %VARIÁVEL% vira a variável do Windows. */
  commonPaths: string[]
  /** Extensões de ROM que ele abre, sem o ponto. No RetroArch elas vêm do core. */
  extensions: string[]
  /**
   * Argumentos para abrir uma ROM. O emulador precisa fechar junto com o jogo, para o app contar o
   * tempo. Nada de forçar tela cheia ou janela: vale a configuração de cada emulador (pedido do
   * usuário em 2026-09-19).
   */
  args: (rom: string, corePath: string | null) => string[]
}

const EMULATOR_PRESETS: EmulatorPreset[] = [
  {
    id: "pcsx2",
    name: "PCSX2",
    platforms: "PlayStation 2",
    executable: /^pcsx2-qt.*\.exe$/i,
    commonPaths: ["%ProgramFiles%\\PCSX2\\pcsx2-qt.exe", "%LOCALAPPDATA%\\Programs\\PCSX2\\pcsx2-qt.exe"],
    extensions: ["iso", "chd", "cso", "zso", "gz", "bin", "img", "mdf", "nrg", "elf"],
    // -batch: o PCSX2 fecha quando o jogo fecha.
    args: (rom) => ["-batch", "--", rom],
  },
  {
    id: "duckstation",
    name: "DuckStation",
    platforms: "PlayStation",
    executable: /^duckstation-(qt|nogui).*\.exe$/i,
    commonPaths: [
      "%LOCALAPPDATA%\\Programs\\DuckStation\\duckstation-qt-x64-ReleaseLTCG.exe",
      "%ProgramFiles%\\DuckStation\\duckstation-qt-x64-ReleaseLTCG.exe",
    ],
    extensions: ["cue", "chd", "pbp", "m3u", "iso", "img", "ecm", "mds", "bin"],
    // -batch: o DuckStation fecha quando o jogo fecha.
    args: (rom) => ["-batch", "--", rom],
  },
  {
    id: "retroarch",
    name: "RetroArch",
    platforms: null,
    executable: /^retroarch\.exe$/i,
    commonPaths: [
      "C:\\RetroArch-Win64\\retroarch.exe",
      "%ProgramFiles%\\RetroArch\\retroarch.exe",
      "%ProgramFiles(x86)%\\Steam\\steamapps\\common\\RetroArch\\retroarch.exe",
    ],
    extensions: [],
    // -L: o core que roda o jogo. O RetroArch fecha sozinho quando o jogo fecha.
    args: (rom, corePath) => ["-L", corePath ?? "", rom],
  },
  {
    id: "rpcs3",
    name: "RPCS3",
    platforms: "PlayStation 3",
    executable: /^rpcs3\.exe$/i,
    commonPaths: ["%ProgramFiles%\\RPCS3\\rpcs3.exe", "%LOCALAPPDATA%\\Programs\\RPCS3\\rpcs3.exe"],
    // Além das ISOs, as pastas de jogo extraídas (PS3_GAME/USRDIR/EBOOT.BIN), achadas pelo romScanner.
    extensions: ["iso"],
    // --no-gui: só o jogo, sem a lista de jogos do RPCS3, e ele fecha junto com o jogo.
    args: (rom) => ["--no-gui", rom],
  },
]

/** Os dados fixos de um emulador. */
export function getPreset(id: EmulatorId): EmulatorPreset {
  const preset = EMULATOR_PRESETS.find((item) => item.id === id)
  if (!preset) throw new Error(t().errors.unknownEmulator)
  return preset
}

/** O valor é um dos emuladores que o app conhece? */
export function isEmulatorId(value: unknown): value is EmulatorId {
  return EMULATOR_PRESETS.some((preset) => preset.id === value)
}

// ---------------------------------------------------------------- configuração (tabela emulators)

/** O executável configurado de cada emulador. */
export function getEmulatorPaths(db: Database.Database): Partial<Record<EmulatorId, string>> {
  const rows = db.prepare("SELECT id, path FROM emulators").all() as { id: EmulatorId; path: string }[]
  return Object.fromEntries(rows.map((row) => [row.id, row.path]))
}

/** Grava o executável de um emulador. */
export function setEmulatorPath(db: Database.Database, id: EmulatorId, path: string): void {
  db.prepare("INSERT INTO emulators (id, path) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET path = excluded.path").run(id, path)
}

/** Os emuladores, com o executável configurado e se ele existe. */
export function listEmulators(db: Database.Database, exists: (path: string) => boolean = existsSync): EmulatorInfo[] {
  const paths = getEmulatorPaths(db)
  return EMULATOR_PRESETS.map((preset) => {
    const path = paths[preset.id] ?? null
    return { id: preset.id, name: preset.name, platforms: preset.platforms, path, found: path !== null && exists(path) }
  })
}

// ---------------------------------------------------------------- detecção automática

/** De onde a detecção lê as coisas (separado para os testes poderem trocar por dados de mentira). */
export interface DetectionSources {
  /** Atalhos (.lnk) para olhar: menu Iniciar e Área de Trabalho. */
  shortcuts: () => string[]
  /** Para onde um atalho aponta (ou null). */
  readShortcut: (path: string) => string | null
  exists: (path: string) => boolean
  /** O que tem numa pasta (vazio se ela não existir), para procurar perto dos emuladores achados. */
  listDir: (path: string) => { name: string; isDirectory: boolean }[]
  /** Variáveis de ambiente, para os caminhos comuns (ex.: %ProgramFiles%). */
  env: Record<string, string | undefined>
}

/** Quantas pastas acima da pasta de um emulador achado a procura por perto sobe. */
const NEARBY_LEVELS = 2
/** Quantas pastas ela desce a partir de cada uma dessas. */
const NEARBY_DEPTH = 2
/** Limite de pastas olhadas, para nunca demorar. */
const NEARBY_MAX_FOLDERS = 400

/**
 * Procura cada emulador: primeiro nos atalhos (emuladores portáteis costumam ter um no menu Iniciar),
 * depois nos lugares de instalação comuns e, por fim, perto dos emuladores já achados (`known` são os
 * executáveis que já funcionam): quem usa emuladores portáteis costuma deixar todos na mesma pasta.
 * Atalhos quebrados (apontando para algo que não existe mais) são ignorados.
 */
export function detectEmulators(sources: DetectionSources, known: string[] = []): Partial<Record<EmulatorId, string>> {
  const targets = sources
    .shortcuts()
    .map((shortcut) => sources.readShortcut(shortcut))
    .filter((target): target is string => target !== null && sources.exists(target))

  const found: Partial<Record<EmulatorId, string>> = {}
  for (const preset of EMULATOR_PRESETS) {
    const fromShortcut = targets.find((target) => preset.executable.test(basename(target)))
    const fromCommonPath = preset.commonPaths.map((path) => expandEnv(path, sources.env)).find(sources.exists)
    const path = fromShortcut ?? fromCommonPath
    if (path) found[preset.id] = path
  }

  const missing = EMULATOR_PRESETS.filter((preset) => !found[preset.id])
  if (missing.length > 0) Object.assign(found, findNearby([...Object.values(found), ...known], missing, sources))
  return found
}

/**
 * Procura os emuladores que faltam nas pastas vizinhas aos já achados: sobe até NEARBY_LEVELS pastas
 * a partir da pasta de cada um e desce até NEARBY_DEPTH. Ex.: com o PCSX2 em
 * EMULATOR/Emulador/PCSX2/pcsx2-v2/pcsx2-qt.exe, acha EMULATOR/Emulador/RPCS3/rpcs3-v0/rpcs3.exe.
 * Pastas largas demais (a raiz do disco, Arquivos de Programas, a pasta do usuário) não são vasculhadas.
 */
function findNearby(
  anchors: string[],
  missing: EmulatorPreset[],
  sources: DetectionSources
): Partial<Record<EmulatorId, string>> {
  const roots = new Set<string>()
  for (const anchor of anchors) {
    let dir = dirname(anchor)
    for (let level = 0; level < NEARBY_LEVELS; level++) {
      const parent = dirname(dir)
      if (parent === dir || isTooBroad(parent, sources.env)) break
      dir = parent
      roots.add(dir)
    }
  }

  const found: Partial<Record<EmulatorId, string>> = {}
  const visited = new Set<string>()
  const visit = (dir: string, depth: number) => {
    const key = dir.toLowerCase()
    if (visited.has(key) || visited.size >= NEARBY_MAX_FOLDERS) return
    visited.add(key)
    for (const entry of sources.listDir(dir)) {
      const path = join(dir, entry.name)
      if (entry.isDirectory) {
        if (depth < NEARBY_DEPTH) visit(path, depth + 1)
        continue
      }
      const preset = missing.find((item) => !found[item.id] && item.executable.test(entry.name))
      if (preset) found[preset.id] = path
    }
  }
  for (const root of roots) visit(root, 0)
  return found
}

/** Pasta larga demais para vasculhar: a raiz de um disco ou uma pasta do sistema ou do usuário. */
function isTooBroad(dir: string, env: Record<string, string | undefined>): boolean {
  const normalize = (path: string) => path.replace(/[\\/]+$/, "").toLowerCase()
  const target = normalize(dir)
  if (/^[a-z]:$/.test(target)) return true
  const broad = ["ProgramFiles", "ProgramFiles(x86)", "ProgramData", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PUBLIC", "SystemRoot"]
    .map((name) => env[name])
    .filter((path): path is string => Boolean(path))
  const users = env["USERPROFILE"] ? dirname(env["USERPROFILE"]) : null
  return [...broad, ...(users ? [users] : [])].some((path) => normalize(path) === target)
}

/**
 * Preenche os emuladores que ainda não têm um executável válido com o que a detecção achar.
 * Os que já funcionam (inclusive os escolhidos pelo usuário) não mudam.
 */
export function fillMissingEmulators(db: Database.Database, sources: DetectionSources): void {
  const current = listEmulators(db, sources.exists)
  const known = current.filter((emulator) => emulator.found && emulator.path).map((emulator) => emulator.path as string)
  const detected = detectEmulators(sources, known)
  for (const emulator of current) {
    const path = detected[emulator.id]
    if (!emulator.found && path) setEmulatorPath(db, emulator.id, path)
  }
}

/** Troca %VARIÁVEL% pelo valor dela. */
function expandEnv(path: string, env: Record<string, string | undefined>): string {
  return path.replace(/%([^%]+)%/g, (whole, name: string) => env[name] ?? whole)
}

// ---------------------------------------------------------------- RetroArch

/** Lê um arquivo .info de core do RetroArch (linhas `chave = "valor"`). */
export function parseCoreInfo(text: string): Record<string, string> {
  const info: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\w+)\s*=\s*"?(.*?)"?\s*$/.exec(line)
    if (match) info[match[1]] = match[2]
  }
  return info
}

/**
 * Os cores instalados no RetroArch (arquivos .dll da pasta "cores"), com o nome, o console e as
 * extensões que vêm do arquivo .info de cada um (pasta "info").
 */
export function listRetroArchCores(retroarchExe: string): RetroArchCore[] {
  const root = dirname(retroarchExe)
  const coresDir = join(root, "cores")
  if (!existsSync(coresDir)) return []

  return readdirSync(coresDir)
    .filter((file) => file.toLowerCase().endsWith(".dll"))
    .map((file) => {
      const id = file.slice(0, -4)
      const infoPath = join(root, "info", `${id}.info`)
      const info = existsSync(infoPath) ? parseCoreInfo(readFileSync(infoPath, "utf8")) : {}
      return {
        id,
        name: info["display_name"] || id,
        system: info["systemname"] || "",
        extensions: (info["supported_extensions"] ?? "").split("|").filter(Boolean).map((ext) => ext.toLowerCase()),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
}

/** Extensões que uma pasta de ROMs aceita: as do emulador ou, no RetroArch, as do core mais .zip e .7z. */
export function romExtensions(emulatorId: EmulatorId, core: RetroArchCore | null): string[] {
  if (emulatorId !== "retroarch") return getPreset(emulatorId).extensions
  return [...new Set([...(core?.extensions ?? []), "zip", "7z"])]
}

// ---------------------------------------------------------------- abrir um jogo

/** O comando para abrir uma ROM: o executável do emulador e os argumentos. */
export function buildLaunchCommand(
  emulatorId: EmulatorId,
  emulatorPath: string,
  romPath: string,
  core: string | null
): { command: string; args: string[] } {
  const corePath = core ? join(dirname(emulatorPath), "cores", `${core}.dll`) : null
  return { command: emulatorPath, args: getPreset(emulatorId).args(romPath, corePath) }
}
