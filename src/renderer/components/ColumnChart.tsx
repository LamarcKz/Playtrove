import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/hooks/useI18n"
import type { ChartColumn } from "@/lib/stats"
import { cn } from "@/lib/utils"

interface ColumnChartProps {
  /** Nome do gráfico, para leitores de tela. */
  label: string
  columns: ChartColumn[]
  /** O topo do eixo (um número "redondo" acima do maior valor). */
  top: number
  formatValue: (value: number) => string
  formatAxis: (value: number) => string
  /** Texto de coluna zerada, em minúsculas (ex.: "nada jogado"). */
  emptyText: string
  /** Cabeçalhos da versão em tabela. */
  tableHeaders: [string, string]
}

/**
 * Gráfico de colunas das Estatísticas e das Conquistas. Passar o mouse (ou o foco do teclado) numa
 * coluna mostra o valor; a coluna mais alta tem o valor escrito em cima. Embaixo, a mesma informação
 * em tabela.
 */
export function ColumnChart({ label, columns, top, formatValue, formatAxis, emptyText, tableHeaders }: ColumnChartProps) {
  const { t } = useI18n()
  const ticks = [top, top / 2, 0]
  const peak = columns.reduce<ChartColumn | null>((best, column) => (column.value > (best?.value ?? 0) ? column : best), null)
  const position = (value: number) => `${(1 - value / top) * 100}%`
  const describe = (value: number) => (value > 0 ? formatValue(value) : emptyText)

  return (
    <figure aria-label={label}>
      <div className="mt-6 flex gap-3">
        {/* Eixo dos valores */}
        <div aria-hidden="true" className="relative h-40 w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: position(tick) }}>
              {formatAxis(tick)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-40">
            {ticks.map((tick) => (
              <div key={tick} aria-hidden="true" className="absolute inset-x-0 border-t" style={{ top: position(tick) }} />
            ))}
            <div className="absolute inset-0 flex items-end gap-0.5">
              {columns.map((column, index) => (
                <Tooltip key={column.key}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      tabIndex={column.value > 0 ? 0 : -1}
                      aria-label={`${column.label}: ${describe(column.value)}`}
                      className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-sm outline-none hover:bg-accent/30 focus-visible:bg-accent/40"
                    >
                      {column.value > 0 && (
                        <span
                          className="relative block w-full max-w-6 rounded-t-[4px] bg-chart-bar transition group-hover:brightness-125 group-focus-visible:brightness-125"
                          style={{ height: `max(2px, ${(column.value / top) * 100}%)` }}
                        >
                          {column === peak && (
                            <span
                              className={cn(
                                "absolute -top-5 text-xs whitespace-nowrap text-foreground",
                                // Nas pontas, o valor encosta na coluna por dentro, para não sair do gráfico.
                                index === 0 ? "left-0" : index === columns.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2"
                              )}
                            >
                              {formatValue(column.value)}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-semibold first-letter:uppercase">{describe(column.value)}</p>
                    <p className="opacity-80">{column.label}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>

          <div aria-hidden="true" className="relative mt-2 h-4 text-xs text-muted-foreground">
            {columns.map((column, index) =>
              column.axisLabel === null ? null : (
                <span
                  key={column.key}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${((index + 0.5) / columns.length) * 100}%` }}
                >
                  {column.axisLabel}
                </span>
              )
            )}
          </div>
        </div>
      </div>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t.charts.viewAsTable}</summary>
        <table className="mt-2 w-full max-w-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 font-medium">{tableHeaders[0]}</th>
              <th className="py-1 text-right font-medium">{tableHeaders[1]}</th>
            </tr>
          </thead>
          <tbody>
            {columns
              .filter((column) => column.value > 0)
              .reverse()
              .map((column) => (
                <tr key={column.key} className="border-t">
                  <td className="py-1.5">{column.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatValue(column.value)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** Topo "redondo" do eixo para contagens (2, 4, 5, 10, 20, 25, 50...). */
export function countAxisMax(max: number): number {
  const steps = [2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]
  return steps.find((step) => step >= max) ?? Math.ceil(max / 1000) * 1000
}
