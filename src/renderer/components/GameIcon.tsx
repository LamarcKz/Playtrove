import { useState } from "react"
import { Gamepad2 } from "lucide-react"
import type { Game } from "@shared/types"
import { cn } from "@/lib/utils"

interface GameIconProps {
  /** O ícone é um pedaço da capa (a parte de cima, onde costuma estar o nome do jogo). */
  game: Pick<Game, "coverUrl">
  className?: string
}

/**
 * Ícone pequeno do jogo (lista do modo Detalhes, Lista, Kanban e Estatísticas): um quadrado da capa,
 * que é sempre a imagem certa do jogo. Sem capa, o desenho padrão.
 */
export function GameIcon({ game, className }: GameIconProps) {
  const src = game.coverUrl
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (src && src !== failedSrc) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        onError={() => setFailedSrc(src)}
        className={cn("size-6 shrink-0 rounded-md object-cover object-top", className)}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md bg-linear-to-br from-cover-start to-cover-end",
        className
      )}
    >
      <Gamepad2 className="size-3.5 text-cover-foreground" />
    </span>
  )
}
