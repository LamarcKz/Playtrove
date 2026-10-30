import { describe, expect, it } from "vitest"
import { AnikiSounds } from "../../src/renderer/lib/anikiSounds"

function audioOutput() {
  const outputs: { src: string; currentTime: number; volume: number; playing: boolean; plays: number }[] = []
  const create = (src: string) => {
    const output = {
      src, currentTime: 0, volume: 1, playing: false, plays: 0,
      play: async () => { output.playing = true; output.plays++ },
      pause: () => { output.playing = false },
      removeAttribute: () => { output.src = "" },
      load: () => {},
    }
    outputs.push(output)
    return output
  }
  return { create, outputs }
}

describe("sons do pacote Aniki", () => {
  it("reproduz os arquivos do pacote no volume escolhido e reinicia o mesmo som ao repetir", () => {
    const fake = audioOutput()
    const sounds = new AnikiSounds(fake.create)
    sounds.play("move", .4)
    expect(fake.outputs).toHaveLength(1)
    expect(fake.outputs[0]).toMatchObject({ src: "http://playtrove-theme.localhost/aniki/audio/navigation.wav", volume: .4, playing: true, plays: 1 })
    fake.outputs[0].currentTime = .5
    sounds.play("move", .7)
    expect(fake.outputs).toHaveLength(1)
    expect(fake.outputs[0]).toMatchObject({ currentTime: 0, volume: .7, plays: 2 })
  })

  it("silencia sem carregar arquivos e interrompe os sons ao suspender ou desmontar", () => {
    const fake = audioOutput()
    const sounds = new AnikiSounds(fake.create)
    sounds.play("confirm", 0)
    expect(fake.outputs).toHaveLength(0)
    sounds.play("confirm", .4)
    sounds.play("details", .4)
    sounds.pause()
    expect(fake.outputs.every((output) => !output.playing)).toBe(true)
    sounds.dispose()
    expect(fake.outputs.every((output) => output.src === "")).toBe(true)
    // A limpeza do StrictMode não impede o próximo setup de usar a mesma instância.
    sounds.play("confirm", .4)
    expect(fake.outputs.at(-1)?.playing).toBe(true)
  })

  it("uma mídia ausente ou uma saída de áudio indisponível não interrompe a navegação", async () => {
    const sounds = new AnikiSounds(() => { throw new Error("sem saída de áudio") })
    expect(() => sounds.play("open", 1)).not.toThrow()
    const blocked = new AnikiSounds(() => ({ src: "", currentTime: 0, volume: 1, play: () => Promise.reject(new Error("mídia indisponível")), pause() {}, removeAttribute() {}, load() {} }))
    blocked.play("open", 1)
    await Promise.resolve()
  })
})
