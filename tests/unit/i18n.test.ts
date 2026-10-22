import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { genreLabel, isLanguage, LANGUAGES, messagesFor } from "@shared/i18n"

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
})
