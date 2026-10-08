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
    <ol aria-label={label} className="space-y-0.5">
      {items.map((item) => (
        <li
          key={item.id}
          className="group grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/40"
        >
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">{item.label}</div>
            {item.detail && <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.detail}</p>}
          </div>
          <div aria-hidden="true" className="h-3 min-w-0">
            {item.value > 0 && (
              <div
                className="h-full rounded-r-[4px] bg-chart-bar transition group-hover:brightness-125"
                style={{ width: `max(3px, ${(item.value / max) * 100}%)` }}
              />
            )}
          </div>
          <span className="text-right text-muted-foreground tabular-nums">{item.valueLabel}</span>
        </li>
      ))}
    </ol>
  )
}
