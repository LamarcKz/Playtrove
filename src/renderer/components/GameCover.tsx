import { useState } from "react"
import { Gamepad2 } from "lucide-react"
import { useI18n } from "@/hooks/useI18n"
import { cn } from "@/lib/utils"

interface GameCoverProps {
  title: string
  /** Endereço da capa. Sem ele (ou se a imagem não carregar), aparece o desenho padrão. */
  src?: string | null
  className?: string
}

/**
 * Capa do jogo em formato retrato (2:3). Capas de outro formato (as caixas quadradas do PS1, as do
 * DS...) aparecem inteiras, sem corte: o espaço que sobra é preenchido com a própria capa desfocada.
 */
export function GameCover({ title, src, className }: GameCoverProps) {
  const { t } = useI18n()
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src) && src !== failedSrc

  return (
    <div
      role="img"
      aria-label={t.details.cover(title)}
      className={cn(
        "relative flex aspect-2/3 items-center justify-center overflow-hidden rounded-lg bg-linear-to-br from-cover-start to-cover-end",
        className
      )}
    >
      {showImage ? (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 scale-125 bg-cover bg-center blur-xl brightness-75"
            style={{ backgroundImage: `url("${src}")` }}
          />
          <img
            src={src ?? undefined}
            alt=""
            draggable={false}
            onError={() => setFailedSrc(src ?? null)}
            className="absolute inset-0 size-full object-contain"
          />
        </>
      ) : (
        <Gamepad2 className="size-1/3 text-cover-foreground" strokeWidth={1.5} />
      )}
    </div>
  )
}
