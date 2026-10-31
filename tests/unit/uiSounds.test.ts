import { describe, expect, it } from "vitest"
import { UI_SOUND_NOTES, UI_SOUND_PROFILES, UiSounds } from "../../src/renderer/lib/uiSounds"

/** Um contexto de áudio de mentira que anota as notas e o volume máximo de cada uma. */
function fakeContext() {
  const notes: { frequency: number; start: number; wave?: string; gain?: { peak: number } }[] = []
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
        set type(value: string) { note.wave = value },
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
  it("cada tema tem o seu som: as notas, a forma da onda e o volume do perfil", () => {
    for (const [theme, profile] of Object.entries(UI_SOUND_PROFILES)) {
      const fake = fakeContext()
      new UiSounds(fake.create).play("open", 1, theme as keyof typeof UI_SOUND_PROFILES)
      expect(fake.notes.map((note) => note.frequency)).toEqual(profile.notes.open.frequencies)
      expect(new Set(fake.notes.map((note) => note.wave))).toEqual(new Set([profile.wave]))
      expect(fake.notes[0].gain?.peak).toBeCloseTo(0.25 * profile.gain)
    }
    // Os quatro soam diferentes entre si.
    const signatures = Object.values(UI_SOUND_PROFILES).map((profile) => profile.wave + profile.notes.move.frequencies.join())
    expect(new Set(signatures).size).toBe(4)
  })

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
