import { Ellipsis, Star } from "lucide-react"
import type { Game } from "@shared/types"
import { AchievementsCard } from "@/components/AchievementsCard"
import { GameActionsMenu } from "@/components/GameActionsMenu"
import { GameBackdrop } from "@/components/GameBackdrop"
import { GameCover } from "@/components/GameCover"
import { GameInfoList } from "@/components/GameInfoList"
import { GameScores } from "@/components/GameScores"
import { PlayButton } from "@/components/PlayButton"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useI18n } from "@/hooks/useI18n"

interface GameDetailsViewProps {
  game: Game
}

/**
 * Área grande do modo Detalhes (no estilo do Playnite): a arte de fundo do jogo, a capa acima do
 * título, os botões e as informações.
 */
export function GameDetailsView({ game }: GameDetailsViewProps) {
  const { t } = useI18n()
  return (
    <div className="@container relative h-full min-w-0 flex-1 overflow-y-auto">
      {/* A arte de fundo ocupa boa parte da tela, e o conteúdo começa lá embaixo: assim ela aparece
          inteira em cima (pedido do usuário em 2026-09-19). */}
      <GameBackdrop src={game.backgroundUrl} fadeTo="background" placeholderIcon className="h-[max(34rem,72vh)]" />

      <div className="relative px-10 pb-10">
        {/* À esquerda, a capa, o nome e os botões; à direita, o cartão das conquistas (quebra para baixo em
            janelas estreitas). */}
        <div className="flex min-h-[max(26rem,60vh)] flex-wrap items-end justify-between gap-x-10 gap-y-6 pt-10 pb-8">
          <div className="flex min-w-0 flex-col items-start">
            <GameCover title={game.title} src={game.coverUrl} className="w-40 shadow-xl shadow-black/40" />
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-balance drop-shadow-lg">
              {game.title}
              {game.favorite && (
                <Star
                  aria-label={t.details.favorite}
                  className="ml-3 inline size-7 fill-current align-[-0.1em] text-favorite drop-shadow-lg"
                />
              )}
            </h1>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <PlayButton game={game} className="h-10 w-40" />
              <GameActionsMenu game={game}>
                <Button variant="secondary" size="lg" className="h-10 w-40">
                  <Ellipsis />
                  {t.details.more}
                </Button>
              </GameActionsMenu>
              <GameScores game={game} className="ml-7 border-l pl-7" />
            </div>
          </div>
          <AchievementsCard game={game} className="shrink-0" />
        </div>

        {/* Duas colunas quando há espaço; uma embaixo da outra em janelas estreitas. */}
        <div className="grid gap-10 @3xl:grid-cols-[18rem_1fr]">
          <section>
            <h2 className="mb-4 text-sm font-semibold">{t.details.title}</h2>
            <GameInfoList game={game} />
          </section>
          <div>
            {/* A análise do usuário vem antes da descrição do jogo, com uma linha separando. */}
            {game.review && (
              <>
                <section aria-label={t.details.myReview}>
                  <h2 className="mb-4 text-sm font-semibold">{t.details.myReview}</h2>
                  <p className="max-w-3xl text-sm leading-relaxed whitespace-pre-line">{game.review}</p>
                </section>
                <Separator className="my-6" />
              </>
            )}
            <section>
              <h2 className="mb-4 text-sm font-semibold">{t.details.description}</h2>
              {game.description ? (
                <p className="max-w-3xl text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
                  {game.description}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t.details.noDescription}</p>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
