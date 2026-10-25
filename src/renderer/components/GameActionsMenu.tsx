import { useState, type ReactNode } from "react"
import { CircleStar, Download, FolderOpen, Music2, Music3, NotebookPen, Star, StarOff, Video, VideoOff, VolumeX } from "lucide-react"
import type { Game } from "@shared/types"
import { RatingDialog } from "@/components/RatingDialog"
import { ReviewDialog } from "@/components/ReviewDialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useI18n } from "@/hooks/useI18n"
import { useToast } from "@/hooks/useToast"
import { errorMessage } from "@/lib/errors"

interface GameActionsMenuProps {
  game: Game
  /** O botão que abre o menu (ex.: "Mais"). */
  children: ReactNode
}

/**
 * Menu "Mais" de um jogo: avaliar (nota e dificuldade), escrever a análise, baixar os metadados,
 * marcar como favorito e mostrar a ROM na pasta. Avaliar e escrever abrem cada um a sua janela.
 */
export function GameActionsMenu({ game, children }: GameActionsMenuProps) {
  const { t } = useI18n()
  const toast = useToast()
  const [dialog, setDialog] = useState<"rating" | "review" | null>(null)
  const closeDialog = (open: boolean) => !open && setDialog(null)

  /** Roda uma ação; se der errado, avisa com o motivo. */
  async function run(errorTitle: string, action: () => Promise<unknown>) {
    try {
      await action()
    } catch (error) {
      toast({ kind: "error", title: errorTitle, description: errorMessage(error) })
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuItem onSelect={() => setDialog("rating")}>
            <CircleStar />
            {t.actions.rate}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("review")}>
            <NotebookPen />
            {game.review ? t.actions.editReview : t.actions.writeReview}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void run(t.actions.metadataError, () => window.api.metadata.download([game.id]))}
          >
            <Download />
            {t.actions.downloadMetadata}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void run(t.actions.favoriteError, () => window.api.games.setFavorite(game.id, !game.favorite))
            }
          >
            {game.favorite ? <StarOff /> : <Star />}
            {game.favorite ? t.actions.removeFavorite : t.actions.addFavorite}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void run(t.actions.backgroundVideoError, () => window.api.games.pickBackgroundVideo(game.id))}
          >
            <Video />
            {t.actions.pickBackgroundVideo}
          </DropdownMenuItem>
          {game.backgroundVideoMode !== "auto" && (
            <DropdownMenuItem
              onSelect={() => void run(t.actions.backgroundVideoError, () => window.api.games.useAutomaticBackgroundVideo(game.id))}
            >
              <Download />
              {t.actions.useAutomaticBackgroundVideo}
            </DropdownMenuItem>
          )}
          {game.backgroundVideoMode !== "disabled" && (
            <DropdownMenuItem
              onSelect={() => void run(t.actions.backgroundVideoError, () => window.api.games.removeBackgroundVideo(game.id))}
            >
              <VideoOff />
              {game.backgroundVideoUrl ? t.actions.removeBackgroundVideo : t.actions.disableAutomaticBackgroundVideo}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void run(t.actions.themeMusicError, () => window.api.games.pickThemeMusic(game.id))}
          >
            <Music2 />
            {t.actions.pickThemeMusic}
          </DropdownMenuItem>
          {(game.themeMusicMode !== "auto" || !game.themeMusicUrl) && (
            <DropdownMenuItem
              onSelect={() => void run(t.actions.themeMusicError, () => window.api.games.useAutomaticThemeMusic(game.id))}
            >
              <Music3 />
              {game.themeMusicMode === "auto" ? t.actions.findThemeMusic : t.actions.useAutomaticThemeMusic}
            </DropdownMenuItem>
          )}
          {game.themeMusicUrl && (
            <DropdownMenuItem
              onSelect={() => void run(t.actions.themeMusicError, () => window.api.games.removeThemeMusic(game.id))}
            >
              <VolumeX />
              {t.actions.removeThemeMusic}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!game.romPath}
            onSelect={() => void run(t.actions.folderError, () => window.api.games.showRom(game.id))}
          >
            <FolderOpen />
            {t.actions.showRom}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RatingDialog game={game} open={dialog === "rating"} onOpenChange={closeDialog} />
      <ReviewDialog game={game} open={dialog === "review"} onOpenChange={closeDialog} />
    </>
  )
}
