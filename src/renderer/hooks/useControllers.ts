import { useEffect, useState } from "react"
import { findControllerModel, type BatteryReading, type ConnectedController } from "@shared/controllers"
import { getConnection, readBattery } from "@/lib/dualsense"

/** De quanto em quanto tempo a bateria é lida de novo. */
const REFRESH_INTERVAL_MS = 5_000

/**
 * Acompanha os controles reconhecidos (DualSense) conectados ao computador. Eles aparecem e somem
 * sozinhos ao conectar e desconectar, e a bateria é lida de novo a cada 5 segundos. No Tauri, quem lê é
 * o Rust, e a interface só ouve; no Electron, ela mesma lê pela WebHID.
 */
export function useControllers(): ConnectedController[] {
  const [controllers, setControllers] = useState<ConnectedController[]>([])

  useEffect(() => {
    const api = window.api.controllers
    if (!api) return watchWebHid(setControllers)
    let stopped = false
    void api.list().then((list) => {
      if (!stopped) setControllers(list)
    })
    const stop = api.onChange(setControllers)
    return () => {
      stopped = true
      stop()
    }
  }, [])

  return controllers
}

/** Os controles pela WebHID (no Electron). Devolve uma função para parar de acompanhar. */
function watchWebHid(publishList: (controllers: ConnectedController[]) => void): () => void {
  const { hid } = navigator
  const tracked = new Map<HIDDevice, ConnectedController>()
  const busy = new Set<HIDDevice>() // controles com uma leitura em andamento
  let nextKey = 1
  let stopped = false

  const publish = () => publishList([...tracked.values()])

  async function refresh(device: HIDDevice) {
    if (busy.has(device)) return
    busy.add(device)
    try {
      const battery = await readBattery(device)
      const current = tracked.get(device)
      if (stopped || !current || !battery || isSameBattery(current.battery, battery)) return
      tracked.set(device, { ...current, battery })
      publish()
    } catch {
      // O controle desconectou no meio da leitura: o evento "disconnect" tira ele da lista.
    } finally {
      busy.delete(device)
    }
  }

  function add(device: HIDDevice) {
    const model = findControllerModel(device.vendorId, device.productId)
    if (stopped || !model || tracked.has(device)) return
    tracked.set(device, { key: nextKey++, name: model.name, connection: getConnection(device), battery: null })
    publish()
    void refresh(device)
  }

  function remove(device: HIDDevice) {
    if (tracked.delete(device)) publish()
  }

  const handleConnect = (event: HIDConnectionEvent) => add(event.device)
  const handleDisconnect = (event: HIDConnectionEvent) => remove(event.device)
  hid.addEventListener("connect", handleConnect)
  hid.addEventListener("disconnect", handleDisconnect)
  void hid.getDevices().then((devices) => devices.forEach(add))
  const timer = setInterval(() => tracked.forEach((_, device) => void refresh(device)), REFRESH_INTERVAL_MS)

  return () => {
    stopped = true
    clearInterval(timer)
    hid.removeEventListener("connect", handleConnect)
    hid.removeEventListener("disconnect", handleDisconnect)
  }
}

function isSameBattery(a: BatteryReading | null, b: BatteryReading): boolean {
  return a?.percent === b.percent && a.state === b.state
}
