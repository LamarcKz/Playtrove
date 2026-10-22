import { expect, test } from "@playwright/test"
import { launchApp, removeDataDir } from "./helpers"

test("a janela abre maximizada e restaura para 1280×800 (ou o que couber na tela)", async () => {
  const { app, page, dataDir } = await launchApp({ maximized: true })
  try {
    await expect.poll(async () => (await app.window()).maximized).toBe(true)
    await expect(page.locator('header button[aria-label="Restaurar"]')).toBeVisible()

    await page.locator('header button[aria-label="Restaurar"]').click()
    await expect(page.locator('header button[aria-label="Maximizar"]')).toBeVisible()
    // Numa tela menor (como a do robô de testes do GitHub, de 1024×768), o Windows não deixa a janela
    // passar da área livre da tela: ela volta ao maior tamanho que couber.
    const { workArea } = await app.window()
    await expect
      .poll(async () => (await app.window()).size)
      .toEqual([Math.min(1280, workArea[0]), Math.min(800, workArea[1])])
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("nos testes, a janela é a versão DEV (marca no logo e no título), e não parece o app instalado", async () => {
  const { app, page, dataDir } = await launchApp()
  try {
    expect((await app.window()).title).toBe("Playtrove Dev")
    const mark = page.locator("header").getByText("DEV", { exact: true })
    await expect(mark).toBeVisible()
    await expect(mark).toHaveAttribute("title", /testes automáticos/)
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
