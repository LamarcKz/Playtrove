import type { Game } from "@shared/types"
import { PlaytroveShell } from "./PlaytroveShell"

interface Props { enabled: boolean; games: Game[]; initialGameId: number | null; onExit: () => void; onOpenEmulators: () => void }

/** A tela cheia do Playtrove. */
export function FullscreenShell(props: Props) {
  return <PlaytroveShell {...props} />
}
