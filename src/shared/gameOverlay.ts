/** Atalhos originais do Helper, com alternativa escolhida explicitamente quando F12 está reservado. */
export const IN_GAME_OVERLAY_HOTKEYS = ["CtrlShiftF12", "CtrlF12", "AltF12", "CtrlAltF12", "CtrlShiftF11"] as const
export type InGameOverlayHotkey = (typeof IN_GAME_OVERLAY_HOTKEYS)[number]

import type { ControllerInputSnapshot } from "./controllers"

export interface GameOverlayApi {
  getState: () => Promise<GameOverlayState>
  open: (gameId: number) => Promise<GameOverlayState>
  returnToGame: () => Promise<GameOverlayState>
  returnToApp: () => Promise<GameOverlayState>
  requestCloseGame: () => Promise<GameOverlayState>
  getInput: () => Promise<ControllerInputSnapshot>
  onInputChange: (callback: (snapshot: ControllerInputSnapshot) => void) => () => void
  onStateChange: (callback: (state: GameOverlayState) => void) => () => void
}

export interface GameOverlayState {
  open: boolean
  isFocused: boolean
  gameId: number | null
  enabled: boolean
  keyboardShortcutAvailable: boolean
  /** Só fica true depois de um relatório válido do DualSense decodificado pelo descritor HID. */
  controllerShortcutAvailable: boolean
}
