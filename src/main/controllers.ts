import { session } from "electron"
import { findControllerModel } from "../shared/controllers"
import { isAppOrigin } from "./window"

/**
 * Deixa a interface ler os controles reconhecidos (DualSense) pela WebHID, sem janela de escolha,
 * para mostrar a bateria na barra do topo. Só a interface do próprio app ganha esse acesso, e só a
 * esses controles: qualquer outro aparelho (teclado, mouse...) continua bloqueado.
 */
export function allowControllerAccess(): void {
  session.defaultSession.setDevicePermissionHandler((details) => {
    if (details.deviceType !== "hid" || !isAppOrigin(details.origin)) return false
    const device = details.device as Electron.HIDDevice
    return findControllerModel(device.vendorId, device.productId) !== undefined
  })
}
