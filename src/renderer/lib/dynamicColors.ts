/**
 * A paleta da cor dinâmica, montada a partir da cor de destaque do jogo como o BuildPalette do Aniki Helper
 * (MIT): a barra do topo, os menus, o foco e o fundo das telas secundárias são tons da mesma cor. As outras
 * cores continuam as da paleta escolhida.
 */
type Rgb = [number, number, number]

function parse(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : null
}

const css = (color: Rgb, alpha?: number) => "#" + [...color, ...(alpha === undefined ? [] : [alpha])].map((value) => value.toString(16).padStart(2, "0")).join("")
const darken = (color: Rgb, amount: number): Rgb => color.map((value) => Math.floor(value * (1 - amount))) as Rgb
const lighten = (color: Rgb, amount: number): Rgb => color.map((value) => Math.floor(value + (255 - value) * amount)) as Rgb
function saturate(color: Rgb, amount: number): Rgb {
  const y = .2126 * color[0] + .7152 * color[1] + .0722 * color[2]
  return color.map((value) => Math.max(0, Math.min(255, Math.round(y + (value - y) * (1 + amount))))) as Rgb
}
function hue([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d <= 0) return 0
  const h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60
  return h < 0 ? h + 360 : h
}

/** As variáveis CSS da tela cheia para a cor dada, ou um objeto vazio se a cor não for "#rrggbb". */
export function dynamicPalette(accentHex: string): Record<string, string> {
  const accent = parse(accentHex)
  if (!accent) return {}
  const h = hue(accent)
  const red = h <= 20 || h >= 330
  const purple = h >= 280 && h <= 329
  const light = purple ? saturate(lighten(accent, .28), .18) : saturate(lighten(accent, red ? .24 : .28), red ? .18 : .12)
  const lighter = purple ? saturate(lighten(accent, .42), .22) : saturate(lighten(accent, red ? .36 : .42), red ? .22 : .16)
  return {
    "--aniki-accent": css(accent),
    "--aniki-topbar-top": css(darken(accent, .16)),
    "--aniki-topbar-bottom": css(darken(accent, .54)),
    "--aniki-menu-top": css(darken(accent, .32)),
    "--aniki-menu-bottom": css(darken(accent, .70)),
    "--aniki-band": css(darken(accent, .56)),
    "--aniki-focus-right": css(lighter, 0xd0),
    "--aniki-focus-glow": css(light, 0x99),
    "--aniki-separator-edge": css(light, 0x18),
    "--aniki-secondary-center": css(darken(accent, .30)),
    "--aniki-secondary-mid": css(darken(accent, .48)),
    "--aniki-secondary-end": css(darken(accent, .76)),
  }
}
