import type { Game } from "@shared/types"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { useAnikiPack } from "@/hooks/useAnikiPack"
import { AnikiShell } from "./AnikiShell"
import { PlaytroveShell } from "./PlaytroveShell"

interface Props { enabled: boolean; games: Game[]; initialGameId: number | null; onExit: () => void; onOpenEmulators: () => void }

/**
 * O tema da tela cheia, como no Playnite: o do Playtrove (padrão) ou o Aniki ReMake, que só vale com o
 * pacote oficial instalado. Sem o pacote (apagado à mão, por exemplo), volta o tema Playtrove.
 */
export function FullscreenShell(props: Props) {
  const { config } = useFullscreenConfig()
  const { status } = useAnikiPack()
  // Espera as duas respostas, para não mostrar um tema e trocar pelo outro logo em seguida.
  if (!config || !status) return null
  return config.theme === "aniki" && status.installed ? <AnikiShell {...props} /> : <PlaytroveShell {...props} />
}
