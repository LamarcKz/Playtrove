/** Os sons da navegação do tema Playtrove: tons curtos criados na hora pelo Web Audio, sem arquivos. */
export type UiSound = "move" | "confirm" | "back" | "open"

/** As notas de cada som (Hz), tocadas em sequência, e quanto dura cada uma (segundos). */
export const UI_SOUND_NOTES: Record<UiSound, { frequencies: number[]; duration: number }> = {
  move: { frequencies: [880], duration: 0.04 },
  confirm: { frequencies: [660, 990], duration: 0.06 },
  back: { frequencies: [740, 494], duration: 0.06 },
  open: { frequencies: [523, 784], duration: 0.08 },
}
/** O volume 100% da preferência vira este ganho: os sons ficam baixos perto da música tema. */
const MAX_GAIN = 0.25

type SoundContext = Pick<AudioContext, "currentTime" | "destination" | "state" | "resume" | "close" | "createOscillator" | "createGain">

export class UiSounds {
  private context: SoundContext | null = null
  private unavailable = false

  constructor(private create: () => SoundContext = () => new AudioContext()) {}

  /** `volume` de 0 a 1; com 0, nada toca (nem cria o contexto de áudio). Sem áudio no computador, fica em silêncio. */
  play(sound: UiSound, volume: number) {
    if (volume <= 0 || this.unavailable) return
    try {
      this.context ??= this.create()
      this.schedule(this.context, sound, volume)
    } catch {
      // Um som nunca pode atrapalhar a navegação.
      this.unavailable = true
    }
  }

  private schedule(context: SoundContext, sound: UiSound, volume: number) {
    if (context.state === "suspended") void context.resume().catch(() => {})
    const { frequencies, duration } = UI_SOUND_NOTES[sound]
    frequencies.forEach((frequency, index) => {
      const begin = context.currentTime + index * duration
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = "triangle"
      oscillator.frequency.setValueAtTime(frequency, begin)
      gain.gain.setValueAtTime(0, begin)
      gain.gain.linearRampToValueAtTime(Math.min(1, volume) * MAX_GAIN, begin + 0.005)
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
