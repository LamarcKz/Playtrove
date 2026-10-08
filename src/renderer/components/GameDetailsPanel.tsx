import { Ellipsis, Star, X } from "lucide-react"
import type { Game } from "@shared/types"
import { GameActionsMenu } from "@/components/GameActionsMenu"
import { GameBackdrop } from "@/components/GameBackdrop"
import { GameCover } from "@/components/GameCover"
import { GameInfoList } from "@/components/GameInfoList"
import { GameScores } from "@/components/GameScores"
import { PlayButton } from "@/components/PlayButton"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useI18n } from "@/hooks/useI18n"
import { cn } from "@/lib/utils"

interface GameDetailsPanelProps {
  game: Game
  onClose: () => void
  className?: string
}

/**
 * Painel lateral com os detalhes do jogo clicado (modos Grade, Lista e Kanban): a arte de fundo
 * no topo, a capa por cima dela, o título, os botões e as informações.
 */
export function GameDetailsPanel({ game, onClose, className }: GameDetailsPanelProps) {
  const { t } = useI18n()
  return (
    <aside
      aria-label={t.details.of(game.title)}
      className={cn(
        "flex w-80 shrink-0 animate-in flex-col border-l bg-card duration-200 fade-in-0 slide-in-from-right-8",
        className
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span className="text-sm font-medium text-muted-foreground">{t.details.title}</span>
        <Button variant="ghost" size="icon-sm" aria-label={t.details.close} onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="relative flex-1 overflow-y-auto">
        <GameBackdrop src={game.backgroundUrl} fadeTo="card" className="h-60" />
        <div className="relative p-5">
          <GameCover title={game.title} src={game.coverUrl} className="mx-auto w-44 shadow-xl shadow-black/40" />
          <h2 className="mt-5 text-xl font-semibold">
            {game.title}
            {game.favorite && (
              <Star aria-label={t.details.favorite} className="ml-2 inline size-4.5 fill-current align-[-0.1em] text-favorite" />
            )}
          </h2>
          <div className="mt-5 flex gap-2">
            <PlayButton game={game} className="flex-1" />
            <GameActionsMenu game={game}>
              <Button variant="secondary" size="icon-lg" aria-label={t.details.moreActions}>
                <Ellipsis />
              </Button>
            </GameActionsMenu>
          </div>
          <GameScores game={game} className="mt-5" />
          <Separator className="my-6" />
          <GameInfoList game={game} />
          {game.review && (
            <section aria-label={t.details.myReview} className="mt-6">
              <h3 className="mb-2 text-sm font-semibold">{t.details.myReview}</h3>
              <p className="text-sm leading-relaxed whitespace-pre-line">{game.review}</p>
            </section>
          )}
          {game.description && (
            <p className="mt-6 text-sm leading-relaxed whitespace-pre-line text-muted-foreground">{game.description}</p>
          )}
        </div>
      </div>
    </aside>
  )
}
