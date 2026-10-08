import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { DATABASE_FILE, locateData, portableDataFolder, type FolderOps } from "../../src/main/dataFolder"
import { makeTempDir, removeTempDirs } from "./helpers"

afterEach(removeTempDirs)

/** Uma pasta como a %APPDATA%, com a pasta de dados da época do Bibliotecaofgames. */
function appDataWithOldFolder(extra: Record<string, string> = {}): string {
  return makeTempDir({
    "Bibliotecaofgames/bibliotecaofgames.db": "banco",
    "Bibliotecaofgames/images/12/cover.png": "capa",
    "Bibliotecaofgames/Local State": "chave das senhas",
    ...extra,
  })
}

/** O disco de verdade, mas com os movimentos de alguns nomes falhando (arquivo em uso). */
function diskFailingFor(...names: string[]): FolderOps {
  return {
    exists: existsSync,
    list: (folder) => readdirSync(folder),
    move: (from, to) => {
      if (names.some((name) => from.endsWith(name))) throw new Error("EBUSY")
      renameSync(from, to)
    },
    removeIfEmpty: (folder) => rmdirSync(folder),
  }
}

const read = (...path: string[]) => readFileSync(join(...path), "utf8")

describe("pasta de dados da época do Bibliotecaofgames", () => {
  it("passa para a pasta vazia que o Electron criou, com tudo dentro, e o banco ganha o nome novo", () => {
    const appData = appDataWithOldFolder()
    const userData = join(appData, "Playtrove")
    mkdirSync(userData)

    expect(locateData(appData, userData)).toEqual({ folder: userData, databaseFile: DATABASE_FILE })
    expect(read(userData, "playtrove.db")).toBe("banco")
    expect(read(userData, "images", "12", "cover.png")).toBe("capa")
    expect(read(userData, "Local State")).toBe("chave das senhas")
    expect(existsSync(join(appData, "Bibliotecaofgames"))).toBe(false)
  })

  it("sem a pasta nova, a antiga muda de nome inteira", () => {
    const appData = appDataWithOldFolder()
    const userData = join(appData, "Playtrove")
    expect(locateData(appData, userData)).toEqual({ folder: userData, databaseFile: DATABASE_FILE })
    expect(read(userData, "playtrove.db")).toBe("banco")
    expect(read(userData, "Local State")).toBe("chave das senhas")
    expect(existsSync(join(appData, "Bibliotecaofgames"))).toBe(false)
  })

  it("o diário do banco vai junto, com o nome novo", () => {
    const appData = appDataWithOldFolder({ "Bibliotecaofgames/bibliotecaofgames.db-journal": "diário" })
    const userData = join(appData, "Playtrove")
    mkdirSync(userData)
    locateData(appData, userData)
    expect(read(userData, "playtrove.db-journal")).toBe("diário")
  })

  it("a chave das senhas da pasta antiga vale mais que a que o Electron acabou de criar", () => {
    const appData = appDataWithOldFolder({ "Playtrove/Local State": "chave nova, sem nada trancado" })
    const userData = join(appData, "Playtrove")
    locateData(appData, userData)
    expect(read(userData, "Local State")).toBe("chave das senhas")
  })

  it("o resto não substitui o que já está na pasta nova: fica na antiga", () => {
    const appData = appDataWithOldFolder({ "Bibliotecaofgames/Crashpad/antigo": "", "Playtrove/Crashpad/novo": "" })
    const userData = join(appData, "Playtrove")
    locateData(appData, userData)
    expect(read(userData, "playtrove.db")).toBe("banco")
    expect(readdirSync(join(userData, "Crashpad"))).toEqual(["novo"])
    expect(readdirSync(join(appData, "Bibliotecaofgames", "Crashpad"))).toEqual(["antigo"])
  })

  it("com o banco do Playtrove já no lugar, não mexe em nada", () => {
    const appData = appDataWithOldFolder({ "Playtrove/playtrove.db": "banco novo" })
    const userData = join(appData, "Playtrove")
    expect(locateData(appData, userData)).toEqual({ folder: userData, databaseFile: DATABASE_FILE })
    expect(read(userData, "playtrove.db")).toBe("banco novo")
    expect(read(appData, "Bibliotecaofgames", "bibliotecaofgames.db")).toBe("banco")
  })

  it("sem a pasta antiga, não cria nada", () => {
    const appData = makeTempDir()
    const userData = join(appData, "Playtrove")
    expect(locateData(appData, userData)).toEqual({ folder: userData, databaseFile: DATABASE_FILE })
    expect(existsSync(userData)).toBe(false)
  })

  it("ainda com o nome antigo, usa o banco antigo e não muda nada de lugar", () => {
    const appData = appDataWithOldFolder()
    const userData = join(appData, "Bibliotecaofgames")
    expect(locateData(appData, userData)).toEqual({ folder: userData, databaseFile: "bibliotecaofgames.db" })
    expect(read(userData, "bibliotecaofgames.db")).toBe("banco")
  })

  it("com o banco em uso por outro programa, usa a pasta antiga desta vez", () => {
    const appData = appDataWithOldFolder()
    const userData = join(appData, "Playtrove")
    mkdirSync(userData)
    expect(locateData(appData, userData, diskFailingFor("bibliotecaofgames.db"))).toEqual({
      folder: join(appData, "Bibliotecaofgames"),
      databaseFile: "bibliotecaofgames.db",
    })
    expect(readdirSync(userData)).toEqual([])
  })

  it("se a chave das senhas não puder ir, o banco volta e a pasta antiga é usada desta vez", () => {
    const appData = appDataWithOldFolder()
    const userData = join(appData, "Playtrove")
    mkdirSync(userData)
    expect(locateData(appData, userData, diskFailingFor("Local State"))).toEqual({
      folder: join(appData, "Bibliotecaofgames"),
      databaseFile: "bibliotecaofgames.db",
    })
    expect(read(appData, "Bibliotecaofgames", "bibliotecaofgames.db")).toBe("banco")
    expect(readdirSync(userData)).toEqual([])
  })

  it("uma mudança que parou no meio termina: o banco com o nome antigo na pasta nova ganha o nome novo", () => {
    const appData = makeTempDir({ "Playtrove/bibliotecaofgames.db": "banco", "Playtrove/images/1/cover.png": "" })
    const userData = join(appData, "Playtrove")
    expect(locateData(appData, userData)).toEqual({ folder: userData, databaseFile: DATABASE_FILE })
    expect(read(userData, "playtrove.db")).toBe("banco")
  })
})

describe("versão portátil", () => {
  const exe = join("D:", "Jogos", "Playtrove", "Playtrove.exe")
  const folder = join("D:", "Jogos", "Playtrove")

  it("com o portable.txt ao lado do .exe, os dados ficam na pasta data, ali do lado", () => {
    expect(portableDataFolder(exe, (path) => path === join(folder, "portable.txt"))).toBe(join(folder, "data"))
  })

  it("sem o portable.txt, não é a portátil", () => {
    expect(portableDataFolder(exe, () => false)).toBeNull()
  })
})
