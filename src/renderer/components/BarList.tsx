import type { ReactNode } from "react"

export interface BarListItem {
  id: string | number
  /** O que aparece na esquerda (pode ter ícone). */
  label: ReactNode
  /** Linha pequena embaixo do nome (ex.: o tempo jogado de uma plataforma). */
  detail?: string
  /** O tamanho da barra (ex.: minutos jogados). */
  value: number
  /** O valor escrito na direita (ex.: "12 h 30 min"). */
  valueLabel: string
}

interface BarListProps {
  /** Nome da lista, para o leitor de tela. */
  label: string
  items: BarListItem[]
}

/**
 * Lista com barras horizontais (uma cor só, porque é uma medida só): nome, barra e valor escrito.
 * A maior barra ocupa a largura toda; as outras, proporcionais a ela.
 */
export function BarList({ label, items }: BarListProps) {
  const max = Math.max(1, ...items.map((item) => item.value))

  return (
    <ol aria-label={label} className="@container/bar-list flex flex-col gap-1">
      {items.map((item) => (
        <li
          key={item.id}
          className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent/40 @xl/bar-list:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto]"
        >
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">{item.label}</div>
            {item.detail && <p className="mt-0.5 [overflow-wrap:anywhere] text-sm text-muted-foreground">{item.detail}</p>}
          </div>
          <div
            aria-hidden="true"
            className="col-span-2 col-start-1 row-start-2 h-3 min-w-0 @xl/bar-list:col-span-1 @xl/bar-list:col-start-2 @xl/bar-list:row-start-1"
          >
            {item.value > 0 && (
              <div
                className="h-full rounded-r-[4px] bg-chart-bar transition group-hover:brightness-125"
                style={{ width: `max(3px, ${(item.value / max) * 100}%)` }}
              />
            )}
          </div>
          <span className="col-start-2 row-start-1 max-w-40 [overflow-wrap:anywhere] text-right text-muted-foreground tabular-nums @xl/bar-list:col-start-3">
            {item.valueLabel}
          </span>
        </li>
      ))}
    </ol>
  )
}
