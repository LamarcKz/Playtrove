import { expect, test } from "@playwright/test"
import { launchApp, removeDataDir } from "./helpers"

// Precisa do DualSense de verdade ligado (USB ou Bluetooth). Sem ele, o teste é pulado.
test("DualSense na barra do topo: conexão, bateria e leitura só por um instante", async () => {
  const { app, page, dataDir } = await launchApp()
  try {
    const devices = await page.evaluate(async () =>
      (await navigator.hid.getDevices()).map((device) => `${device.vendorId.toString(16)}:${device.productId.toString(16)}`)
    )
    test.skip(devices.length === 0, "Nenhum DualSense ligado agora.")
    expect(devices.every((device) => device === "54c:ce6" || device === "54c:df2")).toBe(true)

    const chip = page.locator('header [role="img"][aria-label^="DualSense"]')
    await expect(chip).toHaveAttribute("aria-label", /^DualSense conectado por (USB|Bluetooth) · (?!lendo)/, { timeout: 8000 })
    const label = (await chip.getAttribute("aria-label"))!
    await expect(chip).toHaveText(/^(Cheia|Carregando \d{1,3}%|\d{1,3}%)$/)
    const icons = await chip.evaluate((el) =>
      [...el.querySelectorAll("svg")].map((svg) => [...svg.classList].find((name) => name.startsWith("lucide-") && name !== "lucide"))
    )
    expect(icons).toContain(label.includes("por USB") ? "lucide-usb" : "lucide-bluetooth")

    // Tooltip com o texto completo.
    await chip.hover()
    await expect(page.locator('[data-slot="tooltip-content"]').first()).toContainText(label)

    // O controle fica fechado entre as leituras (o app só abre por um instante a cada 5 s).
    let openSamples = 0
    for (let i = 0; i < 20; i++) {
      if (await page.evaluate(async () => (await navigator.hid.getDevices()).some((device) => device.opened))) openSamples++
      await page.waitForTimeout(100)
    }
    expect(openSamples).toBeLessThanOrEqual(2)
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})
