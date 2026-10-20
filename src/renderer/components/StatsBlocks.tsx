import type { ReactNode } from "react"

/** Blocos das telas de números (Estatísticas e Conquistas). */

/** Um número do resumo do topo: nome, valor e um detalhe opcional. */
export function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4 [overflow-wrap:anywhere]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
      {detail && <dd className="mt-1 text-sm text-muted-foreground">{detail}</dd>}
    </div>
  )
}

/** Um bloco da tela, com título (e um detalhe na direita, opcional). */
export function StatsCard({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-xl border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-2">
        <h2 className="min-w-0 [overflow-wrap:anywhere] text-base font-semibold">{title}</h2>
        {detail && <p className="min-w-0 [overflow-wrap:anywhere] text-sm text-muted-foreground">{detail}</p>}
      </div>
      {children}
    </section>
  )
}

/** Aviso de bloco sem dados. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-2 py-3 text-sm text-muted-foreground">{children}</p>
}
