import type { FullscreenTheme } from "@shared/fullscreen"

/** Os sons da navegação da tela cheia: tons curtos criados na hora pelo Web Audio, sem arquivos. Cada tema tem os seus. */
export type UiSound = "move" | "confirm" | "back" | "open"

interface SoundNotes { frequencies: number[]; duration: number }
interface SoundProfile { wave: OscillatorType; notes: Record<UiSound, SoundNotes>; gain: number }

/** As notas de cada som do tema Playtrove (Hz), tocadas em sequência, e quanto dura cada uma (segundos). */
export const UI_SOUND_NOTES: Record<UiSound, SoundNotes> = {
  move: { frequencies: [880], duration: 0.04 },
  confirm: { frequencies: [660, 990], duration: 0.06 },
  back: { frequencies: [740, 494], duration: 0.06 },
  open: { frequencies: [523, 784], duration: 0.08 },
}
/** O volume 100% da preferência vira este ganho: os sons ficam baixos perto da música tema. */
const MAX_GAIN = 0.25

/**
 * O som de cada tema: Horizonte suave e aveludado (senoide, notas mais longas), Mosaico em cliques curtos e estalados
 * (quadrada, bem curta e mais baixa, porque a onda quadrada soa mais alto) e Painel grave e encorpado (dente de serra,
 * uma oitava abaixo, mais baixo pelo mesmo motivo).
 */
export const UI_SOUND_PROFILES: Record<FullscreenTheme, SoundProfile> = {
  playtrove: { wave: "triangle", notes: UI_SOUND_NOTES, gain: 1 },
  horizonte: {
    wave: "sine",
    gain: 1,
    notes: {
      move: { frequencies: [1046], duration: 0.07 },
      confirm: { frequencies: [784, 1175], duration: 0.09 },
      back: { frequencies: [880, 659], duration: 0.09 },
      open: { frequencies: [587, 880, 1175], duration: 0.08 },
    },
  },
  mosaico: {
    wave: "square",
    gain: 0.45,
    notes: {
      move: { frequencies: [1568], duration: 0.018 },
      confirm: { frequencies: [1318, 1976], duration: 0.03 },
      back: { frequencies: [1318, 988], duration: 0.03 },
      open: { frequencies: [1175, 1568], duration: 0.035 },
    },
  },
  painel: {
    wave: "sawtooth",
    gain: 0.5,
    notes: {
      move: { frequencies: [440], duration: 0.05 },
      confirm: { frequencies: [330, 494], duration: 0.07 },
      back: { frequencies: [370, 247], duration: 0.07 },
      open: { frequencies: [262, 392], duration: 0.09 },
    },
  },
}

type SoundContext = Pick<AudioContext, "currentTime" | "destination" | "state" | "resume" | "close" | "createOscillator" | "createGain">

export class UiSounds {
  private context: SoundContext | null = null
  private unavailable = false

  constructor(private create: () => SoundContext = () => new AudioContext()) {}

  /** `volume` de 0 a 1; com 0, nada toca (nem cria o contexto de áudio). Sem áudio no computador, fica em silêncio. */
  play(sound: UiSound, volume: number, theme: FullscreenTheme = "playtrove") {
    if (volume <= 0 || this.unavailable) return
    try {
      this.context ??= this.create()
      this.schedule(this.context, sound, volume, UI_SOUND_PROFILES[theme])
    } catch {
      // Um som nunca pode atrapalhar a navegação.
      this.unavailable = true
    }
  }

  private schedule(context: SoundContext, sound: UiSound, volume: number, profile: SoundProfile) {
    if (context.state === "suspended") void context.resume().catch(() => {})
    const { frequencies, duration } = profile.notes[sound]
    frequencies.forEach((frequency, index) => {
      const begin = context.currentTime + index * duration
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = profile.wave
      oscillator.frequency.setValueAtTime(frequency, begin)
      gain.gain.setValueAtTime(0, begin)
      gain.gain.linearRampToValueAtTime(Math.min(1, volume) * MAX_GAIN * profile.gain, begin + 0.005)
      gain.gain.exponentialRampToValueAtTime(0.0001, begin + duration)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(begin)
      oscillator.stop(begin + duration + 0.02)
    })
  }

  dispose() {
    void this.context?.close().catch(() => {})
    this.context = null
  }
}
