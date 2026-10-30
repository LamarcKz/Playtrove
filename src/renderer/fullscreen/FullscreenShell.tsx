import type { Game } from "@shared/types"
import { PlaytroveShell } from "./PlaytroveShell"

interface Props { enabled: boolean; games: Game[]; initialGameId: number | null; onExit: () => void; onOpenEmulators: () => void }

/**
 * A tela cheia do Playtrove. O tema Aniki não passa por aqui: com ele instalado e escolhido, a tela cheia é o
 * próprio Playnite com o Aniki (src-tauri/src/aniki_session.rs).
 */
export function FullscreenShell(props: Props) {
  return <PlaytroveShell {...props} />
}
