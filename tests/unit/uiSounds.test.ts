import { describe, expect, it } from "vitest"
import { UI_SOUND_NOTES, UiSounds } from "../../src/renderer/lib/uiSounds"

/** Um contexto de áudio de mentira que anota as notas e o volume máximo de cada uma. */
function fakeContext() {
  const notes: { frequency: number; start: number; gain?: { peak: number } }[] = []
  let created = 0
  let resumed = 0
  const context = {
    currentTime: 2,
    destination: {},
    state: "suspended",
    resume: async () => { resumed++ },
    close: async () => {},
    createOscillator: () => {
      const note: (typeof notes)[number] = { frequency: 0, start: 0 }
      notes.push(note)
      return {
        type: "sine",
        frequency: { setValueAtTime: (value: number) => { note.frequency = value } },
        connect: (gain: { peak: number }) => { note.gain = gain; return gain },
        start: (time: number) => { note.start = time },
        stop: () => {},
      }
    },
    createGain: () => {
      const gain: { peak: number; gain: object; connect: () => void } = {
        peak: 0,
        gain: { setValueAtTime: () => {}, linearRampToValueAtTime: (value: number) => { gain.peak = value }, exponentialRampToValueAtTime: () => {} },
        connect: () => {},
      }
      return gain
    },
  }
  const create = () => { created++; return context as unknown as AudioContext }
  return { notes, create, created: () => created, resumed: () => resumed }
}

describe("sons da navegação", () => {
  it("toca as notas de cada som em sequência, no volume escolhido", () => {
    const fake = fakeContext()
    const sounds = new UiSounds(fake.create)
    sounds.play("confirm", 0.4)
    expect(fake.notes.map((note) => note.frequency)).toEqual(UI_SOUND_NOTES.confirm.frequencies)
    expect(fake.notes.map((note) => note.start)).toEqual([2, 2 + UI_SOUND_NOTES.confirm.duration])
    expect(fake.notes[0].gain?.peak).toBeCloseTo(0.1)
    expect(fake.resumed()).toBe(1)
  })

  it("com volume zero não toca nada nem cria o contexto de áudio", () => {
    const fake = fakeContext()
    const sounds = new UiSounds(fake.create)
    sounds.play("move", 0)
    expect(fake.created()).toBe(0)
    sounds.play("move", 1)
    sounds.play("back", 1)
    expect(fake.created()).toBe(1)
    expect(fake.notes).toHaveLength(3)
  })

  it("sem áudio no computador, fica em silêncio sem atrapalhar quem chamou", () => {
    let attempts = 0
    const sounds = new UiSounds(() => { attempts++; throw new Error("sem saída de áudio") })
    expect(() => sounds.play("confirm", 1)).not.toThrow()
    expect(() => sounds.play("move", 1)).not.toThrow()
    expect(attempts).toBe(1)
  })
})
