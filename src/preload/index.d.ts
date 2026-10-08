import type { AppApi } from "../shared/ipc"

// Avisa o TypeScript do React que window.api existe e qual é o formato dele.
declare global {
  interface Window {
    api: AppApi
  }
}
