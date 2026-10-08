/** Um modelo de controle que o app reconhece. */
export interface ControllerModel {
  vendorId: number
  productId: number
  name: string
}

/**
 * Controles que aparecem na barra do topo, com a bateria. A interface lê cada um pela WebHID
 * (src/renderer/hooks/useControllers.ts), e o main libera o acesso só a eles (src/main/controllers.ts).
 */
const SUPPORTED_CONTROLLERS: ControllerModel[] = [
  { vendorId: 0x054c, productId: 0x0ce6, name: "DualSense" },
  { vendorId: 0x054c, productId: 0x0df2, name: "DualSense Edge" },
]

/** O modelo do aparelho, se ele for um dos controles reconhecidos. */
export function findControllerModel(vendorId: number, productId: number): ControllerModel | undefined {
  return SUPPORTED_CONTROLLERS.find((model) => model.vendorId === vendorId && model.productId === productId)
}
