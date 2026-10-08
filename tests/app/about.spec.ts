import { expect, test } from "@playwright/test"
import { launchApp, removeDataDir } from "./helpers"

test("Sobre → Reportar um problema abre o formulário do GitHub com a versão e o Windows", async () => {
  const { app, page, dataDir } = await launchApp()
  try {
    // Nada abre de verdade: o navegador é trocado por uma lista dos endereços pedidos.
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      Object.assign(globalThis, { openedUrls: opened })
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })
    await page.getByRole("button", { name: "Configurações", exact: true }).click()
    await page.locator('section[aria-label="Sobre"]').getByRole("button", { name: "Reportar um problema" }).click()

    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { openedUrls: string[] }).openedUrls.length)).toBe(1)
    const [opened] = await app.evaluate(() => (globalThis as unknown as { openedUrls: string[] }).openedUrls)
    const url = new URL(opened)
    expect(url.origin + url.pathname).toBe("https://github.com/LamarcKz/Playtrove/issues/new")
    expect(url.searchParams.get("template")).toBe("bug_report.yml")
    expect(url.searchParams.get("version")).toBe(await app.evaluate(({ app }) => app.getVersion()))
    expect(url.searchParams.get("windows")).toMatch(/^Windows .+ \(\d+\.\d+\.\d+\)$/)
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})
