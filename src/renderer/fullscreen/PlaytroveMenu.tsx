import { Lock, LogOut, Minimize2, Monitor, Moon, Power, RefreshCw, RotateCcw, Settings2, Shuffle, CircleQuestionMark, type LucideIcon } from "lucide-react"
import { POWER_ACTIONS, type PowerAction } from "@shared/fullscreen"
import { useI18n } from "@/hooks/useI18n"

const POWER_ICONS: Record<PowerAction, LucideIcon> = { lock: Lock, sleep: Moon, restart: RotateCcw, shutdown: Power }

interface MenuProps {
  canRandom: boolean
  updating: boolean
  onDesktop: () => void
  onSettings: () => void
  onUpdate: () => void
  onRandom: () => void
  onHelp: () => void
  onMinimize: () => void
  onExit: () => void
  onPower: (action: PowerAction) => void
}

/** O menu principal do tema Playtrove, como o MainMenu da tela cheia do Playnite (Options ou o botão Menu). */
export function PlaytroveMenu({ canRandom, updating, onDesktop, onSettings, onUpdate, onRandom, onHelp, onMinimize, onExit, onPower }: MenuProps) {
  const { t } = useI18n()
  return <div className="fs-menu" data-testid="playtrove-menu">
    <h2>{t.fullscreen.mainMenu}</h2>
    <div className="fs-menu-items">
      <button type="button" data-fs-default onClick={onDesktop}><Monitor />{t.fullscreen.desktopMode}</button>
      <button type="button" onClick={onSettings}><Settings2 />{t.fullscreen.settings}</button>
      <button type="button" disabled={updating} onClick={onUpdate}><RefreshCw />{updating ? t.fullscreen.updatingLibrary : t.fullscreen.updateLibrary}</button>
      <button type="button" disabled={!canRandom} onClick={onRandom}><Shuffle />{t.fullscreen.randomGame}</button>
      <button type="button" onClick={onHelp}><CircleQuestionMark />{t.fullscreen.help}</button>
      <button type="button" onClick={onMinimize}><Minimize2 />{t.fullscreen.minimize}</button>
      <button type="button" onClick={onExit}><LogOut />{t.fullscreen.exitApp}</button>
    </div>
    <h3>{t.fullscreen.power}</h3>
    <div className="fs-menu-items">
      {POWER_ACTIONS.map((action) => {
        const Icon = POWER_ICONS[action]
        return <button type="button" key={action} onClick={() => onPower(action)}><Icon />{t.fullscreen.powerActions[action]}</button>
      })}
    </div>
  </div>
}

/** A confirmação antes de bloquear, suspender, reiniciar ou desligar; o foco começa no Cancelar. */
export function PowerConfirm({ action, onConfirm, onCancel }: { action: PowerAction; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n()
  return <div className="fs-power-confirm">
    <h2>{t.fullscreen.powerActions[action]}</h2>
    <p>{t.fullscreen.powerConfirm[action]}</p>
    <div className="fs-dialog-actions">
      <button type="button" data-fs-default onClick={onCancel}>{t.common.cancel}</button>
      <button type="button" className="fs-primary" onClick={onConfirm}>{t.fullscreen.powerActions[action]}</button>
    </div>
  </div>
}
