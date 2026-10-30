import type { Game } from "@shared/types"
import { anikiAsset } from "./anikiAssets"

export type AnikiMediaContext = "login" | "hub" | "secondary" | "library" | "screensaver"

/** Login, Hub e janelas marcadas têm OST própria; na biblioteca, vale a faixa salva do jogo. */
export function resolveAnikiMusicUrl(context: AnikiMediaContext, game: Pick<Game, "themeMusicMode" | "themeMusicUrl"> | undefined): string | null {
  if (context === "library") return game?.themeMusicMode === "disabled" ? null : game?.themeMusicUrl ?? null
  const files = { login: "LoginOST.mp3", hub: "HubOST.mp3", secondary: "SecondaryViewsOST.mp3", screensaver: "ScreenSaverOST.mp3" }
  return anikiAsset(`audio/${files[context]}`)
}
