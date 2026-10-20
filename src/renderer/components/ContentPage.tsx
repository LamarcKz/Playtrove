import type { ReactNode } from "react"

/** Área comum das páginas de conteúdo: margens adaptáveis, largura útil e uma só rolagem vertical. */
export function ContentPage({ children }: { children: ReactNode }) {
  return (
    <div className="@container h-full overflow-y-auto">
      <div className="flex min-h-full flex-col p-4 @5xl:p-6">
        <div data-testid="page-content" className="@container/content mx-auto flex w-full max-w-[100rem] flex-1 flex-col gap-6">
          {children}
        </div>
      </div>
    </div>
  )
}
