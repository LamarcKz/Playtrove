import type { DailyPlaytime } from "@shared/types"
import { ColumnChart } from "@/components/ColumnChart"
import { useI18n } from "@/hooks/useI18n"
import { formatPlaytime } from "@/lib/format"
import { axisMax, dayColumns, formatAxisMinutes } from "@/lib/stats"

interface ActivityChartProps {
  /** Um item por dia, do mais antigo para hoje. */
  days: DailyPlaytime[]
}

/**
 * Gráfico de colunas do tempo jogado por dia (Estatísticas). Passar o mouse (ou o foco do teclado)
 * numa coluna mostra o dia e o tempo; o dia com mais tempo tem o valor escrito em cima. Embaixo, a
 * mesma informação em tabela.
 */
export function ActivityChart({ days }: ActivityChartProps) {
  const { t } = useI18n()
  return (
    <ColumnChart
      label={t.stats.activityChart}
      columns={dayColumns(
        days.map((day) => ({ date: day.date, value: day.minutes })),
        t
      )}
      top={axisMax(Math.max(0, ...days.map((day) => day.minutes)))}
      formatValue={(minutes) => formatPlaytime(minutes, t)}
      formatAxis={(minutes) => formatAxisMinutes(minutes, t)}
      emptyText={t.stats.nothingPlayedDay}
      tableHeaders={[t.stats.day, t.fields.playtime]}
    />
  )
}
