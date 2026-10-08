import { useState } from "react"
import { Gamepad2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface GameBackdropProps {
  /** Imagem de fundo do jogo. Sem ela, aparece um degradê. */
  src: string | null
  /** A cor de onde a arte está: ela se desfaz nessa cor embaixo, sem emenda. */
  fadeTo: "background" | "card"
  /** Mostrar o controle grande quando não há imagem (modo Detalhes). */
  placeholderIcon?: boolean
  className?: string
}

/**
 * Arte de fundo no topo dos detalhes do jogo (modo Detalhes e painel lateral): fica atrás do
 * conteúdo e vai sumindo para baixo.
 */
export function GameBackdrop({ src, fadeTo, placeholderIcon, className }: GameBackdropProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src) && src !== failedSrc

  return (
    <div
      aria-hidden="true"
      data-slot="game-backdrop"
      className={cn("pointer-events-none absolute inset-x-0 top-0 overflow-hidden", className)}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          draggable={false}
          onError={() => setFailedSrc(src)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <>
          <div className="absolute inset-0 bg-linear-to-br from-cover-start to-cover-end" />
          {placeholderIcon && (
            <Gamepad2 className="absolute top-8 right-12 size-72 text-cover-foreground" strokeWidth={1} />
          )}
        </>
      )}
      <div
        className={cn(
          "absolute inset-0 bg-linear-to-b from-transparent",
          fadeTo === "card" ? "via-card/70 to-card" : "via-background/70 to-background"
        )}
      />
    </div>
  )
}
