import { expect, test, type Locator, type Page } from "@playwright/test"
import { join } from "node:path"
import type { FullscreenTheme } from "../../src/shared/fullscreen"
import { type TestApp, createFiles, launchApp, mockOpenDialog, removeDataDir } from "./helpers"

const THEMES: { theme: Exclude<FullscreenTheme, "playtrove">; name: string; root: string }[] = [
  { theme: "horizonte", name: "Horizonte", root: ".horizonte-fullscreen" },
  { theme: "mosaico", name: "Mosaico", root: ".mosaico-fullscreen" },
  { theme: "painel", name: "Painel", root: ".painel-fullscreen" },
]

/** Um jogo com emulador e ROM fictícios; o teste troca a ponte do Jogar e nunca executa o arquivo. */
async function playableGame({ app, page }: TestApp) {
  const files = createFiles({ "duckstation.exe": "", "roms/Tema Sintetico.bin": "" })
  await page.evaluate(() => window.api.metadata.setAutoDownload(false))
  await mockOpenDialog(app, join(files, "duckstation.exe"))
  await page.evaluate(() => window.api.emulators.pickPath("duckstation"))
  const folder = await page.evaluate((path) => window.api.romFolders.add({ path, emulatorId: "duckstation", core: null, platform: "PlayStation" }), join(files, "roms"))
  const scan = await page.evaluate((id) => window.api.romFolders.scan(id), folder.id)
  expect(scan.addedIds).toHaveLength(1)
  await page.evaluate(() => {
    const counter = window as unknown as { themePlayCalls: number[] }
    counter.themePlayCalls = []
    window.api.games.play = async (id: number) => { counter.themePlayCalls.push(id) }
  })
  return { files, id: scan.addedIds[0], title: scan.added[0] }
}

/** Nada da tela passa da janela (no robô, 1024×768): nem a página rola para o lado, nem os blocos saem embaixo. */
async function fitsTheWindow(page: Page, blocks: Locator) {
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth }))
  expect(size.scroll).toBeLessThanOrEqual(size.width)
  for (const box of await blocks.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON() as DOMRect))) {
    expect(box.right).toBeLessThanOrEqual(size.width + 1)
    expect(box.bottom).toBeLessThanOrEqual(size.height + 1)
  }
}

for (const { theme, name, root } of THEMES) {
  test(`tema ${name}: início, setas, detalhes, Jogar e voltar, sem sair da janela`, async () => {
    const session = await launchApp()
    const { app, page, dataDir } = session
    let files: string | undefined
    try {
      const game = await playableGame(session)
      files = game.files
      await page.evaluate((value) => window.api.fullscreen.setConfig({ theme: value }), theme)
      await app.focus()
      await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
      const shell = page.locator(root)
      await expect(shell).toBeVisible()
      await expect(page.getByTestId("fullscreen-shell")).toHaveAttribute("data-fs-theme", theme)
      const library = page.getByTestId("fullscreen-library")
      await expect(library).toBeVisible()
      // O foco começa na capa escolhida, e as setas andam pelas capas.
      const current = library.locator("[aria-current='true']")
      await expect(current).toBeFocused()
      const first = await current.getAttribute("aria-label")
      await page.keyboard.press("ArrowRight")
      await expect(library.locator("[aria-current='true']")).not.toHaveAttribute("aria-label", first ?? "")
      await fitsTheWindow(page, shell.locator(".hz-card, .ms-shortcuts > button, .pn-block, .hz-play, .ms-tile[aria-current='true']"))
      // Detalhes do jogo jogável: o Jogar começa com o foco e abre o jogo pela ponte.
      await library.getByRole("button", { name: game.title, exact: true }).click()
      const details = page.getByTestId("fullscreen-details")
      await expect(details).toBeVisible()
      const play = details.getByRole("button", { name: "Jogar", exact: true })
      await expect(play).toBeFocused()
      await expect(details.getByTestId("fullscreen-description")).toBeAttached()
      await fitsTheWindow(page, details.getByRole("button", { name: "Jogar", exact: true }))
      await play.click()
      await expect.poll(() => page.evaluate(() => (window as unknown as { themePlayCalls: number[] }).themePlayCalls)).toEqual([game.id])
      await page.keyboard.press("Escape")
      await expect(library).toBeVisible()
      await expect(library.getByRole("button", { name: game.title, exact: true })).toBeFocused()
    } finally {
      await app.close()
      removeDataDir(dataDir)
      if (files) removeDataDir(files)
    }
  })
}

test("o tema troca pelo menu da tela cheia e em Configurações, sem perder o jogo escolhido", async () => {
  const { app, page, dataDir } = await launchApp()
  try {
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
    const shell = page.getByTestId("fullscreen-shell")
    const library = page.getByTestId("fullscreen-library")
    await expect(shell).toHaveAttribute("data-fs-theme", "playtrove")
    await app.focus()
    await library.locator(".fs-cover").nth(3).hover()
    const chosen = await library.locator("[aria-current='true']").getAttribute("aria-label")
    // Do Playtrove para o Horizonte, pelo menu principal.
    await shell.getByRole("button", { name: "Menu", exact: true }).click()
    await page.getByTestId("playtrove-menu").getByRole("button", { name: "Tema da tela cheia", exact: true }).click()
    const picker = page.getByRole("dialog", { name: "Tema da tela cheia" }).getByRole("radiogroup", { name: "Tema da tela cheia" })
    await expect(picker.getByRole("radio")).toHaveText([/Playtrove/, /Horizonte/, /Mosaico/, /Painel/])
    await picker.getByRole("radio", { name: /Horizonte/ }).click()
    await expect(shell).toHaveAttribute("data-fs-theme", "horizonte")
    await expect(page.locator(".horizonte-fullscreen")).toBeVisible()
    // Aberto pelo menu, o painel volta para ele com Esc (como no Playnite); o segundo Esc fecha o menu.
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("playtrove-menu")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(library.locator("[aria-current='true']")).toHaveAttribute("aria-label", chosen ?? "")
    // Do Horizonte para o Mosaico, pelo menu do próprio Horizonte.
    await shell.getByRole("button", { name: "Menu", exact: true }).click()
    await page.getByTestId("playtrove-menu").getByRole("button", { name: "Tema da tela cheia", exact: true }).click()
    await page.getByRole("radio", { name: /Mosaico/ }).click()
    await expect(page.locator(".mosaico-fullscreen")).toBeVisible()
    await expect.poll(() => page.evaluate(async () => (await window.api.fullscreen.getConfig()).theme)).toBe("mosaico")
    // No modo janela, Configurações → Geral tem a mesma escolha.
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    await page.keyboard.press("F11")
    await expect(shell).toBeHidden()
    await page.getByRole("button", { name: "Configurações", exact: true }).click()
    await page.getByRole("radio", { name: /Painel/ }).click()
    await expect.poll(() => page.evaluate(async () => (await window.api.fullscreen.getConfig()).theme)).toBe("painel")
    await expect(page.getByRole("radio", { name: /Painel/ })).toHaveAttribute("aria-checked", "true")
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("Mosaico: os atalhos redondos abrem a busca, os troféus e a energia", async () => {
  const { app, page, dataDir } = await launchApp()
  try {
    await page.evaluate(() => window.api.fullscreen.setConfig({ theme: "mosaico" }))
    await app.focus()
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
    const shortcuts = page.getByRole("navigation", { name: "Atalhos" })
    await expect(shortcuts.getByRole("button")).toHaveCount(6)
    await shortcuts.getByRole("button", { name: "Conquistas", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Conquistas" })).toBeVisible()
    await page.keyboard.press("Escape")
    await shortcuts.getByRole("button", { name: "Energia", exact: true }).click()
    await expect(page.getByTestId("playtrove-menu")).toBeVisible()
    await page.keyboard.press("Escape")
    await shortcuts.getByRole("button", { name: "Buscar em todos os jogos", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Buscar em todos os jogos" })).toBeVisible()
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})
