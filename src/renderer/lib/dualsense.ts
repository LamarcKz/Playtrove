/**
 * Leitura do DualSense (e do DualSense Edge) pela WebHID: por onde ele está conectado e a bateria.
 * Os números seguem o driver oficial desses controles no Linux (hid-playstation).
 */

export type ControllerConnection = "usb" | "bluetooth"

/** Situação da bateria: descarregando (em uso), carregando, cheia ou desconhecida (erro). */
export type BatteryState = "discharging" | "charging" | "full" | "unknown"

export interface BatteryReading {
  /** Carga em %, estimada: o controle só informa de 10 em 10%. null quando desconhecida. */
  percent: number | null
  state: BatteryState
}

/**
 * O relatório completo de cada conexão, o que traz a bateria (o id não entra na conta dos bytes).
 * No Bluetooth os dados começam 1 byte depois, por isso o byte de status fica uma casa à frente.
 */
const FULL_REPORT = {
  usb: { id: 0x01, length: 63, statusOffset: 52 },
  bluetooth: { id: 0x31, length: 77, statusOffset: 53 },
} as const

/**
 * Relatórios de configuração (calibração e pareamento). Pedir um deles faz o controle sair do modo
 * simples em que começa no Bluetooth (sem a bateria) e passar a mandar o relatório completo, o
 * mesmo que a Steam usa. O controle fica nesse modo até ser desligado.
 */
const FULL_MODE_FEATURE_REPORTS = [0x05, 0x09]

/**
 * Por onde o controle está conectado. Não dá para saber pelos relatórios que chegam: no Bluetooth,
 * o modo simples também usa o id 0x01 e tem o mesmo tamanho do completo. Mas só no Bluetooth o
 * controle declara o relatório 0x31.
 */
export function getConnection(device: HIDDevice): ControllerConnection {
  const declaresBluetoothReport = device.collections.some((collection) =>
    collection.inputReports?.some((report) => report.reportId === FULL_REPORT.bluetooth.id)
  )
  return declaresBluetoothReport ? "bluetooth" : "usb"
}

/** Tira a bateria de um relatório do controle. null se não for o relatório completo da conexão. */
export function parseBattery(connection: ControllerConnection, reportId: number, data: DataView): BatteryReading | null {
  const report = FULL_REPORT[connection]
  if (reportId !== report.id || data.byteLength < report.length) return null

  // Byte de status: os 4 bits de baixo são o nível (0 a 10) e os 4 de cima, a situação da carga.
  const status = data.getUint8(report.statusOffset)
  const level = status & 0x0f
  const charge = status >> 4
  // Cada nível vale uma faixa de 10% (o 7 vai de 70% a 79%); o meio da faixa é a melhor estimativa.
  const percent = Math.min(level * 10 + 5, 100)

  switch (charge) {
    case 0x0:
      return { percent, state: "discharging" }
    case 0x1:
      return { percent, state: "charging" }
    case 0x2:
      // Carga completa. O controle pode dizer isso com o nível em 9 (ele para de carregar um pouco
      // antes do fim), então vale o nível que ele informou, e não 100% fixo.
      return { percent, state: "full" }
    default:
      // 0xa e 0xb: temperatura ou tensão fora do normal; 0xf: erro na carga.
      return { percent: null, state: "unknown" }
  }
}

/**
 * Lê a bateria do controle: abre, espera um relatório completo e fecha. O controle fica aberto só
 * por um instante porque ele manda de 250 a 600 relatórios por segundo, e ouvir todos o tempo todo
 * gastaria processamento à toa (inclusive enquanto você joga).
 */
export async function readBattery(device: HIDDevice): Promise<BatteryReading | null> {
  const connection = getConnection(device)
  await device.open()
  try {
    let reading = await waitForBattery(device, connection, 500)
    // Nenhum relatório completo: é o Bluetooth no modo simples. Pedir a configuração muda o modo.
    for (const reportId of FULL_MODE_FEATURE_REPORTS) {
      if (reading) break
      await device.receiveFeatureReport(reportId).catch(() => undefined)
      reading = await waitForBattery(device, connection, 1000)
    }
    return reading
  } finally {
    await device.close().catch(() => undefined)
  }
}

/** Espera o primeiro relatório completo do controle, por no máximo `timeoutMs` milissegundos. */
function waitForBattery(
  device: HIDDevice,
  connection: ControllerConnection,
  timeoutMs: number
): Promise<BatteryReading | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), timeoutMs)

    function handleReport(event: HIDInputReportEvent) {
      const reading = parseBattery(connection, event.reportId, event.data)
      if (reading) finish(reading)
    }

    function finish(reading: BatteryReading | null) {
      clearTimeout(timer)
      device.removeEventListener("inputreport", handleReport)
      resolve(reading)
    }

    device.addEventListener("inputreport", handleReport)
  })
}
