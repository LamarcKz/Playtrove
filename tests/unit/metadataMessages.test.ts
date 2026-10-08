import { describe, expect, it } from "vitest"
import { messagesFor } from "@shared/i18n"
import type { MetadataProgress } from "@shared/types"
import { describeMetadataResult } from "@/lib/metadata"

const pt = messagesFor("pt-BR")
const en = messagesFor("en")

const finished = (changes: Partial<MetadataProgress>): MetadataProgress => ({
  running: false,
  done: 0,
  total: 0,
  current: null,
  found: 0,
  notFound: [],
  errors: [],
  ...changes,
})

describe("aviso no fim do download de metadados", () => {
  it("encontrados e não encontrados", () => {
    expect(describeMetadataResult(finished({ done: 3, total: 3, found: 2, notFound: ["Meu Jogo"] }), pt)).toEqual([
      { kind: "success", title: "Metadados baixados para 2 jogos", description: "Não encontrados: Meu Jogo." },
    ])
    expect(describeMetadataResult(finished({ done: 1, total: 1, found: 1 }), pt)).toEqual([
      { kind: "success", title: "Metadados baixados para 1 jogo", description: undefined },
    ])
  })

  it("nenhum encontrado (a lista longa termina em \"e mais N\")", () => {
    const titles = ["A", "B", "C", "D", "E", "F", "G"]
    expect(describeMetadataResult(finished({ done: 7, total: 7, notFound: titles }), pt)).toEqual([
      { title: "7 jogos não encontrados", description: "A, B, C, D, E e mais 2. Confira se o nome do jogo está certo." },
    ])
  })

  it("em inglês", () => {
    const titles = ["A", "B", "C", "D", "E", "F", "G"]
    expect(describeMetadataResult(finished({ done: 7, total: 7, notFound: titles }), en)).toEqual([
      { title: "7 games not found", description: "A, B, C, D, E and 2 more. Check that the game's name is right." },
    ])
    expect(describeMetadataResult(finished({ done: 2, total: 2, found: 1, notFound: ["Meu Jogo"] }), en)).toEqual([
      { kind: "success", title: "Metadata downloaded for 1 game", description: "Not found: Meu Jogo." },
    ])
  })

  it("erros: parte da leva ou a leva inteira", () => {
    expect(describeMetadataResult(finished({ done: 1, total: 1, errors: ["A chave do SteamGridDB está errada."] }), pt)).toEqual([
      { kind: "error", title: "Não deu para baixar os metadados", description: "A chave do SteamGridDB está errada." },
    ])
    expect(describeMetadataResult(finished({ done: 3, total: 3, found: 2, errors: ["X: erro 500."] }), pt)[1]).toEqual({
      kind: "error",
      title: "Alguns metadados não foram baixados",
      description: "X: erro 500.",
    })
  })
})
