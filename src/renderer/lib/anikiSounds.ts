import { anikiAsset } from "./anikiAssets"

const files = {
  move: "navigation", confirm: "activation", open: "OpenPanel", view: "OpenAdditionalView",
  back: "CloseAdditionalView", details: "EnterGameDetails", library: "ExitGameDetails",
  hub: "HomeHubOpen", closeHub: "HomeHubClose", layout: "ChangeDisplay",
} as const
export type AnikiSound = keyof typeof files
type Output = Pick<HTMLAudioElement, "src" | "currentTime" | "volume" | "play" | "pause" | "removeAttribute" | "load">

/** Sons originais do pacote instalado, sem copiar os arquivos para o aplicativo. */
export class AnikiSounds {
  private outputs = new Map<AnikiSound, Output>()

  constructor(private create: (url: string) => Output = (url) => new Audio(url)) {}

  play(sound: AnikiSound, volume: number) {
    if (volume <= 0) return
    try {
      let audio = this.outputs.get(sound)
      if (!audio) {
        audio = this.create(anikiAsset(`audio/${files[sound]}.wav`))
        this.outputs.set(sound, audio)
      }
      audio.pause()
      audio.currentTime = 0
      audio.volume = Math.min(1, volume)
      void audio.play().catch(() => {})
    } catch {
      // A mídia indisponível nunca bloqueia a navegação.
    }
  }

  pause() {
    for (const audio of this.outputs.values()) audio.pause()
  }

  dispose() {
    this.pause()
    for (const audio of this.outputs.values()) { audio.removeAttribute("src"); audio.load() }
    this.outputs.clear()
  }
}
