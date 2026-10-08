import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, dirname, extname, isAbsolute, join } from "node:path"
import type Database from "better-sqlite3"
import type { EmulatorId } from "../shared/types"
import { readDiscSerial } from "./discs"

/**
 * Tempo jogado registrado pelos próprios emuladores. Assim o app mostra também o que foi jogado
 * abrindo o emulador direto, sem passar pelo botão Jogar (pedido do usuário em 2026-09-19):
 * - PCSX2 e DuckStation: playtime.dat, por código do disco (ex.: SLUS-20100);
 * - RPCS3: GuiConfigs/persistent_settings.dat, por código do jogo (ex.: BLUS30100);
 * - RetroArch: um arquivo .lrtl por jogo em playlists/logs (se o registro de tempo estiver ligado nele).
 */

/** O que um emulador registrou para um jogo. */
export interface EmulatorPlaytime {
  seconds: number
  /** ISO, ou null se ele não guardou. */
  lastPlayedAt: string | null
}

/** Onde estão os registros de tempo de cada emulador (null quando não existem). */
export interface PlaytimeFiles {
  pcsx2: string | null
  duckstation: string | null
  rpcs3: string | null
  /** Pasta dos registros do RetroArch (playlists/logs). */
  retroarchLogs: string | null
}

/** Os registros lidos, prontos para consultar por jogo. */
export interface EmulatorRecords {
  bySerial: Partial<Record<"pcsx2" | "duckstation" | "rpcs3", Map<string, EmulatorPlaytime>>>
  /** O registro do RetroArch para uma ROM (pelo nome do arquivo). */
  retroarch: (romPath: string) => EmulatorPlaytime | null
}

/** Tempo jogado fora do app que vira uma sessão (para a atividade por dia). Menos que isso é ruído. */
const MIN_IMPORTED_SESSION_SECONDS = 60
/** Na primeira leitura de um jogo, o tempo só entra na atividade se a última vez jogado for recente. */
const IMPORT_WINDOW_DAYS = 30

// ---------------------------------------------------------------- leitura dos arquivos

/** playtime.dat do PCSX2 e do DuckStation: uma linha por jogo, "CÓDIGO SEGUNDOS ÚLTIMA_VEZ" (unix). */
export function parsePlaytimeDat(text: string): Map<string, EmulatorPlaytime> {
  const records = new Map<string, EmulatorPlaytime>()
  for (const line of text.split(/\r?\n/)) {
    const [serial, seconds, lastPlayed] = line.trim().split(/\s+/)
    const total = Number(seconds)
    if (!serial || !Number.isFinite(total)) continue
    const last = Number(lastPlayed)
    records.set(serial.toUpperCase(), {
      seconds: total,
      lastPlayedAt: Number.isFinite(last) && last > 0 ? new Date(last * 1000).toISOString() : null,
    })
  }
  return records
}

/** persistent_settings.dat do RPCS3: seções [Playtime] (milissegundos) e [LastPlayed] (data local). */
export function parseRpcs3Settings(text: string): Map<string, EmulatorPlaytime> {
  const playtime = new Map<string, number>()
  const lastPlayed = new Map<string, string>()
  let section = ""
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[(.+)\]\s*$/.exec(line)
    if (header) {
      section = header[1]
      continue
    }
    const entry = /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(line)
    if (!entry) continue
    if (section === "Playtime") playtime.set(entry[1].toUpperCase(), Number(entry[2]))
    if (section === "LastPlayed") lastPlayed.set(entry[1].toUpperCase(), entry[2])
  }
  const records = new Map<string, EmulatorPlaytime>()
  for (const serial of new Set([...playtime.keys(), ...lastPlayed.keys()])) {
    const milliseconds = playtime.get(serial) ?? 0
    records.set(serial, {
      seconds: Number.isFinite(milliseconds) ? Math.round(milliseconds / 1000) : 0,
      lastPlayedAt: parseLocalDateTime(lastPlayed.get(serial) ?? ""),
    })
  }
  return records
}

/** Um registro do RetroArch (.lrtl): tempo "H:MM:SS" e última vez (data local). */
export function parseRetroArchLog(text: string): EmulatorPlaytime | null {
  try {
    const log = JSON.parse(text) as { runtime?: string; last_played?: string }
    const parts = /^(\d+):(\d{2}):(\d{2})$/.exec(log.runtime ?? "")
    if (!parts) return null
    return {
      seconds: Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3]),
      lastPlayedAt: parseLocalDateTime(log.last_played ?? ""),
    }
  } catch {
    return null
  }
}

/** "2026-09-12T21:27:47" ou "2026-09-12 19:37:50" (horário do computador) → ISO. */
function parseLocalDateTime(text: string): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(text)
  if (!parts) return null
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number)
  return new Date(year, month - 1, day, hour, minute, second).toISOString()
}

// ---------------------------------------------------------------- onde ficam os arquivos

/**
 * Os registros de tempo de cada emulador configurado:
 * - PCSX2: na pasta dele se for portátil (portable.ini ou portable.txt), senão em Documentos\PCSX2\inis;
 * - DuckStation: na pasta dele se for portátil (portable.txt), senão em AppData\Local\DuckStation
 *   (versões novas) ou Documentos\DuckStation (antigas);
 * - RPCS3: sempre na pasta dele (GuiConfigs);
 * - RetroArch: playlists\logs na pasta dele (ou na pasta de listas configurada no retroarch.cfg).
 */
export function findPlaytimeFiles(
  emulatorPaths: Partial<Record<EmulatorId, string>>,
  folders: { documents: string; localAppData: string | undefined },
  exists: (path: string) => boolean = existsSync
): PlaytimeFiles {
  const firstExisting = (paths: (string | null)[]) => paths.find((path): path is string => path !== null && exists(path)) ?? null
  const dirOf = (id: EmulatorId) => (emulatorPaths[id] ? dirname(emulatorPaths[id] as string) : null)

  const pcsx2 = dirOf("pcsx2")
  const pcsx2Portable = pcsx2 && (exists(join(pcsx2, "portable.ini")) || exists(join(pcsx2, "portable.txt")))
  const duckstation = dirOf("duckstation")
  const duckstationPortable = duckstation && exists(join(duckstation, "portable.txt"))
  const rpcs3 = dirOf("rpcs3")
  const retroarch = dirOf("retroarch")

  return {
    pcsx2: pcsx2
      ? firstExisting([join(pcsx2Portable ? pcsx2 : join(folders.documents, "PCSX2"), "inis", "playtime.dat")])
      : null,
    duckstation: duckstation
      ? firstExisting(
          duckstationPortable
            ? [join(duckstation, "playtime.dat")]
            : [
                folders.localAppData ? join(folders.localAppData, "DuckStation", "playtime.dat") : null,
                join(folders.documents, "DuckStation", "playtime.dat"),
              ]
        )
      : null,
    rpcs3: rpcs3 ? firstExisting([join(rpcs3, "GuiConfigs", "persistent_settings.dat")]) : null,
    retroarchLogs: retroarch ? firstExisting([join(retroarchPlaylists(retroarch, exists), "logs")]) : null,
  }
}

/** A pasta de listas do RetroArch: a do retroarch.cfg (":" é a pasta do próprio RetroArch) ou a padrão. */
function retroarchPlaylists(retroarchDir: string, exists: (path: string) => boolean): string {
  const config = join(retroarchDir, "retroarch.cfg")
  if (exists(config)) {
    try {
      const value = /^\s*playlist_directory\s*=\s*"([^"]*)"/m.exec(readFileSync(config, "utf8"))?.[1]
      if (value && value !== "default") {
        const path = value.startsWith(":") ? join(retroarchDir, value.slice(1)) : value
        if (isAbsolute(path)) return path
      }
    } catch {
      // Sem o arquivo de configuração, vale a pasta padrão.
    }
  }
  return join(retroarchDir, "playlists")
}

/** Lê todos os registros (um arquivo que falhar é tratado como vazio). */
export function readEmulatorRecords(files: PlaytimeFiles): EmulatorRecords {
  const read = (path: string | null, parse: (text: string) => Map<string, EmulatorPlaytime>) => {
    if (!path) return undefined
    try {
      return parse(readFileSync(path, "utf8"))
    } catch {
      return undefined
    }
  }
  const logFolders = files.retroarchLogs ? listFolders(files.retroarchLogs) : []
  return {
    bySerial: {
      pcsx2: read(files.pcsx2, parsePlaytimeDat),
      duckstation: read(files.duckstation, parsePlaytimeDat),
      rpcs3: read(files.rpcs3, parseRpcs3Settings),
    },
    retroarch: (romPath) => {
      // Um arquivo por jogo, com o nome da ROM, na pasta do core (ou direto em logs, se o
      // registro for o "agregado"). Vale o maior, se houver mais de um core.
      const name = `${basename(romPath, extname(romPath))}.lrtl`
      let best: EmulatorPlaytime | null = null
      for (const folder of [files.retroarchLogs, ...logFolders]) {
        if (!folder) continue
        try {
          const record = parseRetroArchLog(readFileSync(join(folder, name), "utf8"))
          if (record && (!best || record.seconds > best.seconds)) best = record
        } catch {
          // Esse core não tem registro para o jogo.
        }
      }
      return best
    },
  }
}

function listFolders(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(path, entry.name))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------- juntar com a biblioteca

interface SyncRow {
  id: number
  emulator_id: EmulatorId
  rom_path: string
  serial: string | null
  emulator_playtime_seconds: number
  emulator_last_played_at: string | null
  emulator_synced_at: string | null
}

/**
 * Atualiza o tempo registrado pelos emuladores em cada jogo. A tela mostra o maior entre esse e o
 * contado pelo app (os dois medem as mesmas sessões quando o jogo é aberto pelo botão Jogar; o do
 * emulador inclui também o que foi jogado fora do app). O tempo jogado fora do app vira uma sessão,
 * para entrar na atividade por dia das Estatísticas (veja `sessionToImport`). Devolve quantos jogos
 * mudaram.
 */
export function syncEmulatorPlaytime(db: Database.Database, records: EmulatorRecords, now = new Date()): number {
  const rows = db
    .prepare(
      `SELECT id, emulator_id, rom_path, serial, emulator_playtime_seconds, emulator_last_played_at, emulator_synced_at
       FROM games WHERE emulator_id IS NOT NULL AND rom_path IS NOT NULL`
    )
    .all() as SyncRow[]
  const appSecondsSince = db.prepare(
    "SELECT COALESCE(SUM(seconds), 0) FROM play_sessions WHERE game_id = ? AND source = 'app' AND ended_at > ?"
  )
  // Na primeira leitura desconta tudo o que já virou sessão, de onde quer que tenha vindo.
  const countedSeconds = db.prepare("SELECT COALESCE(SUM(seconds), 0) FROM play_sessions WHERE game_id = ?")
  const insertSession = db.prepare(
    "INSERT INTO play_sessions (game_id, started_at, ended_at, seconds, source) VALUES (?, ?, ?, ?, 'emulador')"
  )
  const update = db.prepare(
    "UPDATE games SET emulator_playtime_seconds = ?, emulator_last_played_at = ?, emulator_synced_at = ? WHERE id = ?"
  )

  let changed = 0
  for (const row of rows) {
    const record = lookup(db, row, records)
    if (!record) continue
    const same = record.seconds === row.emulator_playtime_seconds && record.lastPlayedAt === row.emulator_last_played_at
    if (same && row.emulator_synced_at) continue

    db.transaction(() => {
      const counted = row.emulator_synced_at
        ? (appSecondsSince.pluck().get(row.id, row.emulator_synced_at) as number)
        : (countedSeconds.pluck().get(row.id) as number)
      const session = sessionToImport(row, record, counted, now)
      if (session) {
        const startedAt = new Date(Date.parse(session.endedAt) - session.seconds * 1000).toISOString()
        insertSession.run(row.id, startedAt, session.endedAt, session.seconds)
      }
      update.run(record.seconds, record.lastPlayedAt, now.toISOString(), row.id)
    })()
    changed++
  }
  return changed
}

/**
 * Quanto tempo desta leitura vira uma sessão na atividade por dia, e em que dia ela termina (null =
 * nenhuma). Na primeira leitura de um jogo entra tudo o que o emulador já tinha registrado, no dia
 * da última vez jogado (escolha do usuário em 2026-09-19), e só se esse dia for dos últimos 30 dias,
 * que é o período do gráfico; como o emulador guarda só a última data, o que foi jogado em dias
 * anteriores cai nela também. Nas leituras seguintes entra o que apareceu desde a anterior. Nos dois
 * casos, o tempo que já virou sessão é descontado (na primeira leitura, todas as sessões do jogo;
 * depois, as que o app contou desde a leitura anterior), para não aparecer duas vezes.
 */
function sessionToImport(
  row: SyncRow,
  record: EmulatorPlaytime,
  counted: number,
  now: Date
): { endedAt: string; seconds: number } | null {
  const first = row.emulator_synced_at === null
  const seconds = (first ? record.seconds : record.seconds - row.emulator_playtime_seconds) - counted
  if (seconds < MIN_IMPORTED_SESSION_SECONDS) return null
  if (!first) return { endedAt: record.lastPlayedAt ?? now.toISOString(), seconds }
  if (!record.lastPlayedAt) return null
  const oldest = now.getTime() - IMPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  return Date.parse(record.lastPlayedAt) >= oldest ? { endedAt: record.lastPlayedAt, seconds } : null
}

/** O registro do emulador para um jogo (o código do disco é lido uma vez e guardado no banco). */
function lookup(db: Database.Database, row: SyncRow, records: EmulatorRecords): EmulatorPlaytime | null {
  if (row.emulator_id === "retroarch") return records.retroarch(row.rom_path)
  const bySerial = records.bySerial[row.emulator_id]
  if (!bySerial) return null
  let serial = row.serial
  if (serial === null) {
    // "" = já tentou e não achou (ex.: CHD comprimido): não lê o disco de novo.
    serial = existsSync(row.rom_path) ? (readDiscSerial(row.rom_path) ?? "") : null
    if (serial !== null) db.prepare("UPDATE games SET serial = ? WHERE id = ?").run(serial, row.id)
  }
  return serial ? (bySerial.get(serial.toUpperCase()) ?? null) : null
}
