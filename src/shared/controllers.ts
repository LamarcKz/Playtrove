/** Um modelo de controle que o app reconhece. */
export interface ControllerModel {
  vendorId: number
  productId: number
  name: string
}

/**
 * Controles que aparecem na barra do topo, com a bateria. No Electron, a interface lê cada um pela WebHID
 * (src/renderer/hooks/useControllers.ts), e o main libera o acesso só a eles (src/main/controllers.ts); no
 * Tauri, quem lê é o Rust (src-tauri/src/controllers.rs, com a mesma lista).
 */
const SUPPORTED_CONTROLLERS: ControllerModel[] = [
  { vendorId: 0x054c, productId: 0x0ce6, name: "DualSense" },
  { vendorId: 0x054c, productId: 0x0df2, name: "DualSense Edge" },
]

/** O modelo do aparelho, se ele for um dos controles reconhecidos. */
export function findControllerModel(vendorId: number, productId: number): ControllerModel | undefined {
  return SUPPORTED_CONTROLLERS.find((model) => model.vendorId === vendorId && model.productId === productId)
}

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
  /** Identificador só para o React (a WebHID não dá um id fixo para cada aparelho). */
  key: number
  name: string
  connection: ControllerConnection
  /** Bateria da última leitura; null enquanto a primeira não termina. */
  battery: BatteryReading | null
}
