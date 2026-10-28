import { useState } from "react"
import type { Game } from "@shared/types"

/**
 * A logo do jogo no lugar do nome, como o Aniki faz com a do Extra Metadata Loader. Sem logo (ou se ela
 * não carregar), fica o nome em texto. O texto alternativo é o nome, para leitores de tela e testes.
 */
export function AnikiLogo({ game, label }: { game: Game; label?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const name = label ?? game.title
  if (!game.logoUrl || failedUrl === game.logoUrl) return <>{name}</>
  return <img className="aniki-logo" src={game.logoUrl} alt={name} onError={() => setFailedUrl(game.logoUrl)} />
}
