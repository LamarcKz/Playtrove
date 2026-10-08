import { describe, expect, it } from "vitest"
import { nextVersion } from "../../scripts/next-version.mjs"

describe("npm run versao", () => {
  it("novidade sobe o número do meio", () => {
    const result = nextVersion("v0.2.0", ["feat: adiciona o modo Kanban", "fix: corrige o filtro", "docs: atualiza o README"])
    expect(result.next).toBe("0.3.0")
    expect(result.kind).toBe("novidades")
    expect(result.features).toEqual(["Adiciona o modo Kanban"])
    expect(result.fixes).toEqual(["Corrige o filtro"])
  })
  it("só correções sobem o último número", () => {
    expect(nextVersion("v0.2.0", ["fix: corrige o botão de fechar", "chore: organiza"]).next).toBe("0.2.1")
  })
  it("só texto e organização não pedem versão nova", () => {
    expect(nextVersion("v0.2.1", ["docs: atualiza o guia", "refactor: separa funções"]).next).toBeNull()
  })
  it("mudança que quebra algo (\"!\") conta como novidade antes da 1.0.0", () => {
    expect(nextVersion("v0.2.1", ["refactor!: muda o formato do banco"]).next).toBe("0.3.0")
  })
})
