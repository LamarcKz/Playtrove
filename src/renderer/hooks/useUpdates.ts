import { useEffect, useState } from "react"
import type { UpdateStatus } from "@shared/types"

/** A situação da atualização do app (o main avisa quando muda). null até a primeira leitura. */
export function useUpdates(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    let active = true
    let heardFromMain = false
    const stopListening = window.api.updates.onStatus((update) => {
      heardFromMain = true
      setStatus(update)
    })
    // A leitura inicial não pode passar por cima de um aviso que chegou antes dela.
    window.api.updates.getStatus().then((current) => {
      if (active && !heardFromMain) setStatus(current)
    })
    return () => {
      active = false
      stopListening()
    }
  }, [])

  return status
}
