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

/** A proporção de todas as capas do app (modo janela e tela cheia): em pé, 3:4. */
const COVER_RATIO = 3 / 4

/**
 * A capa num quadro 3:4, igual em todo o app, com a arte enchendo o quadro (uma arte de outra proporção perde um
 * pouco das bordas, sem sobras nem fundo desfocado). Uma nova URL reinicia o carregamento da imagem.
 */
export function GameCover({ title, src, className }: GameCoverProps) {
  const { t } = useI18n()
  return <CoverImage key={src ?? ""} label={t.details.cover(title)} src={src} className={className} />
}

type ImageState = "loading" | "empty" | "error" | "loaded"

function CoverImage({ label, src, className }: Omit<GameCoverProps, "title"> & { label: string }) {
  const [image, setImage] = useState<ImageState>(src ? "loading" : "empty")
  const loaded = image === "loaded"

  return (
    <div
      role="img"
      aria-label={label}
      aria-busy={image === "loading"}
      data-slot="game-cover"
      data-state={image}
      className={cn(
        "relative flex aspect-3/4 w-full items-center justify-center overflow-hidden rounded-lg",
        loaded ? "bg-card" : "bg-linear-to-br from-cover-start to-cover-end",
        className
      )}
      // A largura acompanha o limite de altura de cada tela (--cover-max-height).
      style={{ maxWidth: `min(100%, calc(${COVER_RATIO} * var(--cover-max-height, 24rem)))` }}
    >
      {src && image !== "error" && (
        <img
          data-slot="game-cover-image"
          src={src}
          alt=""
          draggable={false}
          onLoad={({ currentTarget }) => setImage(currentTarget.naturalWidth && currentTarget.naturalHeight ? "loaded" : "error")}
          onError={() => setImage("error")}
          className={loaded ? "absolute inset-0 size-full object-cover" : "absolute inset-0 size-full opacity-0"}
        />
      )}
      {!loaded && <Gamepad2 aria-hidden="true" className="size-1/3 text-cover-foreground" strokeWidth={1.5} />}
    </div>
  )
}
