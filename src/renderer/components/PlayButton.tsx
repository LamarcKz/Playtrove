import { useState } from "react"
import { LoaderCircle, Play } from "lucide-react"
import type { Game } from "@shared/types"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/useI18n"
import { useRunningGames } from "@/hooks/useRunningGames"
import { useToast } from "@/hooks/useToast"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

interface PlayButtonProps {
  game: Game
  className?: string
}

/**
 * Botão verde "Jogar": abre o jogo no emulador dele. Enquanto o jogo está aberto, mostra
 * "Em execução"; quando o emulador fecha, o tempo jogado é somado sozinho.
 */
export function PlayButton({ game, className }: PlayButtonProps) {
  const { t } = useI18n()
  const running = useRunningGames().includes(game.id)
  const [opening, setOpening] = useState(false)
  const toast = useToast()

  async function play() {
    setOpening(true)
    try {
      await window.api.games.play(game.id)
    } catch (error) {
      toast({ kind: "error", title: t.details.playError(game.title), description: errorMessage(error) })
    } finally {
      setOpening(false)
    }
  }

  return (
    <Button
      size="lg"
      disabled={running || opening}
      className={cn("bg-play text-play-foreground hover:bg-play/85 disabled:opacity-80", className)}
      onClick={() => void play()}
    >
      {opening ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />}
      {running ? t.details.running : opening ? t.details.opening : t.details.play}
    </Button>
  )
}
