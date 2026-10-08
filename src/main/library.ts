import type Database from "better-sqlite3"
import type { AchievementProgress } from "../shared/achievements"
import type { GameEvaluation } from "../shared/evaluation"
import { isStatusPreset, LANGUAGES, messagesFor } from "../shared/i18n"
import { progressByGame } from "./achievements/views"
import type { EmulatorId, Game, LibrarySnapshot, Status, StatusRules } from "../shared/types"
import { t } from "./i18n"
import { imageUrl, type ImageKind } from "./imageFiles"
import { getSetting, setSetting } from "./settings"

/** Tamanho máximo do nome de um status. */
const MAX_STATUS_NAME = 40

/** Uma linha da tabela games, como vem do SQLite. */
interface GameRow {
  id: number
  title: string
  status_id: number
  favorite: number
  playtime_seconds: number
  last_played_at: string | null
  added_at: string
  platform: string | null
  library: string | null
  rom_path: string | null
  emulator_id: EmulatorId | null
  description: string | null
  /** Listas guardadas como JSON (ex.: ["Corrida"]). */
  genres: string | null
  developer: string | null
  publisher: string | null
  release_date: string | null
  cover_image: string | null
  background_image: string | null
  metadata_updated_at: string | null
  /** Tempo e última vez registrados pelo próprio emulador (emulatorPlaytime.ts). */
  emulator_playtime_seconds: number
  emulator_last_played_at: string | null
  /** A avaliação do usuário (migração 5). */
  rating: number | null
  difficulty: number | null
  review: string | null
}

/** Tudo o que a interface precisa: jogos, status e regras. */
export function getLibrary(db: Database.Database): LibrarySnapshot {
  return { games: listGames(db), statuses: listStatuses(db), rules: getStatusRules(db) }
}

/** Os jogos, em ordem alfabética (ignorando acentos e maiúsculas). */
export function listGames(db: Database.Database): Game[] {
  const rows = db.prepare("SELECT * FROM games").all() as GameRow[]
  const achievements = progressByGame(db)
  return rows
    .map((row) => toGame(row, achievements.get(row.id) ?? null))
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" }))
}

function toGame(row: GameRow, achievements: AchievementProgress | null): Game {
  // Vale o maior tempo entre o contado pelo app e o registrado pelo emulador (que inclui o que foi
  // jogado fora do app), e a última vez mais recente das duas.
  const seconds = Math.max(row.playtime_seconds, row.emulator_playtime_seconds)
  return {
    id: row.id,
    title: row.title,
    statusId: row.status_id,
    favorite: row.favorite === 1,
    // Jogado por menos de um minuto conta como 1 min (e não como "nunca jogado").
    playtimeMinutes: seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0,
    lastPlayedAt: latest(row.last_played_at, row.emulator_last_played_at),
    addedAt: row.added_at,
    platform: row.platform,
    library: row.library,
    romPath: row.rom_path,
    emulatorId: row.emulator_id,
    description: row.description,
    genres: parseList(row.genres),
    developers: parseList(row.developer),
    publishers: parseList(row.publisher),
    releaseDate: row.release_date,
    coverUrl: gameImageUrl(row, row.cover_image),
    backgroundUrl: gameImageUrl(row, row.background_image),
    metadataUpdatedAt: row.metadata_updated_at,
    rating: row.rating,
    difficulty: row.difficulty,
    review: row.review,
    achievements,
  }
}

/** A data mais recente (ISO) entre duas, ignorando as vazias. */
function latest(a: string | null, b: string | null): string | null {
  if (!a || !b) return a ?? b
  return Date.parse(a) >= Date.parse(b) ? a : b
}

/** Endereço de uma imagem do jogo para a interface (a data do download entra no endereço, para trocar na hora). */
function gameImageUrl(row: GameRow, fileName: string | null): string | null {
  return fileName ? imageUrl(row.id, fileName, row.metadata_updated_at) : null
}

/** Lê uma lista guardada como JSON. Qualquer coisa estranha vira lista vazia. */
function parseList(value: string | null): string[] {
  if (!value) return []
  try {
    const list: unknown = JSON.parse(value)
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

/** Marca ou desmarca um jogo como favorito. */
export function setGameFavorite(db: Database.Database, gameId: number, favorite: boolean): void {
  const result = db.prepare("UPDATE games SET favorite = ? WHERE id = ?").run(favorite ? 1 : 0, gameId)
  if (result.changes === 0) throw new Error(t().errors.gameNotFound)
}

/**
 * Muda a avaliação de um jogo: só as partes enviadas (nota, dificuldade ou análise); null apaga a
 * parte, e a análise vazia também. Quem chama já conferiu os valores (o IPC confere tudo o que vem
 * da interface).
 */
export function saveGameEvaluation(
  db: Database.Database,
  gameId: number,
  changes: GameEvaluation,
  now = new Date()
): void {
  const current = db.prepare("SELECT rating, difficulty, review FROM games WHERE id = ?").get(gameId) as
    | { rating: number | null; difficulty: number | null; review: string | null }
    | undefined
  if (!current) throw new Error(t().errors.gameNotFound)
  const rating = changes.rating === undefined ? current.rating : changes.rating
  const difficulty = changes.difficulty === undefined ? current.difficulty : changes.difficulty
  const review = changes.review === undefined ? current.review : changes.review?.trim() || null
  const empty = rating === null && difficulty === null && review === null
  db.prepare("UPDATE games SET rating = ?, difficulty = ?, review = ?, evaluated_at = ? WHERE id = ?").run(
    rating,
    difficulty,
    review,
    empty ? null : now.toISOString(),
    gameId
  )
}

/** Muda o status de um jogo (ex.: ao arrastar no Kanban). */
export function setGameStatus(db: Database.Database, gameId: number, statusId: number): void {
  assertStatusExists(db, statusId)
  const result = db.prepare("UPDATE games SET status_id = ? WHERE id = ?").run(statusId, gameId)
  if (result.changes === 0) throw new Error(t().errors.gameNotFound)
}

/**
 * Sessões mais curtas que isto não contam: o emulador nem chegou a abrir. Qualquer abertura de
 * verdade conta, mesmo fechando antes de jogar (pedido do usuário em 2026-09-19).
 */
export const MIN_SESSION_SECONDS = 3

/** Um jogo de emulador encontrado na varredura de uma pasta de ROMs. */
export interface EmulatedGame {
  title: string
  romPath: string
  platform: string
  library: string
  emulatorId: EmulatorId
  core: string | null
}

/**
 * Coloca um jogo de emulador na biblioteca, com o status de "jogo novo" (regra automática).
 * Devolve o id do jogo novo, ou null se a ROM já estava na biblioteca.
 */
export function addEmulatedGame(db: Database.Database, game: EmulatedGame): number | null {
  const { newGameStatusId } = getStatusRules(db)
  const result = db
    .prepare(
      `INSERT INTO games (title, status_id, added_at, platform, library, rom_path, emulator_id, core)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(rom_path) DO NOTHING`
    )
    .run(game.title, newGameStatusId, new Date().toISOString(), game.platform, game.library, game.romPath, game.emulatorId, game.core)
  return result.changes > 0 ? Number(result.lastInsertRowid) : null
}

/**
 * Registra uma vez que o jogo foi jogado: soma o tempo, guarda a data e a sessão (para a atividade
 * por dia das Estatísticas). Na primeira vez, se o jogo ainda está no status de "jogo novo", ele vai
 * para o status de "primeiro jogo" (regra automática). Sessões curtas demais (menos de
 * MIN_SESSION_SECONDS) não contam.
 */
export function recordPlaySession(db: Database.Database, gameId: number, seconds: number, endedAt: string): void {
  if (seconds < MIN_SESSION_SECONDS) return
  const game = db.prepare("SELECT status_id, last_played_at FROM games WHERE id = ?").get(gameId) as
    | { status_id: number; last_played_at: string | null }
    | undefined
  if (!game) return

  const rules = getStatusRules(db)
  const firstTime = game.last_played_at === null
  const statusId = firstTime && game.status_id === rules.newGameStatusId ? rules.firstPlayStatusId : game.status_id
  const roundedSeconds = Math.round(seconds)
  const startedAt = new Date(Date.parse(endedAt) - roundedSeconds * 1000).toISOString()
  db.transaction(() => {
    db.prepare(
      "UPDATE games SET playtime_seconds = playtime_seconds + ?, last_played_at = ?, status_id = ? WHERE id = ?"
    ).run(roundedSeconds, endedAt, statusId, gameId)
    db.prepare("INSERT INTO play_sessions (game_id, started_at, ended_at, seconds) VALUES (?, ?, ?, ?)").run(
      gameId,
      startedAt,
      endedAt,
      roundedSeconds
    )
  })()
}

/** O que o app precisa para abrir um jogo de emulador. */
export function getLaunchInfo(
  db: Database.Database,
  gameId: number
): { title: string; romPath: string | null; emulatorId: EmulatorId | null; core: string | null } {
  const row = db.prepare("SELECT title, rom_path, emulator_id, core FROM games WHERE id = ?").get(gameId) as
    | { title: string; rom_path: string | null; emulator_id: EmulatorId | null; core: string | null }
    | undefined
  if (!row) throw new Error(t().errors.gameNotFound)
  return { title: row.title, romPath: row.rom_path, emulatorId: row.emulator_id, core: row.core }
}

// ---------------------------------------------------------------- metadados

/** O que foi encontrado para um jogo nos serviços de metadados. null = não encontrado (o valor antigo fica). */
export interface GameMetadata {
  description: string | null
  genres: string[] | null
  developers: string[] | null
  publishers: string[] | null
  releaseDate: string | null
  igdbId: number | null
  sgdbId: number | null
  /** Nomes dos arquivos das imagens baixadas (as que faltam continuam como estavam). */
  images: Partial<Record<ImageKind, string>>
}

/** O que a busca de metadados precisa saber do jogo. */
export function getMetadataTarget(
  db: Database.Database,
  gameId: number
): { title: string; platform: string | null; romPath: string | null } {
  const row = db.prepare("SELECT title, platform, rom_path FROM games WHERE id = ?").get(gameId) as
    | { title: string; platform: string | null; rom_path: string | null }
    | undefined
  if (!row) throw new Error(t().errors.gameNotFound)
  return { title: row.title, platform: row.platform, romPath: row.rom_path }
}

/**
 * Grava os metadados de um jogo. O que não foi encontrado agora não apaga o que o jogo já tinha.
 * A data do download fica guardada mesmo sem nada encontrado: assim o jogo sai da lista dos "sem metadados".
 */
export function saveGameMetadata(db: Database.Database, gameId: number, metadata: GameMetadata, updatedAt: string): void {
  const list = (values: string[] | null) => (values === null ? null : JSON.stringify(values))
  db.prepare(
    `UPDATE games SET
       description = COALESCE(?, description),
       genres = COALESCE(?, genres),
       developer = COALESCE(?, developer),
       publisher = COALESCE(?, publisher),
       release_date = COALESCE(?, release_date),
       igdb_id = COALESCE(?, igdb_id),
       sgdb_id = COALESCE(?, sgdb_id),
       cover_image = COALESCE(?, cover_image),
       background_image = COALESCE(?, background_image),
       metadata_updated_at = ?
     WHERE id = ?`
  ).run(
    metadata.description,
    list(metadata.genres),
    list(metadata.developers),
    list(metadata.publishers),
    metadata.releaseDate,
    metadata.igdbId,
    metadata.sgdbId,
    metadata.images.cover ?? null,
    metadata.images.background ?? null,
    updatedAt,
    gameId
  )
}

/** Ids dos jogos que nunca tiveram os metadados baixados, em ordem alfabética. */
export function listGamesWithoutMetadata(db: Database.Database): number[] {
  const rows = db.prepare("SELECT id, title FROM games WHERE metadata_updated_at IS NULL").all() as { id: number; title: string }[]
  return rows.sort((a, b) => a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" })).map((row) => row.id)
}

// ---------------------------------------------------------------- status

/** Uma linha da tabela statuses. `preset` diz qual status padrão ela é (null nos criados ou renomeados). */
interface StatusRow {
  id: number
  name: string
  preset: string | null
  position: number
}

function statusRows(db: Database.Database): StatusRow[] {
  return db.prepare("SELECT id, name, preset, position FROM statuses ORDER BY position").all() as StatusRow[]
}

/**
 * O nome de um status no idioma do app: o dos status que vêm com o app sai do dicionário (escolha do
 * usuário em 2026-09-27); o dos outros é o que o usuário escreveu.
 */
function statusName(row: StatusRow): string {
  return isStatusPreset(row.preset) ? t().statusPresets[row.preset] : row.name
}

/** Os nomes que um status tem em todos os idiomas (um status novo não pode repetir nenhum deles). */
function namesInAllLanguages(row: StatusRow): string[] {
  const preset = row.preset
  if (!isStatusPreset(preset)) return [row.name]
  return [row.name, ...LANGUAGES.map((language) => messagesFor(language.id).statusPresets[preset])]
}

/** Os status, na ordem das colunas do Kanban, com o nome no idioma do app. */
export function listStatuses(db: Database.Database): Status[] {
  return statusRows(db).map((row) => ({ id: row.id, name: statusName(row), position: row.position }))
}

/** Cria um status no fim da lista. */
export function createStatus(db: Database.Database, name: string): Status {
  const cleanName = validateStatusName(db, name)
  const position = (db.prepare("SELECT COALESCE(MAX(position) + 1, 0) FROM statuses").pluck().get() as number) ?? 0
  const { lastInsertRowid } = db.prepare("INSERT INTO statuses (name, position) VALUES (?, ?)").run(cleanName, position)
  return { id: Number(lastInsertRowid), name: cleanName, position }
}

/**
 * Troca o nome de um status. Um status padrão renomeado passa a ter o nome que o usuário escreveu,
 * nos dois idiomas.
 */
export function renameStatus(db: Database.Database, id: number, name: string): void {
  const row = statusRows(db).find((status) => status.id === id)
  if (!row) throw new Error(t().errors.statusNotFound)
  const cleanName = validateStatusName(db, name, id)
  // O mesmo nome de agora (ex.: só com espaços a mais): nada muda.
  if (cleanName === statusName(row)) return
  db.prepare("UPDATE statuses SET name = ?, preset = NULL WHERE id = ?").run(cleanName, id)
}

/** Muda a ordem dos status. `ids` tem todos os status, na ordem nova. */
export function reorderStatuses(db: Database.Database, ids: number[]): void {
  const current = listStatuses(db).map((status) => status.id)
  const sameSet = ids.length === current.length && current.every((id) => ids.includes(id))
  if (!sameSet) throw new Error(t().errors.statusOrder)
  const update = db.prepare("UPDATE statuses SET position = ? WHERE id = ?")
  db.transaction(() => ids.forEach((id, position) => update.run(position, id)))()
}

/**
 * Apaga um status. Os jogos dele (e as regras que usavam ele) passam para `moveToId`.
 * O último status que sobrar não pode ser apagado.
 */
export function deleteStatus(db: Database.Database, id: number, moveToId: number): void {
  assertStatusExists(db, id)
  assertStatusExists(db, moveToId)
  if (id === moveToId) throw new Error(t().errors.chooseOtherStatus)

  db.transaction(() => {
    db.prepare("UPDATE games SET status_id = ? WHERE status_id = ?").run(moveToId, id)
    const rules = getStatusRules(db)
    setStatusRules(db, {
      newGameStatusId: rules.newGameStatusId === id ? moveToId : rules.newGameStatusId,
      firstPlayStatusId: rules.firstPlayStatusId === id ? moveToId : rules.firstPlayStatusId,
    })
    db.prepare("DELETE FROM statuses WHERE id = ?").run(id)
    // Refaz as posições (0, 1, 2...) para não ficar um buraco na ordem.
    reorderStatuses(
      db,
      listStatuses(db).map((status) => status.id)
    )
  })()
}

/** As regras automáticas de status. */
export function getStatusRules(db: Database.Database): StatusRules {
  const first = listStatuses(db)[0]?.id ?? 0
  return {
    newGameStatusId: Number(getSetting(db, "newGameStatusId")) || first,
    firstPlayStatusId: Number(getSetting(db, "firstPlayStatusId")) || first,
  }
}

/** Troca as regras automáticas de status. */
export function setStatusRules(db: Database.Database, rules: StatusRules): void {
  assertStatusExists(db, rules.newGameStatusId)
  assertStatusExists(db, rules.firstPlayStatusId)
  setSetting(db, "newGameStatusId", String(rules.newGameStatusId))
  setSetting(db, "firstPlayStatusId", String(rules.firstPlayStatusId))
}

function assertStatusExists(db: Database.Database, id: number): void {
  const exists = db.prepare("SELECT 1 FROM statuses WHERE id = ?").get(id)
  if (!exists) throw new Error(t().errors.statusNotFound)
}

/**
 * Confere o nome de um status: não pode ser vazio, longo demais nem repetir o de outro status, em
 * nenhum dos idiomas (senão, trocando o idioma, duas colunas do Kanban ficariam com o mesmo nome).
 */
function validateStatusName(db: Database.Database, name: string, ignoreId?: number): string {
  const { errors } = t()
  const cleanName = name.trim().replace(/\s+/g, " ")
  if (!cleanName) throw new Error(errors.statusNameEmpty)
  if (cleanName.length > MAX_STATUS_NAME) throw new Error(errors.statusNameTooLong(MAX_STATUS_NAME))
  const repeated = statusRows(db).some(
    (row) =>
      row.id !== ignoreId &&
      namesInAllLanguages(row).some((other) => other.localeCompare(cleanName, "pt-BR", { sensitivity: "base" }) === 0)
  )
  if (repeated) throw new Error(errors.statusNameTaken(cleanName))
  return cleanName
}
