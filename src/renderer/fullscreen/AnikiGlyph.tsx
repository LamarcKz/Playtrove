import type { ControllerButton } from "@shared/controllers"

/** Ícones da fonte de símbolos do Windows (Segoe Fluent Icons), os mesmos códigos que o Aniki usa. */
export const ANIKI_ICONS = {
  settings: "\uE713",
  random: "\uE8B1",
  minimize: "\uE921",
  desktop: "\uE977",
  exit: "\uE8BB",
  trophy: "\uEC1B",
  heartFilled: "\uEB52",
  star: "\uE735",
  refresh: "\uE72C",
  power: "\uE7E8",
  music: "\uE8D6",
  home: "\uE80F",
  contact: "\uE77B",
} as const

export function AnikiIcon({ icon }: { icon: keyof typeof ANIKI_ICONS }) {
  return <span className="aniki-icon" aria-hidden="true">{ANIKI_ICONS[icon]}</span>
}

/** Símbolos dos botões do DualSense nas legendas, no estilo dos glifos de controle do Aniki. */
const symbols: Partial<Record<ControllerButton, string>> = {
  cross: "✕",
  circle: "○",
  square: "□",
  triangle: "△",
  l1: "L1",
  r1: "R1",
  l3: "L3",
  r3: "R3",
}
const icons: Partial<Record<ControllerButton, string>> = { options: "\uE700", create: "\uE8A1" }

export function AnikiGlyph({ button }: { button: ControllerButton }) {
  const icon = icons[button]
  return <span className={`aniki-glyph aniki-glyph-${button}`} aria-hidden="true">{icon ? <span className="aniki-icon">{icon}</span> : symbols[button]}</span>
}
