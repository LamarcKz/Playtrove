import { useState } from "react"
import { AchievementNotifier } from "@/components/AchievementNotifier"
import { I18nProvider } from "@/components/I18nProvider"
import { LibraryTools, type LibraryView } from "@/components/LibraryTools"
import { Sidebar } from "@/components/Sidebar"
import { ToastProvider } from "@/components/ToastProvider"
import { TopBar } from "@/components/TopBar"
import { UpdateNotice } from "@/components/UpdateNotice"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useI18n } from "@/hooks/useI18n"
import { useLibrary } from "@/hooks/useLibrary"
import { StatusesProvider } from "@/hooks/useStatuses"
import { EMPTY_FILTERS, hasActiveFilters, type LibraryFilters } from "@/lib/filters"
import type { PageId } from "@/pages"
import { AchievementsPage } from "@/pages/AchievementsPage"
import { EmulatorsPage } from "@/pages/EmulatorsPage"
import { LibraryPage } from "@/pages/LibraryPage"
import { SettingsPage } from "@/pages/SettingsPage"
import { StatsPage } from "@/pages/StatsPage"

/** O app: o idioma (I18nProvider) em volta de tudo. */
export function App() {
  return (
    <I18nProvider>
      <AppLayout />
    </I18nProvider>
  )
}

/**
 * Layout principal: a barra do topo e o menu lateral formam uma moldura contínua (mesma cor,
 * sem linha entre eles) e a página atual fica encaixada nela, com o canto arredondado.
 */
function AppLayout() {
  const { t } = useI18n()
  const [currentPage, setCurrentPage] = useState<PageId>("library")

  // Busca, filtros e modo de exibição ficam aqui, e não na página, porque os controles estão
  // na barra do topo e porque assim eles não se perdem ao trocar de aba.
  const [searchQuery, setSearchQuery] = useState("")
  const [libraryFilters, setLibraryFilters] = useState<LibraryFilters>(EMPTY_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [libraryView, setLibraryView] = useState<LibraryView>("details")

  // A biblioteca (jogos e status do banco) também fica aqui. Os status ficam disponíveis para
  // todos os componentes pelo StatusesProvider.
  const { loading, games, statuses, rules, setGameStatus } = useLibrary()

  return (
    <TooltipProvider delayDuration={300}>
      <ToastProvider pinned={<UpdateNotice />}>
        <AchievementNotifier />
        <StatusesProvider value={statuses}>
          <div className="flex h-screen flex-col bg-sidebar">
            <TopBar>
              {currentPage === "library" ? (
                <LibraryTools
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  filtersOpen={filtersOpen}
                  filtersActive={hasActiveFilters(libraryFilters)}
                  onToggleFilters={() => setFiltersOpen((open) => !open)}
                  view={libraryView}
                  onViewChange={setLibraryView}
                />
              ) : (
                <h1 className="text-sm font-semibold text-foreground">{t.pages[currentPage]}</h1>
              )}
            </TopBar>

            <div className="flex min-h-0 flex-1">
              <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
              <main className="min-w-0 flex-1 overflow-hidden rounded-tl-xl border-t border-l bg-background">
                {currentPage === "library" && !loading && (
                  <LibraryPage
                    games={games}
                    searchQuery={searchQuery}
                    filters={libraryFilters}
                    onFiltersChange={setLibraryFilters}
                    filtersOpen={filtersOpen}
                    onCloseFilters={() => setFiltersOpen(false)}
                    view={libraryView}
                    onGameStatusChange={setGameStatus}
                    onOpenEmulators={() => setCurrentPage("emulators")}
                  />
                )}
                {currentPage === "stats" && !loading && (
                  <StatsPage games={games} onOpenEmulators={() => setCurrentPage("emulators")} />
                )}
                {currentPage === "achievements" && !loading && (
                  <AchievementsPage games={games} onOpenSettings={() => setCurrentPage("settings")} />
                )}
                {currentPage === "emulators" && <EmulatorsPage games={games} />}
                {currentPage === "settings" && <SettingsPage games={games} rules={rules} />}
              </main>
            </div>
          </div>
        </StatusesProvider>
      </ToastProvider>
    </TooltipProvider>
  )
}
