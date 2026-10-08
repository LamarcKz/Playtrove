import { expect, test } from "@playwright/test"
import { launchApp, removeDataDir } from "./helpers"

test("a janela abre maximizada e restaura para 1280×800", async () => {
  const { app, page, dataDir } = await launchApp({ maximized: true })
  try {
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true)
    await expect(page.locator('header button[aria-label="Restaurar"]')).toBeVisible()

    await page.locator('header button[aria-label="Restaurar"]').click()
    await expect(page.locator('header button[aria-label="Maximizar"]')).toBeVisible()
    const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
    expect(size).toEqual([1280, 800])
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
