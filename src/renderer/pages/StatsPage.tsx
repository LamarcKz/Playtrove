import { useEffect, useState } from "react"
import { ChartColumn, Joystick } from "lucide-react"
import type { DailyPlaytime, Game } from "@shared/types"
import { ActivityChart } from "@/components/ActivityChart"
import { BarList } from "@/components/BarList"
import { EmptyState } from "@/components/EmptyState"
import { GameIcon } from "@/components/GameIcon"
import { EmptyNote, StatsCard, StatTile } from "@/components/StatsBlocks"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/useI18n"
import { useStatuses } from "@/hooks/useStatuses"
import { formatLastPlayed, formatPlaytime } from "@/lib/format"
import {
  activityTotals,
  countByStatus,
  formatShare,
  groupGames,
  neverPlayedGames,
  recentlyPlayed,
  summarize,
  topPlayed,
} from "@/lib/stats"

/** Quantos jogos "nunca jogados" aparecem na lista (o resto vira "e mais N"). */
const NEVER_PLAYED_SHOWN = 8

interface StatsPageProps {
  games: Game[]
  /** Vai para a aba Emuladores (botão da biblioteca vazia). */
  onOpenEmulators: () => void
}

/**
 * Tela "Estatísticas": os números da biblioteca (jogos, tempo jogado, média), os mais jogados,
 * os jogos por status, por plataforma e por biblioteca, e a atividade (os últimos 30 dias, os
 * jogados por último e os nunca jogados).
 */
export function StatsPage({ games, onOpenEmulators }: StatsPageProps) {
  const { t } = useI18n()
  const statuses = useStatuses()
  const days = useDailyPlaytime(games)

  if (games.length === 0) {
    return (
      <div className="flex h-full">
        <EmptyState
          icon={ChartColumn}
          title={t.stats.emptyTitle}
          description={t.stats.emptyDescription}
          action={
            <Button variant="secondary" onClick={onOpenEmulators}>
              <Joystick />
              {t.library.goToEmulators}
            </Button>
          }
        />
      </div>
    )
  }

  const summary = summarize(games)
  const top = topPlayed(games)
  const recent = recentlyPlayed(games)
  const neverPlayed = neverPlayedGames(games)
  const activity = days ? activityTotals(days) : null
  const groupItems = (pick: (game: Game) => string | null, missingLabel: string) =>
    groupGames(games, pick, missingLabel).map((group) => ({
      id: group.label,
      label: <span className="truncate">{group.label}</span>,
      detail: group.minutes > 0 ? t.stats.groupPlayed(formatPlaytime(group.minutes, t)) : t.stats.groupNothing,
      value: group.games,
      valueLabel: t.common.games(group.games),
    }))

  return (
    <div className="@container h-full overflow-y-auto p-8">
      {/* Centralizado: com a janela maximizada, o painel não fica encostado num canto. */}
      <div className="mx-auto max-w-7xl space-y-6">
        <dl aria-label={t.stats.summary} className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
          <StatTile
            label={t.stats.gamesInLibrary}
            value={String(summary.totalGames)}
            detail={summary.favorites > 0 ? t.stats.favorites(summary.favorites) : undefined}
          />
          <StatTile
            label={t.fields.playtime}
            value={summary.totalMinutes > 0 ? formatPlaytime(summary.totalMinutes, t) : t.format.hours(0)}
            detail={t.stats.inGames(t.common.games(summary.playedGames))}
          />
          <StatTile
            label={t.stats.average}
            value={summary.averageMinutes > 0 ? formatPlaytime(summary.averageMinutes, t) : "—"}
            detail={t.stats.neverPlayedCount(summary.neverPlayed)}
          />
          <StatTile label={t.stats.playedRecently} value={String(summary.playedRecently)} />
        </dl>

        <div className="grid gap-6 @4xl:grid-cols-2">
          <StatsCard title={t.stats.topPlayed}>
            {top.length > 0 ? (
              <BarList
                label={t.stats.topPlayed}
                items={top.map((game, index) => ({
                  id: game.id,
                  label: (
                    <>
                      <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                      <GameIcon game={game} className="size-5" />
                      <span className="truncate" title={game.title}>
                        {game.title}
                      </span>
                    </>
                  ),
                  value: game.playtimeMinutes,
                  valueLabel: formatPlaytime(game.playtimeMinutes, t),
                }))}
              />
            ) : (
              <EmptyNote>{t.stats.nothingPlayed}</EmptyNote>
            )}
          </StatsCard>

          <StatsCard title={t.stats.byStatus}>
            <BarList
              label={t.stats.byStatus}
              items={countByStatus(games, statuses).map(({ status, games: count }) => ({
                id: status.id,
                label: <span className="truncate">{status.name}</span>,
                value: count,
                valueLabel: `${count} · ${formatShare(count, games.length)}`,
              }))}
            />
          </StatsCard>
        </div>

        <StatsCard
          title={t.stats.activity}
          detail={
            activity && activity.minutes > 0
              ? t.stats.activityDetail(formatPlaytime(activity.minutes, t), activity.activeDays)
              : undefined
          }
        >
          {days && activity && activity.minutes > 0 ? (
            <ActivityChart days={days} />
          ) : (
            <EmptyNote>{t.stats.activityEmpty}</EmptyNote>
          )}
        </StatsCard>

        <div className="grid gap-6 @4xl:grid-cols-2">
          <StatsCard title={t.stats.byPlatform}>
            <BarList label={t.stats.byPlatformLabel} items={groupItems((game) => game.platform, t.stats.noPlatform)} />
          </StatsCard>
          <StatsCard title={t.stats.byLibrary}>
            <BarList label={t.stats.byLibraryLabel} items={groupItems((game) => game.library, t.stats.noLibrary)} />
          </StatsCard>
        </div>

        <div className="grid gap-6 @4xl:grid-cols-2">
          <StatsCard title={t.stats.lastPlayed}>
            {recent.length > 0 ? (
              <GameRows
                label={t.stats.lastPlayed}
                games={recent}
                aside={(game) => formatLastPlayed(game.lastPlayedAt, t)}
              />
            ) : (
              <EmptyNote>{t.stats.nothingPlayed}</EmptyNote>
            )}
          </StatsCard>
          <StatsCard title={t.stats.neverPlayed} detail={t.common.games(neverPlayed.length)}>
            {neverPlayed.length > 0 ? (
              <>
                <GameRows
                  label={t.stats.neverPlayed}
                  games={neverPlayed.slice(0, NEVER_PLAYED_SHOWN)}
                  aside={(game) => game.platform ?? ""}
                />
                {neverPlayed.length > NEVER_PLAYED_SHOWN && (
                  <p className="mt-2 px-2 text-xs text-muted-foreground">
                    {t.stats.andMore(t.common.games(neverPlayed.length - NEVER_PLAYED_SHOWN))}
                  </p>
                )}
              </>
            ) : (
              <EmptyNote>{t.stats.allPlayed}</EmptyNote>
            )}
          </StatsCard>
        </div>
      </div>
    </div>
  )
}

/** Lista simples de jogos: ícone, nome e uma informação na direita. */
function GameRows({ label, games, aside }: { label: string; games: Game[]; aside: (game: Game) => string }) {
  return (
    <ul aria-label={label} className="space-y-0.5">
      {games.map((game) => (
        <li key={game.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40">
          <GameIcon game={game} className="size-5" />
          <span className="min-w-0 flex-1 truncate" title={game.title}>
            {game.title}
          </span>
          <span className="shrink-0 text-muted-foreground">{aside(game)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * O tempo jogado por dia nos últimos 30 dias (vem das sessões guardadas no banco). Busca de novo
 * sempre que a biblioteca muda (ex.: um jogo acabou de fechar).
 */
function useDailyPlaytime(games: Game[]): DailyPlaytime[] | null {
  const [days, setDays] = useState<DailyPlaytime[] | null>(null)

  useEffect(() => {
    let active = true
    window.api.stats.dailyPlaytime().then((result) => {
      if (active) setDays(result)
    })
    return () => {
      active = false
    }
  }, [games])

  return days
}
