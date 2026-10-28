import type { ControllerButton } from "@shared/controllers"
import { AnikiGlyph } from "./AnikiGlyph"

export interface AnikiShortcut { button: ControllerButton; label: string; hold?: string }

/** Legenda dos atalhos do controle acima da faixa de capas, como a barra inferior do Aniki. */
export function AnikiShortcutBar({ shortcuts }: { shortcuts: AnikiShortcut[] }) {
  return <ul className="aniki-shortcuts" data-testid="aniki-shortcuts">
    {shortcuts.map((item) => <li key={item.button}>
      <AnikiGlyph button={item.button} />
      <span className="aniki-shortcut-text"><span>{item.label}</span>{item.hold && <small>{item.hold}</small>}</span>
    </li>)}
  </ul>
}
