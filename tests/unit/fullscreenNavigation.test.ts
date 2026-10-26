import { describe, expect, it } from "vitest"
import { FullscreenInput, fullscreenGames, restoreFullscreenSelection, scrollFullscreenText } from "../../src/renderer/lib/fullscreenNavigation"
import { editFullscreenText } from "../../src/renderer/lib/fullscreenText"

const snapshot = (sequence: number, buttons: string[], generation = 1) => ({ sequence, generation, controllerKey: 7, buttons })

describe("entrada fullscreen", () => {
  it("exige neutro inicial e não repete confirmar/voltar", () => {
    const input = new FullscreenInput()
    expect(input.update(snapshot(1, ["cross"]), 0)).toEqual([])
    input.update(snapshot(2, []), 0)
    expect(input.update(snapshot(3, ["cross"]), 10)).toEqual(["cross"])
    expect(input.repeat(1000)).toEqual([])
    input.reset()
    expect(input.update(snapshot(4, ["cross"]), 1100)).toEqual([])
    input.update(snapshot(5, []), 1200)
    expect(input.update(snapshot(6, ["circle"]), 1300)).toEqual(["circle"])
    expect(input.repeat(3000)).toEqual([])
  })
  it("repete somente direções e descarta snapshots antigos e gerações anteriores", () => {
    const input = new FullscreenInput()
    input.update(snapshot(1, []), 0)
    expect(input.update(snapshot(2, ["right"]), 10)).toEqual(["right"])
    expect(input.repeat(300)).toEqual([])
    expect(input.repeat(450)).toEqual(["right"])
    expect(input.update(snapshot(1, ["cross"]), 500)).toEqual([])
    expect(input.update(snapshot(3, ["cross"], 2), 600)).toEqual([])
    input.update(snapshot(4, [], 2), 650)
    expect(input.update(snapshot(5, ["cross"], 1), 700)).toEqual([])
    expect(input.update(snapshot(6, ["cross"], 2), 750)).toEqual(["cross"])
  })
})
describe("contexto da biblioteca fullscreen", () => {
  const games = [{ id: 1, title: "Ação", favorite: false, lastPlayedAt: null }, { id: 2, title: "Outro", favorite: true, lastPlayedAt: null }]
  it("busca global ignora a coleção sem a alterar", () => {
    expect(fullscreenGames(games, "favorites", "acao").map((g) => g.id)).toEqual([1])
    expect(fullscreenGames(games, "favorites", "").map((g) => g.id)).toEqual([2])
  })
  it("retorna pelo ID, inclusive após reordenação e remoção", () => {
    expect(restoreFullscreenSelection([{ id: 2 }, { id: 1 }], 1)).toBe(1)
    expect(restoreFullscreenSelection([{ id: 2 }], 1)).toBe(2)
    expect(restoreFullscreenSelection([], 1)).toBeNull()
  })
})
describe("edição QWERTY", () => {
  it("edita no cursor sem cortar Unicode e substitui a seleção", () => {
    expect(editFullscreenText({ text: "a😀é", start: 3, end: 3 }, "backspace")).toEqual({ text: "aé", start: 1, end: 1 })
    expect(editFullscreenText({ text: "a😀é", start: 1, end: 3 }, "ç")).toEqual({ text: "açé", start: 2, end: 2 })
    expect(editFullscreenText({ text: "a😀é", start: 3, end: 3 }, "left").start).toBe(1)
  })
  it("limita em 10000 UTF16 sem criar surrogate isolado e não altera o original", () => {
    const original = { text: "a".repeat(9999), start: 9999, end: 9999 }
    expect(editFullscreenText(original, "😀").text).toBe(original.text)
    expect(editFullscreenText(original, "é").text.length).toBe(10000)
    expect(original.text.length).toBe(9999)
  })
})

// Regressões: uma conexão velha não deve rearmar uma sessão nova nem manter uma direção em repetição.
describe("interrupções da entrada", () => {
  it("interrompe repetição ao desconectar e exige neutro ao reconectar", () => {
    const input = new FullscreenInput()
    input.update(snapshot(1, []), 0)
    input.update(snapshot(2, ["right"]), 1)
    input.update({ ...snapshot(3, []), controllerKey: null }, 100)
    expect(input.repeat(500)).toEqual([])
    expect(input.update(snapshot(4, ["cross"], 2), 600)).toEqual([])
    input.update(snapshot(5, [], 2), 650)
    expect(input.update(snapshot(6, ["cross"], 2), 700)).toEqual(["cross"])
  })
  it("snapshot inicial antigo neutro não rearma confirmação mantida", () => {
    const input = new FullscreenInput()
    input.update(snapshot(10, []), 0)
    input.update(snapshot(11, ["cross"]), 1)
    input.reset()
    input.update(snapshot(9, []), 2)
    expect(input.update(snapshot(12, ["cross"]), 3)).toEqual([])
  })
  it("retornar a um contexto já neutro aceita a próxima aresta sem descartar a primeira pressão", () => {
    const input = new FullscreenInput()
    input.update(snapshot(1, []), 0)
    input.reset(true)
    expect(input.update(snapshot(2, ["cross"]), 1)).toEqual(["cross"])
  })
})

// A descrição recebe rolagem intencional antes de a direção sair para outra região.
describe("rolagem fullscreen", () => {
  it("desce o texto e entrega a navegação espacial ao chegar à borda", () => {
    const panel = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }
    expect(scrollFullscreenText(panel, "down")).toBe(true)
    expect(panel.scrollTop).toBe(130)
    panel.scrollTop = 790
    expect(scrollFullscreenText(panel, "down")).toBe(true)
    expect(panel.scrollTop).toBe(800)
    expect(scrollFullscreenText(panel, "down")).toBe(false)
  })
  it("sobe até o início, sem consumir horizontal ou painel sem overflow", () => {
    const panel = { scrollTop: 90, scrollHeight: 1000, clientHeight: 200 }
    expect(scrollFullscreenText(panel, "up")).toBe(true)
    expect(panel.scrollTop).toBe(0)
    expect(scrollFullscreenText(panel, "up")).toBe(false)
    expect(scrollFullscreenText(panel, "right")).toBe(false)
    expect(scrollFullscreenText({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 }, "down")).toBe(false)
  })
})
