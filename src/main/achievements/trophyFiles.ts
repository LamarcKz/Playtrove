import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import type { TrophyGrade } from "../../shared/achievements"

/**
 * Os troféus que o RPCS3 guarda de cada jogo de PS3, em
 * <pasta do RPCS3>/dev_hdd0/home/<usuário>/trophy/<conjunto>/ (ex.: NPWR01234_00):
 * - TROPCONF.SFM: a lista dos troféus (XML), já no idioma escolhido no RPCS3;
 * - TROPUSR.DAT: o que o usuário pegou e quando (binário);
 * - TROP000.PNG, TROP001.PNG...: a imagem de cada troféu.
 * O app só lê: quem desbloqueia é o próprio RPCS3, durante o jogo.
 */

/** O código de um conjunto de troféus do PS3 (ex.: NPWR01234_00). */
const TROPHY_SET_ID = /^[A-Z]{4}\d{5}_\d{2}$/

export function isTrophySetId(value: string): boolean {
  return TROPHY_SET_ID.test(value)
}

export interface TrophyDefinition {
  id: number
  name: string
  detail: string
  grade: TrophyGrade
  hidden: boolean
  /** O pacote extra (DLC) do troféu, ou null para o jogo principal. */
  group: string | null
}

export interface TrophySetDefinition {
  title: string
  trophies: TrophyDefinition[]
}

/** Os troféus pegos: o id e quando (ISO), ou null se o RPCS3 não guardou uma data que faça sentido. */
export type TrophyUnlocks = Map<number, string | null>

/** Um conjunto instalado pelo RPCS3, com a "assinatura" dos arquivos (muda quando eles mudam). */
export interface InstalledTrophySet {
  id: string
  dir: string
  stamp: string
}

// ---------------------------------------------------------------- onde ficam

/**
 * A pasta de troféus do usuário ativo do RPCS3. O usuário vem de GuiConfigs/persistent_settings.dat
 * ([Users] active_user; o padrão é 00000001) e o disco interno (dev_hdd0), do config/vfs.yml,
 * quando ele foi mudado de lugar.
 */
export function findTrophyDir(rpcs3Exe: string, readText: (path: string) => string | null = readTextFile): string {
  const root = dirname(rpcs3Exe)
  const user = activeUser(readText(join(root, "GuiConfigs", "persistent_settings.dat"))) ?? "00000001"
  return join(hdd0Dir(root, readText(join(root, "config", "vfs.yml"))), "home", user, "trophy")
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

/** O usuário ativo (8 dígitos) do persistent_settings.dat, que é um INI do Qt. */
function activeUser(settings: string | null): string | null {
  return settings ? (/^\[Users\][^[]*?^active_user\s*=\s*"?(\d{8})"?\s*$/m.exec(settings)?.[1] ?? null) : null
}

/** A pasta do dev_hdd0: a do vfs.yml (com $(EmulatorDir) = a pasta do RPCS3) ou a padrão. */
function hdd0Dir(root: string, vfs: string | null): string {
  const value = (key: string) => {
    const line = vfs?.split(/\r?\n/).find((text) => text.trimStart().startsWith(`${key}:`))
    return line === undefined ? null : line.slice(line.indexOf(`${key}:`) + key.length + 1).trim().replace(/^(["'])(.*)\1$/, "$2")
  }
  const configured = value("/dev_hdd0/")
  if (!configured) return join(root, "dev_hdd0")
  const emulatorDir = value("$(EmulatorDir)") || `${root}/`
  const path = configured.replace("$(EmulatorDir)", emulatorDir)
  return isAbsolute(path) ? path : resolve(root, path)
}

/** Os conjuntos de troféus instalados (as pastas NPWR..., com a lista de troféus dentro). */
export function listTrophySets(trophyDir: string): InstalledTrophySet[] {
  if (!existsSync(trophyDir)) return []
  const stampOf = (path: string) => {
    try {
      const stat = statSync(path)
      return `${stat.size}:${Math.round(stat.mtimeMs)}`
    } catch {
      return "-"
    }
  }
  return readdirSync(trophyDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isTrophySetId(entry.name) && existsSync(join(trophyDir, entry.name, "TROPCONF.SFM")))
    .map((entry) => {
      const dir = join(trophyDir, entry.name)
      return { id: entry.name, dir, stamp: `${stampOf(join(dir, "TROPCONF.SFM"))}|${stampOf(join(dir, "TROPUSR.DAT"))}` }
    })
}

/** Lê um conjunto instalado: a lista de troféus e os que foram pegos (sem TROPUSR.DAT, nenhum). */
export function readTrophySet(set: InstalledTrophySet, now = new Date()): { definition: TrophySetDefinition; unlocks: TrophyUnlocks } {
  const definition = parseTropConf(readFileSync(join(set.dir, "TROPCONF.SFM"), "utf8"))
  const usr = join(set.dir, "TROPUSR.DAT")
  return { definition, unlocks: existsSync(usr) ? parseTropUsr(readFileSync(usr), now) : new Map() }
}

/** O arquivo da imagem de um troféu na pasta do conjunto (TROP007.PNG). */
export function trophyIconFile(setDir: string, trophyId: number): string {
  return join(setDir, `TROP${String(trophyId).padStart(3, "0")}.PNG`)
}

// ---------------------------------------------------------------- TROPCONF.SFM

const GRADES: Record<string, TrophyGrade> = { P: "platina", G: "ouro", S: "prata", B: "bronze" }

/**
 * A lista de troféus (TROPCONF.SFM): o nome do jogo, os pacotes extras (<group>) e cada <trophy>,
 * com o tipo (ttype: P, G, S ou B), se é oculto e o pacote (gid).
 */
export function parseTropConf(text: string): TrophySetDefinition {
  const xml = text.replace(/^﻿/, "")
  const groups = new Map<string, string>()
  for (const [, attributes, content] of xml.matchAll(/<group\b([^>]*)>([\s\S]*?)<\/group>/g)) {
    const id = attribute(attributes, "id")
    const name = element(content, "name")
    if (id && name) groups.set(id, name)
  }
  const trophies: TrophyDefinition[] = []
  for (const [, attributes, content] of xml.matchAll(/<trophy\b([^>]*)>([\s\S]*?)<\/trophy>/g)) {
    const id = Number(attribute(attributes, "id"))
    const grade = GRADES[(attribute(attributes, "ttype") ?? "").toUpperCase()]
    if (!Number.isInteger(id) || id < 0 || !grade) continue
    const group = attribute(attributes, "gid")
    trophies.push({
      id,
      name: element(content, "name") ?? "",
      detail: element(content, "detail") ?? "",
      grade,
      hidden: (attribute(attributes, "hidden") ?? "").toLowerCase().startsWith("y"),
      group: group ? (groups.get(group) ?? null) : null,
    })
  }
  return { title: element(xml, "title-name") ?? "", trophies: trophies.sort((a, b) => a.id - b.id) }
}

function attribute(attributes: string, name: string): string | null {
  const value = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attributes)?.[1]
  return value === undefined ? null : decodeXml(value)
}

/** O texto de um elemento (o primeiro com esse nome), sem espaços sobrando. */
function element(xml: string, name: string): string | null {
  const content = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]
  if (content === undefined) return null
  const text = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  return decodeXml(text).replace(/\s+/g, " ").trim()
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

// ---------------------------------------------------------------- TROPUSR.DAT

/** Microssegundos entre 0001-01-01 e 1970-01-01: o relógio do PS3 conta desde o ano 1 (UTC). */
const TICK_EPOCH = 62135596800000000n

/**
 * O que foi pego (TROPUSR.DAT): um cabeçalho (marca 0x818F54AD e quantas tabelas), as tabelas e,
 * na tabela 6, um registro por troféu com o id, se foi pego e quando.
 */
export function parseTropUsr(buffer: Buffer, now = new Date()): TrophyUnlocks {
  if (buffer.length < 48 || buffer.readUInt32BE(0) !== 0x818f54ad) throw new Error("Não é um TROPUSR.DAT.")
  const unlocks: TrophyUnlocks = new Map()
  const tables = buffer.readUInt32BE(8)
  for (let table = 0; table < tables; table++) {
    const header = 48 + table * 32
    if (header + 32 > buffer.length) break
    if (buffer.readUInt32BE(header) !== 6) continue
    // O tamanho de cada registro não conta os 16 bytes do começo dele.
    const entrySize = buffer.readUInt32BE(header + 4) + 16
    const count = buffer.readUInt32BE(header + 12)
    const offset = Number(buffer.readBigUInt64BE(header + 16))
    for (let entry = 0; entry < count; entry++) {
      const start = offset + entry * entrySize
      if (start + 48 > buffer.length) break
      if (buffer.readUInt32BE(start + 20) === 0) continue
      unlocks.set(buffer.readUInt32BE(start + 16), tickToIso(buffer.readBigUInt64BE(start + 32), now))
    }
  }
  return unlocks
}

/** A data de um "tick" do PS3 (microssegundos desde 0001-01-01, UTC), ou null se não fizer sentido. */
export function tickToIso(tick: bigint, now = new Date()): string | null {
  if (tick <= TICK_EPOCH) return null
  const time = Number((tick - TICK_EPOCH) / 1000n)
  // Antes do lançamento do PS3 ou depois de amanhã: o relógio do emulador estava errado.
  if (time < Date.UTC(2006, 10, 1) || time > now.getTime() + 24 * 60 * 60 * 1000) return null
  return new Date(time).toISOString()
}
