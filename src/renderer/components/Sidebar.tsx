import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/hooks/useI18n"
import { cn } from "@/lib/utils"
import { PAGE_ICONS, type PageId } from "@/pages"

/** Páginas que ficam no alto do menu. "Configurações" fica sozinha, lá embaixo. */
const MAIN_NAV: PageId[] = ["library", "stats", "achievements", "emulators"]

interface SidebarProps {
  currentPage: PageId
  onNavigate: (page: PageId) => void
}

/**
 * Menu lateral fixo, só com ícones. O nome de cada página aparece ao passar o mouse.
 * Tem a mesma cor da barra do topo, sem linha entre os dois.
 */
export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const { t } = useI18n()
  return (
    <nav
      aria-label={t.sidebar.label}
      className="flex w-16 shrink-0 flex-col items-center gap-1.5 bg-sidebar py-3 text-sidebar-foreground select-none"
    >
      {MAIN_NAV.map((page) => (
        <SidebarItem key={page} page={page} active={page === currentPage} onClick={() => onNavigate(page)} />
      ))}
      <SidebarItem
        page="settings"
        active={currentPage === "settings"}
        onClick={() => onNavigate("settings")}
        className="mt-auto"
      />
    </nav>
  )
}

interface SidebarItemProps {
  page: PageId
  active: boolean
  onClick: () => void
  className?: string
}

function SidebarItem({ page, active, onClick, className }: SidebarItemProps) {
  const { t } = useI18n()
  const title = t.pages[page]
  const Icon = PAGE_ICONS[page]

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={title}
          aria-current={active ? "page" : undefined}
          onClick={onClick}
          className={cn(
            "relative flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-3 focus-visible:ring-sidebar-ring/50",
            // Página atual: fundo destacado, ícone na cor principal e uma barrinha na borda esquerda.
            active &&
              "bg-sidebar-accent text-sidebar-primary before:absolute before:top-1/2 before:-left-2.5 before:h-6 before:w-1 before:-translate-y-1/2 before:rounded-r-full before:bg-sidebar-primary hover:bg-sidebar-accent hover:text-sidebar-primary",
            className
          )}
        >
          <Icon className="size-6" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {title}
      </TooltipContent>
    </Tooltip>
  )
}
