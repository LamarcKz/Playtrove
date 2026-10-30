import { useI18n } from "@/hooks/useI18n"
import { AnikiIcon, type ANIKI_ICONS } from "./AnikiGlyph"
import { POWER_ACTIONS, type PowerAction } from "@shared/fullscreen"

interface Props { canRandom: boolean; updating: boolean; onSettings: () => void; onRandom: () => void; onMinimize: () => void; onDesktop: () => void; onExit: () => void; onUpdate: () => void; onHelp: () => void; onPower: (action: PowerAction) => void }

/** Menu principal do Aniki: painel à esquerda com as ações do app e a volta ao modo janela. */
export function AnikiMainMenu({ canRandom, updating, onSettings, onRandom, onMinimize, onDesktop, onExit, onUpdate, onHelp, onPower }: Props) {
  const { t } = useI18n()
  const items: { icon: keyof typeof ANIKI_ICONS; label: string; action: () => void; disabled?: boolean }[] = [
    { icon: "settings", label: t.fullscreen.settings, action: onSettings },
    { icon: "refresh", label: updating ? t.fullscreen.updatingLibrary : t.fullscreen.updateLibrary, action: onUpdate, disabled: updating },
    { icon: "random", label: t.fullscreen.randomGame, action: onRandom, disabled: !canRandom },
    { icon: "help", label: t.fullscreen.help, action: onHelp },
    { icon: "minimize", label: t.fullscreen.minimize, action: onMinimize },
    { icon: "desktop", label: t.fullscreen.desktopMode, action: onDesktop },
    { icon: "exit", label: t.fullscreen.exitApp, action: onExit },
  ]
  return <div className="aniki-main-menu" data-testid="aniki-main-menu">
    <h2>{t.fullscreen.mainMenu}</h2>
    <div className="aniki-menu-items">
      {items.map((item, index) => <button type="button" key={item.icon} data-fs-default={index === 0 ? "" : undefined} disabled={item.disabled} onClick={item.action}><AnikiIcon icon={item.icon} /><span>{item.label}</span></button>)}
    </div>
    <h3>{t.fullscreen.power}</h3>
    <div className="aniki-menu-items">
      {POWER_ACTIONS.map((action) => <button type="button" key={action} onClick={() => onPower(action)}><AnikiIcon icon={action === "shutdown" ? "power" : action} /><span>{t.fullscreen.powerActions[action]}</span></button>)}
    </div>
  </div>
}
