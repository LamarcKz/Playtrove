import { expect, test } from "@playwright/test"
import { launchApp, removeDataDir } from "./helpers"

test("a janela abre maximizada e restaura para 1280×800 (ou o que couber na tela)", async () => {
  const { app, page, dataDir } = await launchApp({ maximized: true })
  try {
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true)
    await expect(page.locator('header button[aria-label="Restaurar"]')).toBeVisible()

    await page.locator('header button[aria-label="Restaurar"]').click()
    await expect(page.locator('header button[aria-label="Maximizar"]')).toBeVisible()
    // Numa tela menor (como a do robô de testes do GitHub, de 1024×768), o Windows não deixa a janela
    // passar da área livre da tela: ela volta ao maior tamanho que couber.
    const [size, area] = await app.evaluate(({ BrowserWindow, screen }) => [
      BrowserWindow.getAllWindows()[0].getSize(),
      screen.getPrimaryDisplay().workAreaSize,
    ] as const)
    expect(size).toEqual([Math.min(1280, area.width), Math.min(800, area.height)])
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("biblioteca vazia mostra o aviso", async () => {
  const { app, page, dataDir } = await launchApp({ sampleGames: false })
  try {
    await expect(page.getByText("Sua biblioteca está vazia")).toBeVisible()
    await expect(page.getByText("aba Emuladores")).toBeVisible()
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})
