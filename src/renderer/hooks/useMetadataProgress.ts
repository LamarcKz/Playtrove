import { useEffect, useRef, useState } from "react"
import type { MetadataProgress } from "@shared/types"

/**
 * Andamento dos downloads de metadados (o main avisa a cada passo). null até a primeira leitura.
 * `onFinished` é chamado quando uma leva termina, com o resumo dela.
 */
export function useMetadataProgress(onFinished?: (progress: MetadataProgress) => void): MetadataProgress | null {
  const [progress, setProgress] = useState<MetadataProgress | null>(null)
  const onFinishedRef = useRef(onFinished)
  useEffect(() => {
    onFinishedRef.current = onFinished
  })

  useEffect(() => {
    let active = true
    let heardFromMain = false
    const stopListening = window.api.metadata.onProgress((update) => {
      heardFromMain = true
      setProgress(update)
      // O main só manda "parado" no fim de uma leva: é o aviso de que ela terminou.
      if (!update.running) onFinishedRef.current?.(update)
    })
    // A leitura inicial não pode passar por cima de um aviso que chegou antes dela.
    window.api.metadata.getProgress().then((current) => {
      if (active && !heardFromMain) setProgress(current)
    })
    return () => {
      active = false
      stopListening()
    }
  }, [])

  return progress
}
