import { expect, test } from "@playwright/test"
import { launchApp, removeDataDir } from "./helpers"

// Precisa do DualSense de verdade ligado (USB ou Bluetooth). Sem ele, o teste é pulado. Quem lê o controle
// é o Rust (src-tauri/src/controllers.rs, que abre o controle só por um instante a cada 5 s); o teste
// confere o que chega à barra do topo.
test("DualSense na barra do topo: conexão e bateria", async () => {
  const { app, page, dataDir } = await launchApp()
  try {
    // O Rust procura os controles a cada segundo.
    await page.waitForTimeout(2000)
    const controllers = await page.evaluate(() => window.api.controllers?.list() ?? [])
    test.skip(controllers.length === 0, "Nenhum DualSense ligado agora.")
    expect(controllers.every((controller) => controller.name === "DualSense" || controller.name === "DualSense Edge")).toBe(true)

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
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})
