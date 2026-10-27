import { useEffect, useState } from "react"
import type { Game } from "@shared/types"
import { dynamicPalette } from "@/lib/dynamicColors"

/** Espera da seleção parar antes de ler a arte, como o Aniki Helper (DebounceMs). */
const DYNAMIC_DELAY_MS = 800

/**
 * As cores da cor dinâmica para o jogo selecionado: o Rust tira a cor de destaque da arte e a interface
 * monta os tons. Enquanto a cor nova não chega, ficam as do jogo anterior; desligada, nenhuma.
 */
export function useDynamicPalette(game: Game | undefined, enabled: boolean): Record<string, string> {
  const [palette, setPalette] = useState<Record<string, string>>({})
  const id = enabled ? game?.id : undefined
  const art = enabled ? `${game?.backgroundUrl}|${game?.coverUrl}` : ""
  useEffect(() => {
    if (id === undefined) return
    let live = true
    const timer = setTimeout(() => {
      void window.api.games.accentColor(id).then((hex) => { if (live) setPalette(hex ? dynamicPalette(hex) : {}) }).catch(() => {})
    }, DYNAMIC_DELAY_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [id, art])
  return enabled ? palette : {}
}
