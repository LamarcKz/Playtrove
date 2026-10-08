import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  genreLabel,
  isLanguage,
  isStatusPreset,
  languageFromSystem,
  LANGUAGES,
  messagesFor,
  type Messages,
} from "@shared/i18n"
import { getLanguage, loadLanguage, saveLanguage, setCurrentLanguage } from "../../src/main/i18n"
import { createStatus, listGames, listStatuses, renameStatus } from "../../src/main/library"
import { DEFAULT_STATUSES, runMigrations } from "../../src/main/migrations"
import { describeRepair } from "../../src/main/repairNotice"
import { getSetting } from "../../src/main/settings"
import { memoryDatabase } from "./helpers"
import Database from "better-sqlite3"

// O idioma do processo principal fica na memória: cada teste que troca volta ao português.
afterEach(() => setCurrentLanguage("pt-BR"))

const pt = messagesFor("pt-BR")
const en = messagesFor("en")

/** O formato de um dicionário: as chaves, com o tipo de cada valor (as listas podem ter tamanhos diferentes). */
function shape(value: unknown): unknown {
  if (typeof value === "function") return "função"
  if (Array.isArray(value)) return "lista"
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape((value as Record<string, unknown>)[key])]))
  }
  return typeof value
}

/** Todos os textos de um dicionário: os fixos e o resultado de cada função (com 2 em cada argumento). */
function allTexts(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]]
  if (typeof value === "function") {
    const result: unknown = value(...Array.from({ length: value.length }, () => 2))
    return [[`${path}()`, String(result)]]
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => allTexts(item, `${path}[${index}]`))
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => allTexts(item, path ? `${path}.${key}` : key))
  }
  return []
}

describe("os dicionários", () => {
  it("o inglês tem as mesmas chaves do português, inclusive os gêneros", () => {
    expect(shape(en)).toEqual(shape(pt))
  })

  it("nenhum texto vazio", () => {
    for (const messages of [pt, en]) {
      expect(allTexts(messages).filter(([, text]) => text.trim() === "")).toEqual([])
    }
  })

  it("o inglês não tem sobra de português", () => {
    const portuguese = /[ãõçáéíóúâêôà]|\b(de|do|da|não|jogo|jogos|para|com|você|ou|em)\b/i
    expect(allTexts(en).filter(([, text]) => portuguese.test(text))).toEqual([])
  })

  it("os dois idiomas para escolher, cada um com o nome na própria língua", () => {
    expect(LANGUAGES.map((language) => [language.id, language.name])).toEqual([
      ["pt-BR", "Português (Brasil)"],
      ["en", "English"],
    ])
    expect(isLanguage("en")).toBe(true)
    expect(isLanguage("es")).toBe(false)
    expect(isLanguage(null)).toBe(false)
  })

  it("gênero do IGDB no idioma do app (o que o dicionário não tem fica como veio)", () => {
    expect(genreLabel("Racing", pt)).toBe("Corrida")
    expect(genreLabel("Racing", en)).toBe("Racing")
    expect(genreLabel("Role-playing (RPG)", en)).toBe("RPG")
    expect(genreLabel("Sandbox", pt)).toBe("Sandbox")
    expect(genreLabel("toString", pt)).toBe("toString")
  })
})

describe("o idioma do Windows (escolha do usuário: igual ao Windows na primeira vez)", () => {
  it("português → português; qualquer outro → inglês; vale o idioma principal", () => {
    expect(languageFromSystem(["pt-BR", "en-US"])).toBe("pt-BR")
    expect(languageFromSystem(["pt-PT"])).toBe("pt-BR")
    expect(languageFromSystem(["en-US", "pt-BR"])).toBe("en")
    expect(languageFromSystem(["es-ES"])).toBe("en")
    expect(languageFromSystem(["ja"])).toBe("en")
    expect(languageFromSystem([])).toBe("pt-BR")
  })

  it("sem escolha salva, usa o do Windows; depois de escolher, vale a escolha", () => {
    const db = memoryDatabase()
    expect(loadLanguage(db, ["en-US"])).toBe("en")
    expect(getSetting(db, "language")).toBeNull()
    saveLanguage(db, "pt-BR")
    expect(getSetting(db, "language")).toBe("pt-BR")
    expect(loadLanguage(db, ["en-US"])).toBe("pt-BR")
    expect(getLanguage()).toBe("pt-BR")
  })
})

describe("os status padrão mudam de nome com o idioma (escolha do usuário)", () => {
  const presetNames = (messages: Messages) => Object.values(messages.statusPresets)

  it("banco novo: os 9 status em português e em inglês", () => {
    const db = memoryDatabase()
    expect(listStatuses(db).map((status) => status.name)).toEqual(DEFAULT_STATUSES)
    expect(presetNames(pt)).toEqual(DEFAULT_STATUSES)
    setCurrentLanguage("en")
    expect(listStatuses(db).map((status) => status.name)).toEqual([
      "Plan to play",
      "On hold",
      "Abandoned",
      "Playing",
      "Going for 100%",
      "Going for platinum",
      "Beaten",
      "100%",
      "Platinum",
    ])
    expect(isStatusPreset("beaten")).toBe(true)
    expect(isStatusPreset("Zerado")).toBe(false)
  })

  it("renomeado ou criado pelo usuário: o nome fica igual nos dois idiomas", () => {
    const db = memoryDatabase()
    const [planToPlay, , , playing] = listStatuses(db)
    renameStatus(db, planToPlay.id, "Quero jogar")
    createStatus(db, "Rejogando")
    // Renomear para o mesmo nome (só com espaços a mais) não tira o status do padrão.
    renameStatus(db, playing.id, "  Jogando ")
    setCurrentLanguage("en")
    const names = listStatuses(db).map((status) => status.name)
    expect(names[0]).toBe("Quero jogar")
    expect(names[3]).toBe("Playing")
    expect(names.at(-1)).toBe("Rejogando")
  })

  it("um status novo não pode repetir o nome de outro em nenhum dos idiomas", () => {
    const db = memoryDatabase()
    expect(() => createStatus(db, "Playing")).toThrow('Já existe um status chamado "Playing".')
    expect(() => createStatus(db, "zerado")).toThrow("Já existe um status chamado")
    setCurrentLanguage("en")
    expect(() => createStatus(db, "Jogando")).toThrow('There\'s already a status called "Jogando".')
  })
})

describe("migração 8: bancos de antes dos idiomas", () => {
  it("marca os status padrão (menos os renomeados) e volta os gêneros para o nome do IGDB", () => {
    const db = new Database(":memory:")
    runMigrations(db, 7)
    db.prepare("UPDATE statuses SET name = 'Terminado' WHERE name = 'Zerado'").run()
    const statusId = db.prepare("SELECT id FROM statuses LIMIT 1").pluck().get()
    db.prepare("INSERT INTO games (title, status_id, added_at, genres) VALUES (?, ?, ?, ?)").run(
      "Salto Estelar",
      statusId,
      new Date().toISOString(),
      JSON.stringify(["Plataforma", "Aventura", "Arcade", "Gênero Novo"])
    )
    db.prepare("INSERT INTO games (title, status_id, added_at, genres) VALUES (?, ?, ?, ?)").run(
      "Sem gêneros",
      statusId,
      new Date().toISOString(),
      "isto não é uma lista"
    )

    runMigrations(db)

    expect(db.pragma("user_version", { simple: true })).toBe(8)
    const presets = db.prepare("SELECT name, preset FROM statuses ORDER BY position").all()
    expect(presets).toContainEqual({ name: "Terminado", preset: null })
    expect(presets).toContainEqual({ name: "Planejo jogar", preset: "planToPlay" })
    expect(presets.filter((row) => (row as { preset: string | null }).preset !== null)).toHaveLength(8)
    expect(listGames(db).map((game) => game.genres)).toEqual([["Platform", "Adventure", "Arcade", "Gênero Novo"], []])
    setCurrentLanguage("en")
    expect(listStatuses(db).map((status) => status.name)).toContain("Terminado")
    expect(listStatuses(db).map((status) => status.name)).toContain("On hold")
  })
})

describe("os textos do processo principal no idioma do app", () => {
  it("os erros saem no idioma escolhido", () => {
    const db = memoryDatabase()
    expect(() => createStatus(db, " ")).toThrow("O status precisa de um nome.")
    setCurrentLanguage("en")
    expect(() => createStatus(db, " ")).toThrow("The status needs a name.")
  })

  it("o aviso do conserto do banco em inglês", () => {
    setCurrentLanguage("en")
    const { message, detail } = describeRepair({
      recovered: [{ table: "games", rows: 7 }],
      lost: ["emulators"],
      damagedFile: "C:\\dados\\playtrove-danificado.db",
    })
    expect(message).toBe("The library database was damaged and has been repaired.")
    expect(detail).toContain("Recovered: games (7).")
    expect(detail).toContain("Couldn't recover: emulators. Because of that, the emulators will be searched for again.")
  })
})

// ---------------------------------------------------------------- texto fora dos dicionários

const ROOT = join(__dirname, "..", "..")

/** Os arquivos .ts e .tsx de uma pasta (e das subpastas). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

/** O código sem os comentários (que são em português de propósito), com as linhas no lugar. */
function withoutComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

/** As linhas de um arquivo (sem comentários) que batem com o padrão, como "arquivo:linha: texto". */
function findLines(files: string[], pattern: RegExp, allowed: string[] = []): string[] {
  return files.flatMap((file) =>
    withoutComments(readFileSync(file, "utf-8"))
      .split("\n")
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => pattern.test(line) && !allowed.some((text) => line.includes(text)))
      .map(({ line, index }) => `${relative(ROOT, file)}:${index + 1}: ${line.trim()}`)
  )
}

describe("todo texto da tela vem dos dicionários", () => {
  const accents = /[ãõçáéíóúâêôàÁÉÍÓÚÃÕÇ]/

  it("a interface não tem texto em português fora deles", () => {
    expect(findLines(sourceFiles(join(ROOT, "src", "renderer")), accents)).toEqual([])
  })

  it("a interface não tem texto solto nos atributos que aparecem na tela", () => {
    const literalAttribute = /\b(aria-label|placeholder|title|label|description)="[^"]*[A-Za-z][^"]*"/
    expect(findLines(sourceFiles(join(ROOT, "src", "renderer")), literalAttribute, ['aria-label="libretro-thumbnails"'])).toEqual([])
  })

  it("a interface não tem texto solto entre as tags (só os nomes próprios)", () => {
    const literalText = />[^<>{}]*[A-Za-z]{2,}[^<>{}]*<\//
    const names = [">libretro-thumbnails<", ">Playtrove<"]
    const components = sourceFiles(join(ROOT, "src", "renderer")).filter((file) => file.endsWith(".tsx"))
    expect(findLines(components, literalText, names)).toEqual([])
  })

  it("o processo principal não tem mensagem em português fora deles (só erros internos, que não aparecem)", () => {
    const internal = ['"Não é um TROPUSR.DAT."', '"Não é um PARAM.SFO."', '"O banco ainda não foi aberto', "console.error("]
    // As migrações guardam os nomes antigos de propósito; os jogos de exemplo são dados dos testes.
    const main = sourceFiles(join(ROOT, "src", "main")).filter(
      (file) => !file.endsWith("migrations.ts") && !file.endsWith("sampleGames.ts")
    )
    expect(findLines(main, /["'`][^"'`]*[ãõçáéíóúâêô][^"'`]*["'`]/, internal)).toEqual([])
  })
})
