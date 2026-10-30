import type { Game } from "@shared/types"
import { resolveAnikiMusicUrl, type AnikiMediaContext } from "@/lib/anikiMedia"
import { FullscreenMedia } from "./FullscreenMedia"

/** Um único player alterna as OSTs do tema e a faixa do jogo, preservando reprodução e volume. */
export function AnikiMedia({ game, context, suspended }: { game: Game | undefined; context: AnikiMediaContext; suspended: boolean }) {
  // Hub e janelas secundárias pausam na referência. O Login fecha a faixa ao ocultar ou perder foco.
  return <FullscreenMedia game={game} playVideo={false} suspended={suspended} musicUrl={resolveAnikiMusicUrl(context, game)} musicTransitionMs={1200} musicPositionKey={context === "login" ? null : context} musicResetOnSuspend={context === "login"} musicContext={context} />
}
