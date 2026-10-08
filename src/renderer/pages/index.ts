import { ChartColumn, Joystick, Library, Settings, Trophy, type LucideIcon } from "lucide-react"

/**
 * Identificador de cada página (aba) do app. O nome de cada uma fica no dicionário (pages).
 * Favoritos e Recentes não são páginas: são filtros da Biblioteca (components/FilterPanel.tsx).
 */
export type PageId = "library" | "stats" | "achievements" | "emulators" | "settings"

/** O ícone de cada página, no menu lateral. */
export const PAGE_ICONS: Record<PageId, LucideIcon> = {
  library: Library,
  stats: ChartColumn,
  achievements: Trophy,
  emulators: Joystick,
  settings: Settings,
}
