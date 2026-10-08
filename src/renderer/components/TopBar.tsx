import { useEffect, useState, type ComponentProps, type ReactNode } from "react"
import { Copy, Minus, Square, X } from "lucide-react"
import { AppLogo } from "@/components/AppLogo"
import { ControllerIndicator } from "@/components/ControllerIndicator"
import { MetadataStatus } from "@/components/MetadataStatus"
import { useI18n } from "@/hooks/useI18n"
import { isDevBuild } from "@/lib/devBuild"
import { cn } from "@/lib/utils"

interface TopBarProps {
  /** Conteúdo do meio da barra, que muda conforme a página (ex.: busca e filtros na Biblioteca). */
  children?: ReactNode
}

/**
 * Barra única do topo, no estilo do Playnite: substitui a barra do Windows e junta o logo,
 * as ferramentas da página, o controle conectado e os botões da janela. Arrastar pela área vazia
 * move a janela.
 * Tem a mesma cor do menu lateral, sem linha entre os dois.
 */
export function TopBar({ children }: TopBarProps) {
  const { t } = useI18n()
  const { minimize, toggleMaximize, close } = window.api.windowControls
  const isMaximized = useIsMaximized()

  return (
    <header className="app-drag flex h-12 shrink-0 items-center bg-sidebar text-sidebar-foreground select-none">
      {/* Mesma largura do menu lateral, para o logo ficar alinhado com os ícones de baixo. */}
      <div className="relative flex w-16 shrink-0 justify-center">
        <AppLogo />
        {isDevBuild && (
          <span
            title={t.topBar.devHint}
            className="absolute -bottom-1.5 rounded bg-dev px-1 text-[9px] leading-3.5 font-bold text-dev-foreground"
          >
            {t.topBar.dev}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center pl-2">{children}</div>

      {/* Download de metadados em andamento. Some quando não há download. */}
      <MetadataStatus />

      {/* Controle conectado (DualSense): conexão e bateria. Some quando não há controle. */}
      <ControllerIndicator />

      <div className="app-no-drag flex h-full">
        <WindowButton label={t.topBar.minimize} onClick={() => minimize()}>
          <Minus />
        </WindowButton>
        {/* Em janela: um quadrado (maximizar). Maximizada: dois quadrados (restaurar), como no Windows. */}
        <WindowButton label={isMaximized ? t.topBar.restore : t.topBar.maximize} onClick={() => toggleMaximize()}>
          {isMaximized ? <Copy className="size-3.5 -scale-x-100" /> : <Square className="size-3.5" />}
        </WindowButton>
        <WindowButton label={t.topBar.close} onClick={() => close()} className="hover:bg-destructive hover:text-white">
          <X />
        </WindowButton>
      </div>
    </header>
  )
}

interface WindowButtonProps extends ComponentProps<"button"> {
  label: string
}

/** Botão no estilo dos controles de janela do Windows. */
function WindowButton({ label, className, ...props }: WindowButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "flex h-full w-[46px] items-center justify-center transition-colors outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:bg-foreground/10 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

/** Acompanha se a janela está maximizada (canal IPC "window:state"). */
function useIsMaximized(): boolean {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const { getState, onStateChange } = window.api.windowControls
    let active = true

    // Estado inicial...
    getState().then((state) => {
      if (active) setIsMaximized(state.isMaximized)
    })
    // ...e cada mudança avisada pelo main.
    const stopListening = onStateChange((state) => setIsMaximized(state.isMaximized))

    return () => {
      active = false
      stopListening()
    }
  }, [])

  return isMaximized
}
