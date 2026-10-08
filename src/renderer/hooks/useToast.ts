import { createContext, useContext } from "react"

/** Um aviso rápido no canto da tela (ex.: "3 jogos novos"). */
export interface ToastMessage {
  title: string
  description?: string
  kind?: "info" | "success" | "error"
}

export const ToastContext = createContext<(toast: ToastMessage) => void>(() => undefined)

/** Função que mostra um aviso rápido no canto da tela. Precisa do ToastProvider (no App.tsx). */
export function useToast(): (toast: ToastMessage) => void {
  return useContext(ToastContext)
}
