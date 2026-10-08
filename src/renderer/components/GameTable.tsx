import type { Game } from "@shared/types"
import { AchievementCount } from "@/components/AchievementParts"
import { GameIcon } from "@/components/GameIcon"
import { ScoreIcons } from "@/components/ScoreIcons"
import { useI18n } from "@/hooks/useI18n"
import { useStatusName } from "@/hooks/useStatuses"
import { formatPlaytime } from "@/lib/format"
import type { ScoreKind } from "@/lib/score"
import { cn } from "@/lib/utils"

/** Colunas da lista: valem para o cabeçalho e para as linhas. */
const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_7rem_6.5rem_5.5rem_5.5rem_5.5rem] items-center gap-3 px-4"

interface GameTableProps {
  games: Game[]
  selectedGameId: number | null
  onSelectGame: (game: Game) => void
}

/**
 * Modo Lista: uma linha por jogo, com as colunas Nome, Status, Plataforma, Biblioteca, Tempo
 * jogado, Nota, Dificuldade e Conquistas, como a visualização em lista do Playnite.
 */
export function GameTable({ games, selectedGameId, onSelectGame }: GameTableProps) {
  const { t } = useI18n()
  const statusName = useStatusName()

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div
        className={cn(
          COLUMNS,
          "sticky top-0 z-10 h-10 border-b bg-background text-xs font-medium text-muted-foreground"
        )}
      >
        <span className="pl-9">{t.fields.name}</span>
        <span>{t.fields.status}</span>
        <span>{t.fields.platform}</span>
        <span>{t.fields.library}</span>
        <span>{t.fields.playtime}</span>
        <span>{t.fields.rating}</span>
        <span>{t.fields.difficulty}</span>
        <span>{t.fields.achievements}</span>
      </div>

      {games.map((game) => {
        const selected = game.id === selectedGameId
        return (
          <button
            key={game.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelectGame(game)}
            className={cn(
              COLUMNS,
              "h-11 w-full border-b text-left text-sm transition-colors outline-none hover:bg-accent/50 focus-visible:bg-accent/50",
              selected && "bg-accent hover:bg-accent"
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              <GameIcon game={game} />
              <span className="truncate">{game.title}</span>
            </span>
            <span className="truncate">{statusName(game.statusId)}</span>
            <Cell value={game.platform} />
            <Cell value={game.library} />
            <span className="text-muted-foreground tabular-nums">{formatPlaytime(game.playtimeMinutes, t)}</span>
            <ScoreCell kind="rating" score={game.rating} />
            <ScoreCell kind="difficulty" score={game.difficulty} />
            {game.achievements ? (
              <AchievementCount progress={game.achievements} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Célula da nota ou da dificuldade: os cinco ícones pequenos, ou "—" sem avaliação. */
function ScoreCell({ kind, score }: { kind: ScoreKind; score: number | null }) {
  if (score === null) return <span className="text-muted-foreground">—</span>
  return <ScoreIcons kind={kind} score={score} iconClassName="size-3.5" />
}

/** Célula de texto que pode estar vazia (mostra "—"). */
function Cell({ value }: { value: string | null }) {
  return <span className="truncate text-muted-foreground">{value ?? "—"}</span>
}
