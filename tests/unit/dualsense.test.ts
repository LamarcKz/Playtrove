import { describe, expect, it } from "vitest"
import { getConnection, parseBattery } from "@/lib/dualsense"

/** Um relatório do controle com `length` bytes e o byte de status na posição `offset`. */
function report(length: number, offset: number | null = null, status = 0): DataView {
  const data = new DataView(new ArrayBuffer(length))
  if (offset !== null) data.setUint8(offset, status)
  return data
}

describe("parseBattery: USB", () => {
  it("lê o nível e a situação da carga no byte 52 do relatório 0x01", () => {
    expect(parseBattery("usb", 0x01, report(63, 52, 0x2a))).toEqual({ percent: 100, state: "full" })
    expect(parseBattery("usb", 0x01, report(63, 52, 0x16))).toEqual({ percent: 65, state: "charging" })
    expect(parseBattery("usb", 0x01, report(63, 52, 0xf0))).toEqual({ percent: null, state: "unknown" })
    // Carga completa com o nível em 9: vale o que o controle informou (bytes reais do controle dele).
    expect(parseBattery("usb", 0x01, report(63, 52, 0x29))).toEqual({ percent: 95, state: "full" })
    // No cabo, mas sem carregar: o controle diz que está descarregando.
    expect(parseBattery("usb", 0x01, report(63, 52, 0x07))).toEqual({ percent: 75, state: "discharging" })
  })
  it("ignora outros relatórios", () => {
    expect(parseBattery("usb", 0x31, report(77, 53, 0x09))).toBeNull()
    expect(parseBattery("usb", 0x02, report(63, 52, 0x2a))).toBeNull()
  })
})

describe("parseBattery: Bluetooth", () => {
  it("lê o byte 53 do relatório completo 0x31 (bytes reais do controle do usuário)", () => {
    expect(parseBattery("bluetooth", 0x31, report(77, 53, 0x09))).toEqual({ percent: 95, state: "discharging" })
    expect(parseBattery("bluetooth", 0x31, report(77, 53, 0x00))).toEqual({ percent: 5, state: "discharging" })
    expect(parseBattery("bluetooth", 0x31, report(77, 53, 0x0a))).toEqual({ percent: 100, state: "discharging" })
    expect(parseBattery("bluetooth", 0x31, report(77, 53, 0x13))).toEqual({ percent: 35, state: "charging" })
    expect(parseBattery("bluetooth", 0x31, report(77, 53, 0xa5))).toEqual({ percent: null, state: "unknown" })
  })
  it("o modo simples (0x01, com o mesmo tamanho no Windows) não é confundido com o USB — o bug real", () => {
    const simple = report(77, 52, 0x8e)
    simple.setUint8(53, 0x09)
    expect(parseBattery("bluetooth", 0x01, simple)).toBeNull()
    expect(parseBattery("bluetooth", 0x01, report(9))).toBeNull()
    expect(parseBattery("bluetooth", 0x31, report(20))).toBeNull()
  })
})

describe("getConnection", () => {
  const device = (reportIds: number[]) =>
    ({ collections: [{ inputReports: reportIds.map((reportId) => ({ reportId })) }] }) as unknown as HIDDevice
  it("só o Bluetooth declara o relatório 0x31", () => {
    expect(getConnection(device([0x01]))).toBe("usb")
    expect(getConnection(device([0x01, 0x31]))).toBe("bluetooth")
    expect(getConnection({ collections: [{}] } as unknown as HIDDevice)).toBe("usb")
  })
})
