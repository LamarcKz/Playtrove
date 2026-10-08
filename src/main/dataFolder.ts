import { existsSync, readdirSync, renameSync, rmdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

/** O arquivo do banco, dentro da pasta de dados. */
export const DATABASE_FILE = "playtrove.db"

/** O arquivo que deixa o app portátil (vem no .zip): com ele ao lado do .exe, os dados ficam ali do lado. */
export const PORTABLE_MARKER = "portable.txt"

/**
 * A pasta de dados da versão portátil: "data", ao lado do .exe, quando o portable.txt está lá (como
 * nos emuladores portáteis). null se não for a portátil.
 */
export function portableDataFolder(exePath: string, exists: (path: string) => boolean = existsSync): string | null {
  const folder = dirname(exePath)
  return exists(join(folder, PORTABLE_MARKER)) ? join(folder, "data") : null
}

/** Até a versão 0.4.0, o app se chamava Bibliotecaofgames: era o nome da pasta de dados e do banco. */
const OLD_FOLDER = "Bibliotecaofgames"
const OLD_DATABASE = "bibliotecaofgames.db"

/** Onde o Electron guarda a chave que tranca as senhas (as chaves das APIs): tem que ir junto com o banco. */
const KEY_FILE = "Local State"

/** Os arquivos que o SQLite pode deixar ao lado do banco (o nome do banco + o sufixo). */
const DATABASE_SIDE_FILES = ["-journal", "-wal", "-shm"]

/** Onde ficam os dados desta vez: a pasta (banco, imagens e a chave das senhas) e o banco dentro dela. */
export interface DataLocation {
  folder: string
  databaseFile: string
}

/** O que a mudança da pasta antiga usa do disco (os testes passam um de mentira). */
export interface FolderOps {
  exists(path: string): boolean
  list(folder: string): string[]
  /** Move um arquivo ou pasta (um arquivo que já existe no destino é substituído). */
  move(from: string, to: string): void
  /** Apaga a pasta só se ela estiver vazia. */
  removeIfEmpty(folder: string): void
}

const DISK: FolderOps = {
  exists: existsSync,
  list: (folder) => readdirSync(folder),
  move: renameSync,
  removeIfEmpty: (folder) => rmdirSync(folder),
}

/**
 * Descobre onde estão os dados. Na primeira vez com o nome novo, o que estava na pasta da época do
 * Bibliotecaofgames (%APPDATA%\Bibliotecaofgames) passa para a do Playtrove: o banco, as imagens e a
 * chave que tranca as senhas; e o banco ganha o nome novo. Só move, nada é apagado. Se outro programa
 * estiver usando a pasta antiga, usa ela mesma desta vez e tenta de novo na próxima.
 */
export function locateData(appData: string, userData: string, disk: FolderOps = DISK): DataLocation {
  const current = { folder: userData, databaseFile: DATABASE_FILE }
  const oldFolder = join(appData, OLD_FOLDER)
  // Ainda com o nome antigo (a pasta de dados é a própria pasta antiga): nada muda de lugar.
  if (samePath(oldFolder, userData)) {
    return { folder: userData, databaseFile: disk.exists(join(userData, DATABASE_FILE)) ? DATABASE_FILE : OLD_DATABASE }
  }
  if (disk.exists(join(userData, DATABASE_FILE))) return current

  if (!disk.exists(join(userData, OLD_DATABASE)) && disk.exists(join(oldFolder, OLD_DATABASE))) {
    if (!moveOldFolder(oldFolder, userData, disk)) return { folder: oldFolder, databaseFile: OLD_DATABASE }
  }

  // O banco com o nome antigo, já na pasta nova: ganha o nome novo.
  if (!disk.exists(join(userData, OLD_DATABASE))) return current
  try {
    disk.move(join(userData, OLD_DATABASE), join(userData, DATABASE_FILE))
  } catch {
    return { folder: userData, databaseFile: OLD_DATABASE }
  }
  for (const suffix of DATABASE_SIDE_FILES) {
    const side = join(userData, OLD_DATABASE + suffix)
    if (disk.exists(side)) tryMove(side, join(userData, DATABASE_FILE + suffix), disk)
  }
  return current
}

/**
 * Passa a pasta antiga para o lugar da nova. Normalmente a nova já existe (o Electron a cria, vazia,
 * antes de o app começar), então vai item por item: o banco e a chave das senhas juntos, ou nenhum dos
 * dois; sem o banco, a pasta nova não tem nada da biblioteca, então a chave antiga vale mais que a que
 * estiver lá. O resto vai se der, sem substituir o que já existir. Devolve se o banco foi.
 */
function moveOldFolder(from: string, to: string, disk: FolderOps): boolean {
  if (!disk.exists(to)) {
    try {
      disk.move(from, to)
      return true
    } catch {
      return false
    }
  }
  const moved: { from: string; to: string }[] = []
  try {
    for (const name of [OLD_DATABASE, KEY_FILE]) {
      if (!disk.exists(join(from, name))) continue
      disk.move(join(from, name), join(to, name))
      moved.push({ from: join(from, name), to: join(to, name) })
    }
  } catch {
    for (const item of moved.reverse()) tryMove(item.to, item.from, disk)
    return false
  }
  for (const name of disk.list(from)) {
    const target = join(to, name)
    if (!disk.exists(target)) tryMove(join(from, name), target, disk)
  }
  try {
    disk.removeIfEmpty(from)
  } catch {
    // Sobrou alguma coisa lá (que não deu para mover): a pasta fica.
  }
  return true
}

/** Move se der; se não der, o arquivo fica onde está (nada se perde). */
function tryMove(from: string, to: string, disk: FolderOps): void {
  try {
    disk.move(from, to)
  } catch {
    // Continua onde estava.
  }
}

/** Os dois caminhos apontam para a mesma pasta? (No Windows, maiúsculas e minúsculas não contam.) */
function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase()
}
