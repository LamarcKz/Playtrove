import { useI18n } from "@/hooks/useI18n"
import { AnikiIcon, type ANIKI_ICONS } from "./AnikiGlyph"

interface Props { canRandom: boolean; onSettings: () => void; onRandom: () => void; onMinimize: () => void; onDesktop: () => void; onExit: () => void }

/** Menu principal do Aniki: painel à esquerda com as ações do app e a volta ao modo janela. */
export function AnikiMainMenu({ canRandom, onSettings, onRandom, onMinimize, onDesktop, onExit }: Props) {
  const { t } = useI18n()
  const items: { icon: keyof typeof ANIKI_ICONS; label: string; action: () => void; disabled?: boolean }[] = [
    { icon: "settings", label: t.fullscreen.settings, action: onSettings },
    { icon: "random", label: t.fullscreen.randomGame, action: onRandom, disabled: !canRandom },
    { icon: "minimize", label: t.fullscreen.minimize, action: onMinimize },
    { icon: "desktop", label: t.fullscreen.desktopMode, action: onDesktop },
    { icon: "exit", label: t.fullscreen.exitApp, action: onExit },
  ]
  return <div className="aniki-main-menu" data-testid="aniki-main-menu">
    <h2>{t.fullscreen.mainMenu}</h2>
    <div className="aniki-menu-items">
      {items.map((item, index) => <button type="button" key={item.icon} data-fs-default={index === 0 ? "" : undefined} disabled={item.disabled} onClick={item.action}><AnikiIcon icon={item.icon} /><span>{item.label}</span></button>)}
    </div>
  </div>
}
