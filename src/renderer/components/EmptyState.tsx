import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  /** Botão opcional embaixo do texto (ex.: "Limpar filtros"). */
  action?: ReactNode
}

/** Aviso centralizado para páginas ou listas sem conteúdo. */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="max-w-sm text-sm text-balance text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}
