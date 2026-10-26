/**
 * Os controles que aparecem na barra do topo (DualSense e DualSense Edge), com a bateria. Quem acha e lê
 * cada um é o Rust (src-tauri/src/controllers.rs); a interface recebe a lista pronta.
 */

export type ControllerConnection = "usb" | "bluetooth"

/** Situação da bateria: descarregando (em uso), carregando, cheia ou desconhecida (erro). */
export type BatteryState = "discharging" | "charging" | "full" | "unknown"

export interface BatteryReading {
  /** Carga em %, estimada: o controle só informa de 10 em 10%. null quando desconhecida. */
  percent: number | null
  state: BatteryState
}

/** Um controle conectado, como aparece na barra do topo. */
export interface ConnectedController {
  /** Identificador só para o React. */
  key: number
  name: string
  connection: ControllerConnection
  /** Bateria da última leitura; null enquanto a primeira não termina. */
  battery: BatteryReading | null
}

/** Botões digitais de navegação; eixos são normalizados pelo leitor nativo. */
export type ControllerButton =
  | "up"
  | "down"
  | "left"
  | "right"
  | "cross"
  | "circle"
  | "square"
  | "triangle"
  | "l1"
  | "r1"
  | "options"
  | "create"

/** Só mudanças são publicadas; sequência e geração descartam respostas de uma sessão antiga. */
export interface ControllerInputSnapshot {
  sequence: number
  generation: number
  controllerKey: number | null
  buttons: ControllerButton[]
}
