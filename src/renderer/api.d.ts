import type { AppApi } from "@shared/ipc"

// Avisa o TypeScript que window.api existe e qual é o formato dele (quem preenche é o main.tsx).
declare global {
  interface Window {
    api: AppApi
  }
}
