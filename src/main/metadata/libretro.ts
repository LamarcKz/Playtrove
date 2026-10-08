import { basename, extname } from "node:path"
import type { MetadataEndpoints } from "./http"
import { comparableName } from "./matching"

/**
 * libretro-thumbnails: as capas oficiais (a caixa escaneada) que o RetroArch usa, uma pasta por
 * console, com o nome exato da ROM nos padrões No-Intro e Redump (os mesmos dos arquivos). Grátis e
 * sem chave. Para jogos de emulador, é a fonte mais certeira: acha a capa da versão e da região da
 * ROM (escolha do usuário em 2026-09-19).
 */

/** Nome de cada console no servidor de capas, pelo console da pasta de ROMs (e alguns apelidos). */
const LIBRETRO_SYSTEMS: Record<string, string> = {
  playstation: "Sony - PlayStation",
  ps1: "Sony - PlayStation",
  psx: "Sony - PlayStation",
  "playstation 2": "Sony - PlayStation 2",
  ps2: "Sony - PlayStation 2",
  "playstation portable": "Sony - PlayStation Portable",
  psp: "Sony - PlayStation Portable",
  "game boy advance": "Nintendo - Game Boy Advance",
  gba: "Nintendo - Game Boy Advance",
  "game boy": "Nintendo - Game Boy",
  gb: "Nintendo - Game Boy",
  "game boy color": "Nintendo - Game Boy Color",
  gbc: "Nintendo - Game Boy Color",
  "nintendo ds": "Nintendo - Nintendo DS",
  nds: "Nintendo - Nintendo DS",
  ds: "Nintendo - Nintendo DS",
  "super nintendo": "Nintendo - Super Nintendo Entertainment System",
  snes: "Nintendo - Super Nintendo Entertainment System",
  nes: "Nintendo - Nintendo Entertainment System",
  "nintendo 64": "Nintendo - Nintendo 64",
  n64: "Nintendo - Nintendo 64",
  "mega drive": "Sega - Mega Drive - Genesis",
  genesis: "Sega - Mega Drive - Genesis",
  "sega genesis": "Sega - Mega Drive - Genesis",
}

/**
 * Endereço da capa de uma ROM no libretro-thumbnails, ex.:
 * …/Sony - PlayStation 2/Named_Boxarts/Corrida Noturna - Edição Turbo (USA).png.
 * null se o console não estiver lá (ex.: PlayStation 3) ou o jogo não tiver ROM.
 */
export function libretroBoxartUrl(endpoints: MetadataEndpoints, platform: string | null, romPath: string | null): string | null {
  if (!platform || !romPath) return null
  const system = LIBRETRO_SYSTEMS[comparableName(platform)]
  if (!system) return null
  // O RetroArch troca estes caracteres por "_" nos nomes dos arquivos de capa.
  const name = basename(romPath, extname(romPath)).replace(/[&*/:`<>?\\|"]/g, "_")
  return `${endpoints.libretroThumbnails}/${encodeURIComponent(system)}/Named_Boxarts/${encodeURIComponent(name)}.png`
}
