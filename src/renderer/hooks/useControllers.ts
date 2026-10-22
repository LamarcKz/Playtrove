import { useEffect, useState } from "react"
import type { ConnectedController } from "@shared/controllers"

/**
 * Acompanha os controles reconhecidos (DualSense) conectados ao computador. Quem acha e lê cada um é o
 * Rust: eles aparecem e somem sozinhos ao conectar e desconectar, e a bateria é lida de novo a cada 5
 * segundos.
 */
export function useControllers(): ConnectedController[] {
  const [controllers, setControllers] = useState<ConnectedController[]>([])

  useEffect(() => {
    let stopped = false
    void window.api.controllers.list().then((list) => {
      if (!stopped) setControllers(list)
    })
    const stop = window.api.controllers.onChange(setControllers)
    return () => {
      stopped = true
      stop()
    }
  }, [])

  return controllers
}
