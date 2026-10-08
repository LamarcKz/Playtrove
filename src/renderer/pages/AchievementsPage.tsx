import { useState } from "react"
import { RefreshCw, Settings, Trophy } from "lucide-react"
import type { AchievementGameRow } from "@shared/achievements"
import type { Game } from "@shared/types"
import { GradeCounts, ProgressBar } from "@/components/AchievementParts"
import { AchievementRow, AchievementsDialog } from "@/components/AchievementsDialog"
import { ColumnChart, countAxisMax } from "@/components/ColumnChart"
import { EmptyState } from "@/components/EmptyState"
import { GameIcon } from "@/components/GameIcon"
import { EmptyNote, StatsCard, StatTile } from "@/components/StatsBlocks"
import { Button } from "@/components/ui/button"
import { useAchievementsConfig, useAchievementsOverview } from "@/hooks/useAchievements"
import { useI18n } from "@/hooks/useI18n"
import { progressPercent } from "@/lib/achievements"
import { formatLastPlayed, formatTime } from "@/lib/format"
import { dayColumns, monthColumns } from "@/lib/stats"
import { cn } from "@/lib/utils"

interface AchievementsPageProps {
  games: Game[]
  /** Vai para as Configurações (onde fica a conta do RetroAchievements). */
  onOpenSettings: () => void
}

/**
 * Aba "Conquistas": as do RetroAchievements e os troféus do PS3 (do RPCS3) juntos (escolha do
 * usuário em 2026-09-24): o resumo, os gráficos por dia e por mês, os jogos com o progresso e as
 * desbloqueadas por último.
 */
export function AchievementsPage({ games, onOpenSettings }: AchievementsPageProps) {
  const { t } = useI18n()
  const words = t.achievements
  const [config] = useAchievementsConfig()
  const overview = useAchievementsOverview(games)
  const [openGame, setOpenGame] = useState<Game | null>(null)

  if (!config || !overview) return null
  // Sem a conta e sem troféus do PS3, não há o que mostrar ainda.
  if (!config.username && overview.games.length === 0) {
    return (
      <div className="flex h-full">
        <EmptyState
          icon={Trophy}
          title={words.emptyTitle}
          description={words.emptyDescription}
          action={
            <Button variant="secondary" onClick={onOpenSettings}>
              <Settings />
              {words.goToSettings}
            </Button>
          }
        />
      </div>
    )
  }

  const gameById = new Map(games.map((game) => [game.id, game]))
  const percent = progressPercent(overview.unlocked, overview.total)

  return (
    <div className="@container h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-muted-foreground">
          {!config.username ? (
            <p className="mr-auto">
              {words.ps3Hint.before}
              <button type="button" onClick={onOpenSettings} className="text-foreground underline-offset-4 hover:underline">
                {words.ps3Hint.link}
              </button>
              {words.ps3Hint.after}
            </p>
          ) : config.lastError && !config.syncing ? (
            <p role="alert" className="mr-auto text-destructive">
              {config.lastError}
            </p>
          ) : (
            <p className="mr-auto">
              {words.account} <span className="text-foreground">{config.username}</span>
              {config.lastSyncAt && ` · ${words.updatedAt(formatTime(config.lastSyncAt, t.locale))}`}
            </p>
          )}
          <Button variant="secondary" size="sm" disabled={config.syncing} onClick={() => void window.api.achievements.sync()}>
            <RefreshCw className={cn(config.syncing && "animate-spin")} />
            {config.syncing ? words.updating : words.update}
          </Button>
        </div>

        {overview && (
          <>
            <dl
              aria-label={words.summary}
              className={cn("grid grid-cols-2 gap-4", config.username ? "@4xl:grid-cols-4" : "@4xl:grid-cols-3")}
            >
              <StatTile
                label={words.unlockedTile}
                value={String(overview.unlocked)}
                detail={words.unlockedTileDetail(overview.total, percent)}
              />
              <StatTile label={words.platinums} value={String(overview.platinums)} detail={words.platinumsDetail} />
              {config.username && (
                <StatTile
                  label={words.pointsTile}
                  value={overview.points.toLocaleString(t.locale)}
                  detail={overview.games.some((game) => game.source === "rpcs3") ? words.pointsTileDetail : undefined}
                />
              )}
              <StatTile label={words.gamesTile} value={String(overview.games.length)} />
            </dl>

            <div className="grid gap-6 @4xl:grid-cols-2">
              <StatsCard title={words.perDay} detail={words.last30Days}>
                <ColumnChart
                  label={words.perDayChart}
                  columns={dayColumns(
                    overview.byDay.map((day) => ({ date: day.date, value: day.count })),
                    t
                  )}
                  top={countAxisMax(Math.max(0, ...overview.byDay.map((day) => day.count)))}
                  formatValue={words.chartCount}
                  formatAxis={String}
                  emptyText={words.chartNone}
                  tableHeaders={[words.day, words.chartColumn]}
                />
              </StatsCard>
              <StatsCard title={words.perMonth} detail={words.last12Months}>
                <ColumnChart
                  label={words.perMonthChart}
                  columns={monthColumns(
                    overview.byMonth.map((month) => ({ month: month.month, value: month.count })),
                    t.locale
                  )}
                  top={countAxisMax(Math.max(0, ...overview.byMonth.map((month) => month.count)))}
                  formatValue={words.chartCount}
                  formatAxis={String}
                  emptyText={words.chartNone}
                  tableHeaders={[words.month, words.chartColumn]}
                />
              </StatsCard>
            </div>

            <div className="grid items-start gap-6 @5xl:grid-cols-[3fr_2fr]">
              <StatsCard title={words.games} detail={overview.games.length > 0 ? `${overview.games.length}` : undefined}>
                {overview.games.length > 0 ? (
                  <ul aria-label={words.gamesList} className="space-y-0.5">
                    {overview.games.map((row) => (
                      <GameProgressRow
                        key={row.gameId}
                        row={row}
                        game={gameById.get(row.gameId)}
                        onOpen={() => setOpenGame(gameById.get(row.gameId) ?? null)}
                      />
                    ))}
                  </ul>
                ) : (
                  <EmptyNote>
                    {config.syncing ? words.searching : words.noGames}
                  </EmptyNote>
                )}
              </StatsCard>
              <StatsCard title={words.recent}>
                {overview.recent.length > 0 ? (
                  <ul aria-label={words.recentList} className="-mx-1">
                    {overview.recent.map((achievement) => (
                      <AchievementRow key={achievement.key} achievement={achievement} gameTitle={achievement.gameTitle} />
                    ))}
                  </ul>
                ) : (
                  <EmptyNote>{words.noRecent}</EmptyNote>
                )}
              </StatsCard>
            </div>
          </>
        )}
      </div>
      {openGame && <AchievementsDialog game={openGame} open onOpenChange={(open) => !open && setOpenGame(null)} />}
    </div>
  )
}

/** Um jogo da lista: ícone, nome, progresso, os troféus de cada tipo e o último desbloqueio. */
function GameProgressRow({ row, game, onOpen }: { row: AchievementGameRow; game: Game | undefined; onOpen: () => void }) {
  const { t } = useI18n()
  const percent = progressPercent(row.unlocked, row.total)
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left outline-none hover:bg-accent/40 focus-visible:bg-accent/40"
      >
        {game && <GameIcon game={game} className="size-9" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium">{row.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {row.unlocked}/{row.total} · {percent}%
            </span>
          </div>
          <ProgressBar value={percent} label={t.achievements.progressIn(row.title)} className="mt-1.5" />
          <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
            {row.platinum && (
              <span className="inline-flex items-center gap-1 font-medium text-platinum">
                <Trophy aria-hidden="true" className="size-3" />
                {t.achievements.platinum}
              </span>
            )}
            <GradeCounts counts={row.byGrade} className="[&_svg]:size-3" />
            {row.lastUnlockedAt && <span className="ml-auto">{formatLastPlayed(row.lastUnlockedAt, t)}</span>}
          </div>
        </div>
      </button>
    </li>
  )
}
