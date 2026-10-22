import { expect, test } from "@playwright/test"
import { launchApp, removeDataDir } from "./helpers"

test("Sobre → Reportar um problema abre o formulário do GitHub com a versão e o Windows", async () => {
  const { app, page, dataDir } = await launchApp()
  try {
    // Nada abre de verdade: nos testes, o app só anota os endereços pedidos.
    await page.getByRole("button", { name: "Configurações", exact: true }).click()
    await page.locator('section[aria-label="Sobre"]').getByRole("button", { name: "Reportar um problema" }).click()

    await expect.poll(async () => (await app.opened()).length).toBe(1)
    const [opened] = await app.opened()
    const url = new URL(opened)
    expect(url.origin + url.pathname).toBe("https://github.com/LamarcKz/Playtrove/issues/new")
    expect(url.searchParams.get("template")).toBe("bug_report.yml")
    expect(url.searchParams.get("version")).toBe(await app.version())
    expect(url.searchParams.get("windows")).toMatch(/^Windows .+ \(\d+\.\d+\.\d+\)$/)
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})
