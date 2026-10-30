import type { ControllerButton } from "./controllers"

/** Variantes comprovadas nos presets do Aniki; a seleção altera somente a apresentação. */
export const CONTROLLER_ICON_STYLES = [
  "playstation", "playstation-dark", "playstation-retro", "xbox", "xbox-dark", "xbox-retro",
  "switch", "switch-dark", "switch-retro", "8bitdo", "8bitdo-pro3", "rog-ally", "iris",
  "generic", "generic-dark", "native",
] as const
export type ControllerIconStyle = (typeof CONTROLLER_ICON_STYLES)[number]

const controllerFolders: Record<Exclude<ControllerIconStyle, "native">, string> = {
  playstation: "PlayStation",
  "playstation-dark": "PlayStation/Playstation Dark",
  "playstation-retro": "PlayStation/Playstation Retro",
  xbox: "Xbox",
  "xbox-dark": "Xbox/Xbox Dark",
  "xbox-retro": "Xbox/Xbox-Retro",
  switch: "Switch",
  "switch-dark": "Switch/Switch Black",
  "switch-retro": "Switch/Switch Retro",
  "8bitdo": "8BitDo Pro",
  "8bitdo-pro3": "8BitDo Pro/8BitDo Pro 3",
  "rog-ally": "RogAlly",
  iris: "Iris",
  generic: "Generic",
  "generic-dark": "Generic/Generic Dark",
}
const buttonFiles: Partial<Record<ControllerButton, string>> = {
  cross: "A", circle: "B", square: "X", triangle: "Y", l1: "LeftShoulder", r1: "RightShoulder",
  l3: "LS", r3: "RS", options: "Start", create: "Back",
}

/** Caminho relativo ao pacote instalado; nenhum arquivo do pacote entra nas fontes. */
export function anikiControllerImage(style: ControllerIconStyle, button: ControllerButton): string | null {
  const file = buttonFiles[button]
  return style === "native" || !file ? null : `Images/Buttons/Controller/${controllerFolders[style]}/Button-${file}.png`
}

/** Índices expostos pelo AnikiThemeSettings; o primeiro usa Avatar.png. */
export const ANIKI_AVATAR_INDICES = Array.from({ length: 61 }, (_, index) => index + 1)

export function anikiAvatarImage(index: number | null): string | null {
  if (index === null || !Number.isInteger(index) || index < 1 || index > 61) return null
  return `Themes Option/3.Avatar/Avatar${index === 1 ? "" : ` (${index})`}.png`
}
