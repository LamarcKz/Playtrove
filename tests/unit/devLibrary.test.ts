import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import { devLibrary } from "../../src/main/devLibrary"
import { makeTempDir, removeTempDirs } from "./helpers"

afterEach(removeTempDirs)

/** Uma biblioteca de verdade: o banco com um jogo, uma capa e a chave das senhas. */
function realLibrary(): string {
  const folder = makeTempDir({ "images/1/cover.png": "capa", "Local State": "chave das senhas" })
  const db = new Database(join(folder, "playtrove.db"))
  db.exec("CREATE TABLE games (title TEXT); INSERT INTO games VALUES ('Salto Estelar')")
  db.close()
  return folder
}

const titles = (file: string) => {
  const db = new Database(file, { readonly: true })
  try {
    return db.prepare("SELECT title FROM games").pluck().all()
  } finally {
    db.close()
  }
}

describe("biblioteca do npm run dev", () => {
  it("na primeira vez, copia o banco, as imagens e a chave das senhas da biblioteca de verdade", () => {
    const real = realLibrary()
    const devFolder = join(makeTempDir(), "Playtrove Dev")

    expect(devLibrary({ folder: real, databaseFile: "playtrove.db" }, devFolder)).toEqual({ folder: devFolder, databaseFile: "playtrove.db" })
    expect(titles(join(devFolder, "playtrove.db"))).toEqual(["Salto Estelar"])
    expect(readFileSync(join(devFolder, "images", "1", "cover.png"), "utf8")).toBe("capa")
    expect(readFileSync(join(devFolder, "Local State"), "utf8")).toBe("chave das senhas")
    // A de verdade continua igual.
    expect(titles(join(real, "playtrove.db"))).toEqual(["Salto Estelar"])
  })

  it("copia mesmo com o app instalado usando a biblioteca de verdade", () => {
    const real = realLibrary()
    const installed = new Database(join(real, "playtrove.db"))
    try {
      const devFolder = join(makeTempDir(), "Playtrove Dev")
      devLibrary({ folder: real, databaseFile: "playtrove.db" }, devFolder)
      expect(titles(join(devFolder, "playtrove.db"))).toEqual(["Salto Estelar"])
    } finally {
      installed.close()
    }
  })

  it("com a cópia já feita, usa ela (as mudanças do dev ficam lá)", () => {
    const real = realLibrary()
    const devFolder = join(makeTempDir(), "Playtrove Dev")
    devLibrary({ folder: real, databaseFile: "playtrove.db" }, devFolder)
    const dev = new Database(join(devFolder, "playtrove.db"))
    dev.exec("INSERT INTO games VALUES ('Jogo de teste')")
    dev.close()

    devLibrary({ folder: real, databaseFile: "playtrove.db" }, devFolder)
    expect(titles(join(devFolder, "playtrove.db"))).toEqual(["Salto Estelar", "Jogo de teste"])
    expect(titles(join(real, "playtrove.db"))).toEqual(["Salto Estelar"])
  })

  it("copia também da pasta antiga, com o banco de nome antigo", () => {
    const real = realLibrary()
    const devFolder = join(makeTempDir(), "Playtrove Dev")
    // A biblioteca de verdade ainda com o nome da época do Bibliotecaofgames (pasta em uso, por exemplo).
    const oldDb = new Database(join(real, "bibliotecaofgames.db"))
    oldDb.exec("CREATE TABLE games (title TEXT); INSERT INTO games VALUES ('Jogo antigo')")
    oldDb.close()
    devLibrary({ folder: real, databaseFile: "bibliotecaofgames.db" }, devFolder)
    expect(titles(join(devFolder, "playtrove.db"))).toEqual(["Jogo antigo"])
  })

  it("sem biblioteca de verdade, a do dev começa vazia", () => {
    const devFolder = join(makeTempDir(), "Playtrove Dev")
    expect(devLibrary({ folder: join(makeTempDir(), "Playtrove"), databaseFile: "playtrove.db" }, devFolder)).toEqual({
      folder: devFolder,
      databaseFile: "playtrove.db",
    })
    expect(existsSync(devFolder)).toBe(true)
    expect(readdirSync(devFolder)).toEqual([])
  })
})
