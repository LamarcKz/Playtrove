import { createContext, useContext } from "react"
import type { Status } from "@shared/types"

/**
 * Os status da biblioteca (vindos do banco), disponíveis para qualquer componente sem precisar
 * passar por props de um em um. O App.tsx coloca o StatusesProvider em volta de tudo.
 */
const StatusesContext = createContext<Status[]>([])

export const StatusesProvider = StatusesContext.Provider

/** Os status, na ordem das colunas do Kanban. */
export function useStatuses(): Status[] {
  return useContext(StatusesContext)
}

/** Função que devolve o nome de um status pelo id (ou "—", se ele não existir mais). */
export function useStatusName(): (statusId: number) => string {
  const statuses = useStatuses()
  return (statusId) => statuses.find((status) => status.id === statusId)?.name ?? "—"
}
