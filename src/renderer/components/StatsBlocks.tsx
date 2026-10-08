import type { ReactNode } from "react"

/** Blocos das telas de números (Estatísticas e Conquistas). */

/** Um número do resumo do topo: nome, valor e um detalhe opcional. */
export function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight">{value}</dd>
      {detail && <dd className="mt-1 text-xs text-muted-foreground">{detail}</dd>}
    </div>
  )
}

/** Um bloco da tela, com título (e um detalhe na direita, opcional). */
export function StatsCard({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-4 px-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      </div>
      {children}
    </section>
  )
}

/** Aviso de bloco sem dados. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-2 py-3 text-sm text-muted-foreground">{children}</p>
}
