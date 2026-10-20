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

/** Capa inteira, na proporção original. Uma nova URL reinicia somente o carregamento da imagem. */
export function GameCover({ title, src, className }: GameCoverProps) {
  const { t } = useI18n()
  return <CoverImage key={src ?? ""} label={t.details.cover(title)} src={src} className={className} />
}

type ImageState = { state: "loading" | "empty" | "error" } | { state: "loaded"; ratio: number }

function CoverImage({ label, src, className }: Omit<GameCoverProps, "title"> & { label: string }) {
  const [image, setImage] = useState<ImageState>({ state: src ? "loading" : "empty" })
  const loaded = image.state === "loaded"
  const ratio = loaded ? image.ratio : 2 / 3

  return (
    <div
      role="img"
      aria-label={label}
      aria-busy={image.state === "loading"}
      data-slot="game-cover"
      data-state={image.state}
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden rounded-lg",
        !loaded && "aspect-2/3 bg-linear-to-br from-cover-start to-cover-end",
        className
      )}
      // Limitar também a largura pela razão natural mantém o quadro justo à imagem ao atingir a
      // altura máxima. Só max-height deixaria sobras laterais nas capas muito estreitas.
      style={{ maxWidth: `min(100%, calc(${ratio} * var(--cover-max-height, 24rem)))` }}
    >
      {src && image.state !== "error" && (
        <img
          data-slot="game-cover-image"
          src={src}
          alt=""
          draggable={false}
          onLoad={({ currentTarget }) => {
            const { naturalWidth, naturalHeight } = currentTarget
            setImage(
              naturalWidth && naturalHeight ? { state: "loaded", ratio: naturalWidth / naturalHeight } : { state: "error" }
            )
          }}
          onError={() => setImage({ state: "error" })}
          className={loaded ? "block h-auto w-full" : "absolute inset-0 size-full opacity-0"}
        />
      )}
      {!loaded && <Gamepad2 aria-hidden="true" className="size-1/3 text-cover-foreground" strokeWidth={1.5} />}
    </div>
  )
}
