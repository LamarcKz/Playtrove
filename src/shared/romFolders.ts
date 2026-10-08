import type { EmulatorId, RetroArchCore } from "./types"

/** O que o app sugere para uma pasta de ROMs nova: emulador, core e console. */
export interface FolderSuggestion {
  emulatorId: EmulatorId
  core: string | null
  platform: string
}

/**
 * Nomes comuns de pastas de ROMs e o que cada uma costuma ser. `cores` são pedaços do nome de
 * cores do RetroArch que rodam aquele console, em ordem de preferência.
 */
const KNOWN_FOLDERS: { pattern: RegExp; emulatorId: EmulatorId; platform: string; cores?: string[] }[] = [
  { pattern: /^(ps3|playstation ?3)$/i, emulatorId: "rpcs3", platform: "PlayStation 3" },
  { pattern: /^(ps2|playstation ?2)$/i, emulatorId: "pcsx2", platform: "PlayStation 2" },
  { pattern: /^(ps1|psx|psone|playstation ?1?)$/i, emulatorId: "duckstation", platform: "PlayStation" },
  { pattern: /^(gba|game ?boy ?advance)$/i, emulatorId: "retroarch", platform: "Game Boy Advance", cores: ["mgba", "gpsp", "vba"] },
  { pattern: /^(gbc|game ?boy ?color)$/i, emulatorId: "retroarch", platform: "Game Boy Color", cores: ["mgba", "gambatte", "sameboy"] },
  { pattern: /^(gb|game ?boy)$/i, emulatorId: "retroarch", platform: "Game Boy", cores: ["mgba", "gambatte", "sameboy"] },
  { pattern: /^(ds|nds|nintendo ?ds)$/i, emulatorId: "retroarch", platform: "Nintendo DS", cores: ["melonds", "desmume"] },
  { pattern: /^(snes|super ?nintendo|super ?nes)$/i, emulatorId: "retroarch", platform: "Super Nintendo", cores: ["snes9x", "bsnes"] },
  { pattern: /^(nes|nintendo|famicom)$/i, emulatorId: "retroarch", platform: "NES", cores: ["mesen", "nestopia", "fceumm"] },
  { pattern: /^(n64|nintendo ?64)$/i, emulatorId: "retroarch", platform: "Nintendo 64", cores: ["mupen64plus", "parallel_n64"] },
  { pattern: /^(genesis|mega ?drive|md|sega ?genesis)$/i, emulatorId: "retroarch", platform: "Mega Drive", cores: ["genesis_plus_gx", "picodrive"] },
]

/**
 * Sugere a configuração de uma pasta de ROMs pelo nome dela (ex.: "PS2" → PCSX2 e PlayStation 2).
 * Pastas com nome desconhecido ficam com o RetroArch, o primeiro core instalado e o nome da pasta.
 */
export function suggestFolderSetup(folderName: string, cores: RetroArchCore[]): FolderSuggestion {
  const known = KNOWN_FOLDERS.find((entry) => entry.pattern.test(folderName.trim()))
  if (!known) return { emulatorId: "retroarch", core: cores[0]?.id ?? null, platform: folderName.trim() }
  if (known.emulatorId !== "retroarch") return { emulatorId: known.emulatorId, core: null, platform: known.platform }

  const core = known.cores?.map((name) => cores.find((c) => c.id.startsWith(name))).find(Boolean)
  return { emulatorId: "retroarch", core: core?.id ?? cores[0]?.id ?? null, platform: known.platform }
}
