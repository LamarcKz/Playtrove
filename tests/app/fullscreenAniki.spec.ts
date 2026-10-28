import { expect, test, type Page } from "@playwright/test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ControllerButton } from "../../src/shared/controllers"
import { type AppProcess, type TestApp, createFiles, launchApp, mockOpenDialog, removeDataDir } from "./helpers"
import { type FakeAnikiPack, startFakeAnikiPack } from "./fakeAnikiPack"

// O tema Aniki só vale com o pacote instalado: os testes baixam um pacote de mentira de um servidor local.
let pack: FakeAnikiPack
test.beforeAll(async () => { pack = await startFakeAnikiPack() })
test.afterAll(async () => { await pack.close() })

test("o centro de controle usa janela própria, respeita o voltar e confirma o fechamento", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await installAniki(page)
    await page.evaluate(() => window.api.fullscreen.setConfig({ setupDone: true, inGameOverlayEnabled: true }))
    const gameId = await page.evaluate(async () => (await window.api.library.get()).games[0].id)
    const open = async () => {
      // A janela principal é o alvo fictício; ela representa o jogo em primeiro plano.
      await app.focus()
      const created = page.context().waitForEvent("page")
      await app.invoke("test_open_game_overlay", { gameId })
      const overlay = await created
      await expect(overlay.getByTestId("aniki-game-overlay")).toBeVisible()
      await expect.poll(() => overlay.evaluate(() => window.api.gameOverlay.getState().then((state) => state.isFocused))).toBe(true)
      return overlay
    }
    let overlay = await open()
    await overlay.getByRole("button", { name: "Áudio do Windows", exact: true }).click()
    await expect(overlay.getByTestId("aniki-audio-output")).toBeVisible()
    await overlay.getByRole("button", { name: "Aumentar o volume do Windows", exact: true }).click()
    await expect(overlay.getByTestId("aniki-audio-output").getByRole("status")).toHaveText("45%")
    await overlay.keyboard.press("Escape")
    await expect(overlay.getByTestId("aniki-audio-output")).toHaveCount(0)
    await overlay.getByRole("button", { name: "Retomar jogo", exact: true }).click()
    await expect.poll(() => app.opened()).toContain("overlay:resume")
    await expect.poll(() => page.context().pages().length).toBe(1)
    overlay = await open()
    await overlay.getByRole("button", { name: "Encerrar jogo", exact: true }).click()
    await expect(overlay.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused()
    await overlay.keyboard.press("Enter")
    expect(await app.opened()).not.toContain("overlay:close")
    await overlay.getByRole("button", { name: "Encerrar jogo", exact: true }).click()
    await overlay.getByRole("button", { name: "Confirmar", exact: true }).click()
    await expect.poll(() => app.opened()).toContain("overlay:close")
    await expect.poll(() => page.context().pages().length).toBe(1)
  } finally { await app.close(); removeDataDir(dataDir) }
})

function launchAniki(options: Parameters<typeof launchApp>[0] = {}) {
  return launchApp({ ...options, env: { ...pack.env, ...options.env } })
}

test("o player controla o único áudio e a prévia da proteção consome teclado e controle", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await page.evaluate(async () => {
      const snapshot = await window.api.library.get()
      snapshot.games[0].backgroundUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      window.api.library.get = async () => snapshot
      await window.api.games.setFavorite(snapshot.games[0].id, true)
      await window.api.fullscreen.setConfig({ musicPlayback: true, startupIntroVideoEnabled: false, screenSaverSource: "all" })
    })
    await enterFullscreen(page)
    await app.focus()
    await expect.poll(() => page.evaluate(async () => (await window.api.controllers.getInput()).generation)).toBeGreaterThan(0)
    await press(app, "options")
    await page.getByTestId("aniki-quick-access").getByRole("button", { name: "Player de música", exact: true }).click()
    const player = page.getByTestId("aniki-music-player")
    const audio = page.locator("audio[data-fullscreen-music]")
    await expect(audio).toHaveCount(1)
    await expect.poll(() => audio.evaluate((node) => (node as HTMLAudioElement).paused)).toBe(false)
    await player.getByRole("button", { name: "Pausar", exact: true }).click()
    await expect.poll(() => audio.evaluate((node) => (node as HTMLAudioElement).paused)).toBe(true)
    await player.getByRole("button", { name: "Reproduzir", exact: true }).click()
    await expect.poll(() => audio.evaluate((node) => (node as HTMLAudioElement).paused)).toBe(false)
    await player.getByRole("button", { name: "Silenciar música", exact: true }).click()
    await expect.poll(() => audio.evaluate((node) => (node as HTMLAudioElement).muted)).toBe(true)
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    await openMenuItem(page, "Configurações")
    await page.getByRole("button", { name: "Proteção de tela", exact: true }).click()
    const preview = page.getByRole("button", { name: "Prévia da proteção de tela", exact: true })
    await preview.click()
    const saver = page.getByTestId("aniki-screen-saver")
    await expect(saver).toBeVisible()
    await expect(saver.locator(".aniki-screen-saver-background")).toBeVisible()
    await expect(audio).toHaveAttribute("src", /ScreenSaverOST\.mp3$/)
    await press(app, "r2")
    await expect(saver).toHaveCount(0)
    await expect(preview).toBeVisible()
    await preview.click()
    await expect(saver).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(saver).toHaveCount(0)
    await expect(preview).toBeVisible()
  } finally { await app.close(); removeDataDir(dataDir) }
})

test("as preferências exportam, importam e recusam arquivo inválido sem gravação parcial", async () => {
  const { app, page, dataDir } = await launchAniki()
  const files = createFiles({ "preferencias.json": "", "invalido.json": "" })
  try {
    await enterFullscreen(page)
    await page.evaluate(() => window.api.fullscreen.setConfig({ musicVolume: 35, controllerIconStyle: "playstation-dark", anikiAvatarIndex: 2 }))
    await mockOpenDialog(app, join(files, "preferencias.json"))
    expect(await page.evaluate(() => window.api.fullscreenProfiles.export())).toBe(true)
    const document = JSON.parse(readFileSync(join(files, "preferencias.json"), "utf8"))
    expect(document.format).toBe("playtrove-fullscreen-preferences")
    expect(Object.keys(document).sort()).toEqual(["config", "format", "version"])
    await page.evaluate(() => window.api.fullscreen.setConfig({ musicVolume: 70, anikiAvatarIndex: null }))
    await mockOpenDialog(app, join(files, "preferencias.json"))
    const restored = await page.evaluate(() => window.api.fullscreenProfiles.import())
    expect(restored?.musicVolume).toBe(35)
    expect(restored?.anikiAvatarIndex).toBe(2)
    document.config.musicVolume = 101
    document.config.controllerIconStyle = "native"
    writeFileSync(join(files, "invalido.json"), JSON.stringify(document))
    await mockOpenDialog(app, join(files, "invalido.json"))
    await expect(page.evaluate(() => window.api.fullscreenProfiles.import())).rejects.toThrow()
    expect(await page.evaluate(() => window.api.fullscreen.getConfig())).toEqual(restored)
    await app.focus()
    await expect.poll(() => page.evaluate(async () => (await window.api.controllers.getInput()).generation)).toBeGreaterThan(0)
    await press(app, "options")
    await page.getByTestId("aniki-quick-access").getByRole("button", { name: "Manutenção de preferências", exact: true }).click()
    await page.getByRole("button", { name: "Restaurar padrões", exact: true }).click()
    const cancel = page.getByRole("alertdialog").getByRole("button", { name: "Cancelar", exact: true })
    await expect(cancel).toBeFocused()
    await page.keyboard.press("Enter")
    expect(await page.evaluate(() => window.api.fullscreen.getConfig())).toEqual(restored)
  } finally { await app.close(); removeDataDir(dataDir); removeDataDir(files) }
})

test("o Signature respeita as medidas da capa e ancora logo e cartão acima da base", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await page.evaluate(async () => {
      const snapshot = await window.api.library.get()
      const image = (width: number, height: number) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#46536a"/></svg>`)}`
      snapshot.games.forEach((game) => { game.coverUrl = image(200, 300); game.logoUrl = image(1000, 500) })
      window.api.library.get = async () => snapshot
      await window.api.games.setFavorite(snapshot.games[0].id, true)
      await window.api.fullscreen.setConfig({ startupIntroVideoEnabled: false, startDestination: "library" })
    })
    await enterFullscreen(page)
    await page.getByTestId("fullscreen-library").locator(".aniki-cover").first().click()
    await expect.poll(() => page.locator(".aniki-details-title .aniki-logo").evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(1000)
    const measures = await page.evaluate(() => {
      const stage = document.querySelector(".aniki-stage")!.getBoundingClientRect()
      const scale = stage.width / 1920
      const rect = (selector: string) => {
        const box = document.querySelector(selector)!.getBoundingClientRect()
        return { left: (box.left - stage.left) / scale, top: (box.top - stage.top) / scale, width: box.width / scale, height: box.height / scale, bottom: (box.bottom - stage.top) / scale }
      }
      return { cover: rect('.aniki-details-cover [data-slot="game-cover"]'), panel: rect(".aniki-sig-panel"), title: rect(".aniki-details-title"), logo: rect(".aniki-details-title .aniki-logo") }
    })
    expect(measures.cover.height).toBeLessThanOrEqual(350.5)
    expect(measures.cover.width).toBeLessThanOrEqual(300.5)
    expect(measures.panel.bottom).toBeCloseTo(1030, 0)
    expect(measures.logo.height).toBeLessThanOrEqual(250.5)
    expect(measures.logo.width).toBeLessThanOrEqual(600.5)
    expect(measures.panel.top - measures.title.bottom).toBeCloseTo(40, 0)
    await expect(page.locator(".aniki-topbar-center")).toHaveCount(0)
    await expect(page.getByTestId("fullscreen-shell").getByRole("button", { name: "Menu", exact: true })).toBeVisible()
  } finally { await app.close(); removeDataDir(dataDir) }
})

/** Instala o pacote de mentira; a instalação já troca o tema da tela cheia para o Aniki. */
async function installAniki(page: Page) {
  await page.evaluate(() => window.api.themes.installAniki())
}

/** Configura uma biblioteca fictícia; o teste substitui a ponte de Jogar e nunca executa o arquivo. */
async function configuredGame({ app, page }: TestApp) {
  const files = createFiles({ "duckstation.exe": "", "roms/Controle Sintetico.bin": "" })
  await page.evaluate(async () => {
    await window.api.metadata.setAutoDownload(false)
    await window.api.music.setConfig({ enabled: true, volume: 73, autoDownload: false })
  })
  await mockOpenDialog(app, join(files, "duckstation.exe"))
  await page.evaluate(() => window.api.emulators.pickPath("duckstation"))
  const folder = await page.evaluate((path) => window.api.romFolders.add({ path, emulatorId: "duckstation", core: null, platform: "PlayStation" }), join(files, "roms"))
  const scan = await page.evaluate((id) => window.api.romFolders.scan(id), folder.id)
  expect(scan.errors).toEqual([])
  expect(scan.addedIds).toHaveLength(1)
  return { files, id: scan.addedIds[0], title: scan.added[0] }
}

function silentWav() {
  const data = Buffer.alloc(44 + 44_100 * 2 * 2)
  data.write("RIFF", 0)
  data.writeUInt32LE(data.length - 8, 4)
  data.write("WAVEfmt ", 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(44_100, 24)
  data.writeUInt32LE(88_200, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write("data", 36)
  data.writeUInt32LE(data.length - 44, 40)
  return data
}

/** Relatórios sintéticos pelo gancho restrito do app, sem HID/emulador real. */
async function input(app: AppProcess, buttons: ControllerButton[] = [], connected = true) {
  return app.invoke<{ generation: number; controllerKey: number | null; buttons: ControllerButton[] }>("test_controller_input", { connected, buttons })
}

async function press(app: AppProcess, button: ControllerButton) {
  await input(app)
  await input(app, [button])
  await input(app)
}

/** Entra na tela cheia sem o assistente inicial, que tem um teste próprio. */
async function enterFullscreen(page: Page, button = "Tela cheia") {
  await installAniki(page)
  await page.evaluate(() => window.api.fullscreen.setConfig({ setupDone: true }))
  await page.getByRole("button", { name: button, exact: true }).click()
  await expect(page.getByTestId("aniki-stage")).not.toHaveAttribute("inert", "")
}

/** A tela cheia abre no Hub, como no Aniki; os testes da biblioteca começam nela. */
async function startInLibrary(page: Page) {
  await page.evaluate(() => window.api.fullscreen.setConfig({ startDestination: "library" }))
}

/** Abre o menu principal do Aniki pela barra do topo e escolhe um item. */
async function openMenuItem(page: Page, item: string, menu = "Menu") {
  await page.getByTestId("fullscreen-shell").getByRole("button", { name: menu, exact: true }).click()
  await page.getByTestId("aniki-main-menu").getByRole("button", { name: item, exact: true }).click()
}

test("as telas usam as imagens do pacote instalado e conservam o conteúdo se uma mídia falhar", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await startInLibrary(page)
    await enterFullscreen(page)
    const library = page.getByTestId("fullscreen-library")
    const glyph = library.locator(".aniki-glyph-cross img")
    await expect(glyph).toBeVisible()
    await expect.poll(() => glyph.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    expect(await glyph.getAttribute("src")).toContain("/aniki/Images/Buttons/Controller/PlayStation/Button-A.png")
    await library.getByRole("button", { name: "Mar de Estrelas", exact: true }).hover()
    const source = library.locator(".aniki-chip-source img")
    await expect(source).toBeVisible()
    await expect.poll(() => source.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    // Falhar uma imagem decorativa não deve deixar um ícone quebrado ou apagar o texto.
    await glyph.evaluate((node) => node.dispatchEvent(new Event("error")))
    await expect(glyph).toHaveCount(0)
    await expect(library.locator(".aniki-glyph-cross")).toContainText("✕")
    await source.evaluate((node) => node.dispatchEvent(new Event("error")))
    await expect(source).toHaveCount(0)
    await expect(library.locator(".aniki-chip-source")).not.toBeEmpty()
    await page.getByTestId("fullscreen-shell").getByRole("button", { name: "Hub", exact: true }).click()
    const rank = page.getByTestId("aniki-hub").locator(".aniki-rank-image")
    await expect(rank).toBeVisible()
    await expect.poll(() => rank.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await app.focus()
    await page.getByRole("button", { name: "Troféus e conquistas desbloqueados", exact: true }).click()
    const trophies = page.getByTestId("aniki-trophy-overview").locator(".aniki-trophy-icon")
    await expect(trophies).toHaveCount(4)
    await expect.poll(() => trophies.evaluateAll((nodes) => nodes.every((node) => (node as HTMLImageElement).naturalWidth > 0))).toBe(true)
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("o Aniki toca os sons do pacote ao navegar, abrir detalhes e voltar e respeita a preferência", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await page.evaluate(() => {
      const played: HTMLMediaElement[] = []
      const original = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function () {
        if (this.src.startsWith("http://playtrove-theme.localhost/")) played.push(this)
        return original.call(this)
      }
      Object.assign(window, { anikiPlayedAudio: played })
    })
    await startInLibrary(page)
    await enterFullscreen(page)
    await app.focus()
    await expect.poll(() => page.evaluate(async () => (await window.api.controllers.getInput()).generation)).toBeGreaterThan(0)
    const files = () => page.evaluate(() => (window as unknown as { anikiPlayedAudio: HTMLMediaElement[] }).anikiPlayedAudio.map((audio) => decodeURIComponent(audio.src).split("/").at(-1)))
    const covers = page.getByTestId("fullscreen-library").locator(".aniki-cover")
    await covers.nth(2).hover()
    await expect.poll(files).toContain("navigation.wav")
    await covers.nth(2).click()
    await expect(page.getByTestId("fullscreen-details")).toBeVisible()
    await expect.poll(files).toContain("EnterGameDetails.wav")
    await expect.poll(() => page.evaluate(() => (window as unknown as { anikiPlayedAudio: HTMLMediaElement[] }).anikiPlayedAudio.every((audio) => audio.readyState >= 2))).toBe(true)
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("fullscreen-library")).toBeVisible()
    await expect.poll(files).toContain("ExitGameDetails.wav")
    await page.evaluate(() => window.api.fullscreen.setConfig({ uiSounds: false }))
    const before = (await files()).length
    await covers.nth(3).hover()
    await covers.nth(3).click()
    await expect(page.getByTestId("fullscreen-details")).toBeVisible()
    expect((await files()).length).toBe(before)
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("o Aniki filtra e ordena a biblioteca e volta sem perder a escolha", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    const count = await page.evaluate(async () => (await window.api.library.get()).games.filter((game) => game.platform === "PlayStation 2").length)
    await startInLibrary(page)
    await enterFullscreen(page)
    await page.getByTestId("fullscreen-shell").getByRole("button", { name: "Filtros", exact: true }).click()
    const panel = page.getByRole("dialog", { name: "Filtros", exact: true })
    await panel.getByRole("region", { name: "Ordenar", exact: true }).getByRole("button", { name: "Tempo jogado", exact: true }).click()
    await panel.getByRole("region", { name: "Plataforma", exact: true }).getByRole("button", { name: `PlayStation 2 ${count}`, exact: true }).click()
    const covers = page.getByTestId("fullscreen-library").locator(".aniki-cover")
    await expect(covers).toHaveCount(count)
    await expect(covers.first()).toHaveAttribute("aria-label", "Mar de Estrelas")
    await panel.getByRole("button", { name: "Voltar", exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(covers).toHaveCount(count)
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("o menu de energia do Aniki confirma a ação e o cancelar devolve ao menu", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await enterFullscreen(page)
    await app.focus()
    await expect.poll(() => page.evaluate(async () => (await window.api.controllers.getInput()).generation)).toBeGreaterThan(0)
    await openMenuItem(page, "Desligar")
    const confirmation = page.getByRole("dialog", { name: "Desligar", exact: true })
    await expect(confirmation.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused()
    await confirmation.getByRole("button", { name: "Cancelar", exact: true }).click()
    const menu = page.getByTestId("aniki-main-menu")
    await expect(menu).toBeVisible()
    expect(await app.opened()).toEqual([])
    await menu.getByRole("button", { name: "Desligar", exact: true }).click()
    await confirmation.getByRole("button", { name: "Desligar", exact: true }).click()
    await expect.poll(() => app.opened()).toContain("power:shutdown")
    await expect(confirmation).toHaveCount(0)
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("a galeria importa uma cópia, amplia e remove sem apagar o original", async () => {
  const { app, page, dataDir } = await launchAniki()
  const files = createFiles({ "captura.png": "" })
  const original = join(files, "captura.png")
  writeFileSync(original, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"))
  try {
    await startInLibrary(page)
    await enterFullscreen(page)
    await app.focus()
    await page.getByTestId("fullscreen-library").getByRole("button", { name: "Mar de Estrelas", exact: true }).click()
    const open = page.getByTestId("fullscreen-details").getByRole("button", { name: "Galeria de capturas", exact: true })
    await expect(open).toBeVisible()
    await open.click()
    const gallery = page.getByTestId("aniki-gallery")
    await mockOpenDialog(app, original)
    await gallery.getByRole("button", { name: "Importar imagens…", exact: true }).click()
    const picture = gallery.getByRole("button", { name: "Captura 1 de 1", exact: true })
    await expect(picture).toBeVisible()
    await expect.poll(() => picture.locator("img").evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(1)
    await picture.click()
    await expect(gallery.getByRole("button", { name: "Voltar à galeria", exact: true })).toHaveCount(2)
    await page.keyboard.press("Escape")
    await expect(gallery).toBeVisible()
    await expect(picture).toBeVisible()
    await gallery.getByRole("button", { name: "Remover", exact: true }).click()
    const confirm = gallery.getByRole("alertdialog", { name: "Remover captura?", exact: true })
    await expect(confirm.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused()
    await confirm.getByRole("button", { name: "Remover", exact: true }).click()
    await expect(picture).toHaveCount(0)
    expect(existsSync(original)).toBe(true)
  } finally {
    await app.close()
    removeDataDir(dataDir)
    removeDataDir(files)
  }
})

for (const maximized of [false, true]) {
  test(`tela cheia restaura a janela ${maximized ? "maximizada" : "restaurada"} e as duas seleções`, async () => {
    const { app, page, dataDir } = await launchAniki({ maximized })
    try {
      if (!maximized) await app.setWindowSize(1000, 650)
      const previous = await app.window()
      const desktopGame = page.locator("main button[aria-pressed]", { hasText: "Neon Madrugada" })
      await desktopGame.click()
      await expect(page.locator("main h1")).toHaveText("Neon Madrugada")
      await startInLibrary(page)
      await enterFullscreen(page)
      await expect(page.getByTestId("fullscreen-shell")).toBeVisible()
      await expect(page.getByTestId("fullscreen-shell").locator("header").getByText("DEV", { exact: true })).toBeVisible()
      await expect.poll(async () => (await app.window()).fullscreen).toBe(true)
      const cover = page.getByTestId("fullscreen-library").getByRole("button", { name: "Mar de Estrelas", exact: true })
      await cover.click()
      await expect(page.getByTestId("fullscreen-details").getByRole("heading", { name: "Mar de Estrelas", exact: true })).toBeVisible()
      await openMenuItem(page, "Voltar ao modo janela")
      await expect.poll(async () => (await app.window()).fullscreen).toBe(false)
      await expect.poll(async () => (await app.window()).maximized).toBe(previous.maximized)
      await expect.poll(async () => (await app.window()).size).toEqual(previous.size)
      await expect(page.locator("main h1")).toHaveText("Neon Madrugada")
      await enterFullscreen(page)
      await expect(page.getByTestId("fullscreen-details").getByRole("heading", { name: "Mar de Estrelas", exact: true })).toBeVisible()
    } finally {
      await app.close()
      removeDataDir(dataDir)
    }
  })
}

test("controle exige neutro, abre detalhes uma vez e restaura foco depois de reconectar", async () => {
  const session = await launchAniki()
  const { app, page, dataDir } = session
  let files: string | undefined
  try {
    const configured = await configuredGame(session)
    files = configured.files
    await app.focus()
    await startInLibrary(page)
    await enterFullscreen(page)
    await expect.poll(() => page.evaluate(async () => (await window.api.controllers.getInput()).generation)).toBeGreaterThan(0)
    const library = page.getByTestId("fullscreen-library")
    const cover = library.getByRole("button", { name: configured.title, exact: true })
    await page.evaluate(() => {
      const counter = window as unknown as { fullscreenPlayCalls: number }
      counter.fullscreenPlayCalls = 0
      window.api.games.play = async () => { counter.fullscreenPlayCalls++ }
    })
    await cover.focus()
    await input(app, ["cross"])
    await input(app, ["cross"])
    await expect(library).toBeVisible()
    await expect(page.getByTestId("fullscreen-details")).toHaveCount(0)
    await input(app)
    await input(app, ["cross"])
    const details = page.getByTestId("fullscreen-details")
    await expect(details).toBeVisible()
    const play = details.getByRole("button", { name: "Jogar", exact: true })
    await expect(play).toBeFocused()
    await input(app, ["cross"])
    await input(app, ["cross"])
    await page.waitForTimeout(450)
    expect(await page.evaluate(() => (window as unknown as { fullscreenPlayCalls: number }).fullscreenPlayCalls)).toBe(0)
    await expect(details).toBeVisible()
    await app.focus()
    await press(app, "circle")
    await expect(cover).toBeFocused()
    await input(app, [], false)
    await input(app, ["cross"])
    await expect(library).toBeVisible()
    await press(app, "cross")
    await expect(details).toBeVisible()
  } finally {
    await app.close()
    removeDataDir(dataDir)
    if (files) removeDataDir(files)
  }
})

test("minimizar suspende o input e voltar ao app exige novo neutro", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await app.focus()
    await startInLibrary(page)
    await enterFullscreen(page)
    await expect.poll(() => page.evaluate(async () => (await window.api.controllers.getInput()).generation)).toBeGreaterThan(0)
    const cover = page.getByTestId("fullscreen-library").getByRole("button", { name: "Mar de Estrelas", exact: true })
    await cover.focus()
    await input(app)
    await page.evaluate(() => window.api.windowControls.minimize())
    await expect.poll(async () => (await app.window()).foreground).toBe(false)
    const stopped = await input(app, ["cross"])
    expect(stopped.controllerKey).toBeNull()
    expect(stopped.buttons).toEqual([])
    await app.focus()
    await expect.poll(() => page.evaluate(async () => (await window.api.controllers.getInput()).generation)).toBeGreaterThan(stopped.generation)
    await input(app, ["cross"])
    await expect(page.getByTestId("fullscreen-details")).toHaveCount(0)
    await press(app, "cross")
    await expect(page.getByTestId("fullscreen-details")).toBeVisible()
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("controle segue o mapa do Aniki: menu, segurar para configurações e voltar sem sair", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await startInLibrary(page)
    await enterFullscreen(page)
    await expect(page.getByTestId("fullscreen-library")).toBeVisible()
    await app.focus()
    await press(app, "circle")
    await expect(page.getByTestId("fullscreen-library")).toBeVisible()
    expect((await app.window()).fullscreen).toBe(true)
    await press(app, "options")
    await expect(page.getByTestId("aniki-quick-access")).toBeVisible()
    await press(app, "circle")
    await expect(page.getByTestId("aniki-quick-access")).toHaveCount(0)
    await input(app)
    await input(app, ["options"])
    await page.waitForTimeout(700)
    await input(app)
    await expect(page.getByRole("dialog", { name: "Configurações" })).toBeVisible()
    await press(app, "circle")
    await press(app, "triangle")
    await expect(page.getByRole("dialog", { name: "Opções do jogo" })).toBeVisible()
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("Welcome Hub abre primeiro, troca de página, abre um jogo e chega aos painéis rápidos", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await enterFullscreen(page)
    const hub = page.getByTestId("aniki-hub")
    await expect(hub).toBeVisible()
    await expect(hub.getByRole("heading", { name: "Jogador", exact: true })).toBeVisible()
    await app.focus()
    await expect.poll(() => page.evaluate(async () => (await window.api.controllers.getInput()).generation)).toBeGreaterThan(0)
    await press(app, "r1")
    await expect(hub.getByRole("heading", { name: "Sua atividade", exact: true })).toBeVisible()
    await hub.getByRole("button", { name: /Adicionado por último/ }).click()
    await expect(page.getByTestId("fullscreen-details")).toBeVisible()
    await press(app, "create")
    await expect(hub).toBeVisible()
    await press(app, "circle")
    await expect(page.getByTestId("fullscreen-library")).toBeVisible()
    await input(app)
    await input(app, ["create"])
    await page.waitForTimeout(700)
    await input(app)
    await expect(page.getByTestId("aniki-quick-options")).toBeVisible()
    await page.getByTestId("aniki-quick-options").getByRole("button", { name: /Abrir no/ }).click()
    await expect.poll(() => page.evaluate(() => window.api.fullscreen.getConfig())).toMatchObject({ startDestination: "library" })
    await press(app, "circle")
    await press(app, "options")
    await page.getByTestId("aniki-quick-access").getByRole("button", { name: "Configurações", exact: true }).click()
    const preferences = page.getByRole("dialog", { name: "Configurações" })
    await preferences.getByRole("button", { name: "Coroa", exact: true }).click()
    await preferences.getByRole("button", { name: /Nome do perfil/ }).click()
    const keyboard = page.getByRole("dialog", { name: "Nome do perfil" })
    for (const key of ["a", "n", "a"]) await keyboard.getByRole("button", { name: key, exact: true }).click()
    await keyboard.getByRole("button", { name: "Concluir", exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.api.fullscreen.getConfig())).toMatchObject({ profileName: "ana", profileAvatar: "crown" })
    await expect(page.getByTestId("fullscreen-shell").locator(".aniki-profile-name")).toHaveText("ana")
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("perfil e tela geral de troféus abrem pelo Acesso rápido, com o nível de colecionador", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await enterFullscreen(page)
    await expect(page.getByTestId("aniki-hub")).toBeVisible()
    await expect(page.getByTestId("aniki-hub").getByText("Nível 0 · Bronze 5", { exact: true })).toBeVisible()
    await app.focus()
    await expect.poll(() => page.evaluate(async () => (await window.api.controllers.getInput()).generation)).toBeGreaterThan(0)
    await press(app, "options")
    await page.getByTestId("aniki-quick-access").getByRole("button", { name: "Perfil", exact: true }).click()
    const profile = page.getByTestId("aniki-profile")
    await expect(profile.getByRole("heading", { name: "Jogador", exact: true })).toBeVisible()
    await expect(profile.getByText("Nível 0 · Bronze 5", { exact: true })).toBeVisible()
    await profile.getByRole("heading", { name: "Adicionados recentemente", exact: true }).waitFor()
    await press(app, "circle")
    await expect(profile).toHaveCount(0)
    await press(app, "options")
    await page.getByTestId("aniki-quick-access").getByRole("button", { name: "Troféus", exact: true }).click()
    const trophies = page.getByTestId("aniki-trophy-overview")
    await expect(trophies.getByText("Nível 0", { exact: true })).toBeVisible()
    await trophies.getByRole("button", { name: /Ordenar/ }).click()
    await expect(trophies.getByRole("button", { name: "Ordenar: Nome", exact: true })).toBeVisible()
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("segurar triângulo troca os layouts do Aniki e os seis detalhes mostram o Jogar", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await startInLibrary(page)
    await enterFullscreen(page)
    const library = page.getByTestId("fullscreen-library")
    await expect(library).toBeVisible()
    await app.focus()
    await expect.poll(() => page.evaluate(async () => (await window.api.controllers.getInput()).generation)).toBeGreaterThan(0)
    await input(app)
    await input(app, ["triangle"])
    await page.waitForTimeout(700)
    await input(app)
    await expect(library).toHaveClass(/aniki-library-vertical/)
    await expect(page.getByTestId("aniki-quick-options")).toHaveCount(0)
    await page.getByTestId("fullscreen-shell").getByRole("button", { name: "Vertical", exact: true }).click()
    await expect(library).toHaveClass(/aniki-library-list/)
    await expect.poll(() => page.evaluate(() => window.api.fullscreen.getConfig())).toMatchObject({ libraryLayout: "list" })
    await library.getByRole("button", { name: "Mar de Estrelas", exact: true }).click()
    const details = page.getByTestId("fullscreen-details")
    for (const layout of ["signature", "modern", "classic", "original", "showcase", "panel"]) {
      await page.evaluate((value) => window.api.fullscreen.setConfig({ detailsLayout: value as "signature" }), layout)
      await expect(details).toHaveAttribute("data-layout", layout)
      await expect(details.getByRole("button", { name: "Jogar", exact: true })).toBeVisible()
    }
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("paleta, cor dinâmica e efeitos do Aniki mudam a tela cheia na hora", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await startInLibrary(page)
    await enterFullscreen(page)
    const shell = page.getByTestId("fullscreen-shell")
    await expect(shell).toHaveAttribute("data-aniki-color", "default")
    await expect(shell).toHaveAttribute("data-aniki-effects", "balanced")
    await openMenuItem(page, "Configurações")
    const preferences = page.getByRole("dialog", { name: "Configurações" })
    await preferences.getByRole("button", { name: "Interface", exact: true }).click()
    await preferences.getByRole("button", { name: "Orbis Blue", exact: true }).click()
    await expect(shell).toHaveAttribute("data-aniki-color", "orbis-blue")
    await expect.poll(() => shell.evaluate((node) => getComputedStyle(node).getPropertyValue("--aniki-accent").trim())).toBe("#2e7bff")
    await preferences.getByRole("button", { name: /Efeitos visuais/ }).click()
    await expect(shell).toHaveAttribute("data-aniki-effects", "performance")
    await preferences.getByRole("switch", { name: "Cor dinâmica (tirada da arte do jogo)" }).click()
    await expect.poll(() => page.evaluate(() => window.api.fullscreen.getConfig())).toMatchObject({ colorPreset: "orbis-blue", effects: "performance", dynamicColors: true })
    const id = await page.evaluate(async () => (await window.api.library.get()).games[0].id)
    expect(await page.evaluate((gameId) => window.api.games.accentColor(gameId), id)).toBeNull()
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("assistente inicial abre na primeira vez, guarda as escolhas e não volta sozinho", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await installAniki(page)
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
    const setup = page.getByTestId("aniki-setup")
    await expect(setup.getByText("Etapa 1 / 11", { exact: true })).toBeVisible()
    await setup.getByRole("button", { name: "Começar", exact: true }).click()
    await setup.getByRole("button", { name: "Coroa", exact: true }).click()
    await setup.getByRole("button", { name: "Continuar", exact: true }).click()
    await setup.getByRole("button", { name: /^Biblioteca/ }).click()
    for (let step = 3; step < 11; step++) await setup.getByRole("button", { name: "Continuar", exact: true }).click()
    await expect(setup.getByText("Etapa 11 / 11", { exact: true })).toBeVisible()
    await setup.getByRole("button", { name: "Aplicar configurações", exact: true }).click()
    await expect(setup).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.api.fullscreen.getConfig())).toMatchObject({ setupDone: true, startDestination: "library", profileAvatar: "crown", interface: "standard" })
    await openMenuItem(page, "Voltar ao modo janela")
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
    await expect(page.getByTestId("fullscreen-shell")).toBeVisible()
    await expect(setup).toHaveCount(0)
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("configurações pelo controle trocam de categoria com R1 e descrevem o item com o foco", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await page.evaluate(() => window.api.fullscreen.setConfig({ loginScreen: true }))
    await enterFullscreen(page)
    const login = page.getByTestId("aniki-login")
    await expect(login.getByText("Bem-vindo de volta", { exact: true })).toBeVisible()
    await app.focus()
    await expect.poll(() => page.evaluate(async () => (await window.api.controllers.getInput()).generation)).toBeGreaterThan(0)
    await press(app, "cross")
    await expect(login).toHaveCount(0)
    await press(app, "options")
    await page.getByTestId("aniki-quick-access").getByRole("button", { name: "Configurações", exact: true }).click()
    const settings = page.getByRole("dialog", { name: "Configurações" })
    await expect(settings.getByRole("button", { name: "Geral", exact: true })).toHaveAttribute("aria-pressed", "true")
    await press(app, "r1")
    await expect(settings.getByRole("button", { name: "Interface", exact: true })).toHaveAttribute("aria-pressed", "true")
    await settings.getByRole("button", { name: /Estilo da interface/ }).focus()
    await expect(settings.getByText(/Quanta informação a biblioteca mostra/)).toBeVisible()
    await settings.getByRole("button", { name: /Estilo da interface/ }).click()
    await expect(page.getByTestId("fullscreen-shell")).toHaveAttribute("data-aniki-interface", "enhanced")
    // Em Geral, o tema volta ao Playtrove na hora (o pacote continua instalado para escolher de novo).
    await press(app, "l1")
    await settings.getByRole("button", { name: /Tema da tela cheia/ }).click()
    await expect(page.getByTestId("fullscreen-shell")).toHaveClass(/playtrove-fullscreen/)
    expect(await page.evaluate(() => window.api.themes.anikiStatus())).toMatchObject({ installed: true })
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("busca global pelo teclado virtual sai de Favoritos e devolve a coleção anterior", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await startInLibrary(page)
    await enterFullscreen(page)
    const targetId = await page.evaluate(async () => (await window.api.library.get()).games.find((game) => game.title === "Mar de Estrelas")!.id)
    await page.evaluate((id) => window.api.games.setFavorite(id, false), targetId)
    await app.focus()
    await press(app, "r1")
    await press(app, "r1")
    await expect(page.getByTestId("fullscreen-shell").locator(".aniki-preset")).toHaveText("Favoritos")
    await expect(page.getByTestId("fullscreen-library").getByRole("button", { name: "Mar de Estrelas", exact: true })).toHaveCount(0)
    const previousTitles = await page.locator(".aniki-cover").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")))
    await page.getByTestId("fullscreen-shell").getByRole("button", { name: "Buscar", exact: true }).click()
    const dialog = page.getByRole("dialog")
    for (const key of ["m", "a", "r"]) await dialog.getByRole("button", { name: key, exact: true }).click()
    await expect(dialog.getByRole("textbox", { name: "Buscar em todos os jogos" })).toHaveValue("mar")
    await dialog.getByRole("button", { name: "Concluir", exact: true }).click()
    await expect(page.getByTestId("fullscreen-library").getByRole("button", { name: "Mar de Estrelas", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Voltar à coleção", exact: true }).click()
    await expect(page.getByTestId("fullscreen-shell").locator(".aniki-preset")).toHaveText("Favoritos")
    await expect.poll(() => page.locator(".aniki-cover").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")))).toEqual(previousTitles)
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("análise longa conserva Unicode, permite cancelar e aparece também no desktop", async () => {
  const { app, page, dataDir } = await launchAniki()
  try {
    await app.focus()
    await startInLibrary(page)
    await enterFullscreen(page)
    await page.getByTestId("fullscreen-library").getByRole("button", { name: "Mar de Estrelas", exact: true }).click()
    await page.getByTestId("fullscreen-details").getByRole("button", { name: "Descrição", exact: true }).click()
    await page.getByRole("button", { name: "Editar análise", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Minha análise" })
    const review = "Ação 🎮 — uma aventura!\n".repeat(30)
    await dialog.getByRole("textbox", { name: "Minha análise" }).fill(review)
    await app.focus()
    await dialog.getByRole("textbox", { name: "Minha análise" }).press("F11")
    await expect(page.getByRole("button", { name: "Tela cheia", exact: true })).toBeVisible()
    await enterFullscreen(page)
    await expect(dialog.getByRole("textbox", { name: "Minha análise" })).toHaveValue(review)
    await dialog.getByRole("button", { name: "Salvar", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator(".fs-review-text")).toHaveText(review.trim())
    await app.focus()
    const description = page.getByTestId("fullscreen-description")
    await description.focus()
    await description.evaluate((node) => { node.scrollTop = 0 })
    await press(app, "down")
    await expect.poll(() => description.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
    await description.press("ArrowUp")
    await expect.poll(() => description.evaluate((node) => node.scrollTop)).toBe(0)
    await page.getByRole("button", { name: "Editar análise", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Minha análise" }).fill("Não salvar")
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click()
    await expect(page.locator(".fs-review-text")).toHaveText(review.trim())
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Descrição" })).toHaveCount(0)
    await openMenuItem(page, "Voltar ao modo janela")
    await page.locator("main button[aria-pressed]", { hasText: "Mar de Estrelas" }).click()
    await expect(page.getByRole("region", { name: "Minha análise" }).locator("p")).toHaveText(review.trim())
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("preferência de iniciar fullscreen persiste e usa áudio separado do desktop", async () => {
  let { app, page, dataDir } = await launchAniki()
  try {
    const desktopMusic = await page.evaluate(() => window.api.music.getConfig())
    await enterFullscreen(page)
    await openMenuItem(page, "Configurações")
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("switch", { name: "Abrir em tela cheia ao iniciar" }).click()
    await dialog.getByRole("button", { name: "Mídia", exact: true }).click()
    for (const volume of [25, 30, 35]) {
      await dialog.getByRole("button", { name: "Volume da música na tela cheia +", exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.api.fullscreen.getConfig())).toMatchObject({ musicVolume: volume })
    }
    await expect.poll(() => page.evaluate(() => window.api.fullscreen.getConfig())).toMatchObject({ startOnLaunch: true, musicVolume: 35 })
    expect(await page.evaluate(() => window.api.music.getConfig())).toEqual(desktopMusic)
    await app.close()
    ;({ app, page } = await launchAniki({ dataDir }))
    await expect(page.getByTestId("fullscreen-shell")).toBeVisible()
    expect((await app.window()).fullscreen).toBe(true)
    await openMenuItem(page, "Voltar ao modo janela")
    await expect(page.getByRole("button", { name: "Tela cheia", exact: true })).toBeVisible()
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("tela cheia vazia e interface em inglês continuam navegáveis", async () => {
  const { app, page, dataDir } = await launchAniki({ sampleGames: false, systemLanguage: "en" })
  try {
    await enterFullscreen(page, "Fullscreen")
    await expect(page.getByTestId("fullscreen-shell")).toBeVisible()
    await openMenuItem(page, "Back to window mode", "Menu")
    await expect(page.getByRole("button", { name: "Fullscreen", exact: true })).toBeVisible()
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("mídia local pausa fora do app e durante execução simulada, com retorno aos mesmos detalhes", async () => {
  const session = await launchAniki()
  const { app, page, dataDir } = session
  let files: string | undefined
  try {
    const configured = await configuredGame(session)
    files = configured.files
    const musicPath = join(files, "tema.wav")
    const videoPath = join(files, "trailer.webm")
    writeFileSync(musicPath, silentWav())
    await app.focus()
    const encoded = await page.evaluate(async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 160
      canvas.height = 90
      const context = canvas.getContext("2d")!
      const stream = canvas.captureStream(10)
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" })
      const parts: Blob[] = []
      recorder.ondataavailable = (event) => parts.push(event.data)
      const stopped = new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error("Falha ao gerar vídeo sintético")) })
      recorder.start()
      let shade = 0
      const draw = setInterval(() => { context.fillStyle = `rgb(${shade++ % 256}, 86, 120)`; context.fillRect(0, 0, 160, 90) }, 50)
      await new Promise((resolve) => setTimeout(resolve, 550))
      recorder.stop()
      await stopped
      clearInterval(draw)
      stream.getTracks().forEach((track) => track.stop())
      return new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(",")[1])
        reader.readAsDataURL(new Blob(parts, { type: "video/webm" }))
      })
    })
    writeFileSync(videoPath, Buffer.from(encoded, "base64"))
    await mockOpenDialog(app, musicPath)
    await page.evaluate((id) => window.api.games.pickThemeMusic(id), configured.id)
    await mockOpenDialog(app, videoPath)
    await page.evaluate((id) => window.api.games.pickBackgroundVideo(id), configured.id)
    await app.focus()
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await page.locator("main button[aria-pressed]", { hasText: configured.title }).click()
    const desktopMusic = page.locator("audio[data-theme-music]")
    await expect.poll(() => desktopMusic.evaluate((node: HTMLAudioElement) => !node.paused)).toBe(true)
    const previousDesktopAudio = await desktopMusic.elementHandle()
    await page.evaluate(() => {
      const state = window as unknown as { fullscreenPlayCalls: number; finishFullscreenGame: () => void }
      state.fullscreenPlayCalls = 0
      let running: number[] = []
      const listeners = new Set<(ids: number[]) => void>()
      const subscribe = window.api.games.onRunningChange
      window.api.games.onRunningChange = (callback) => {
        listeners.add(callback)
        const stop = subscribe(callback)
        return () => { listeners.delete(callback); stop() }
      }
      window.api.games.getRunning = async () => [...running]
      window.api.games.getRunningSessions = async () => running.map((gameId) => ({ gameId, processId: 1, startedAt: "2026-01-01T12:00:00Z", canControl: false }))
      window.api.games.play = async (id) => {
        state.fullscreenPlayCalls++
        running = [id]
        for (const listener of listeners) listener([...running])
      }
      state.finishFullscreenGame = () => {
        running = []
        for (const listener of listeners) listener([])
      }
    })
    await startInLibrary(page)
    await enterFullscreen(page)
    const music = page.locator("audio[data-fullscreen-music]")
    await app.focus()
    await expect.poll(() => music.evaluate((node: HTMLAudioElement) => !node.paused && node.currentTime > 0)).toBe(true)
    await expect.poll(() => music.evaluate((node: HTMLAudioElement) => node.volume)).toBeCloseTo(0.2, 2)
    await expect(desktopMusic).toHaveCount(0)
    expect(await previousDesktopAudio!.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true)
    await app.focus()
    await page.getByTestId(`fullscreen-game-${configured.id}`).click()
    const video = page.locator("video[data-fullscreen-video]")
    await expect(video).toHaveCount(1)
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState >= 2 && !node.paused)).toBe(true)
    expect(await video.evaluate((node: HTMLVideoElement) => ({ muted: node.muted, loop: node.loop }))).toEqual({ muted: true, loop: true })
    await page.evaluate(() => window.api.windowControls.minimize())
    await expect.poll(() => music.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true)
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true)
    await app.focus()
    await expect.poll(() => music.evaluate((node: HTMLAudioElement) => !node.paused)).toBe(true)
    const play = page.getByTestId("fullscreen-details").getByRole("button", { name: "Jogar", exact: true })
    await play.click()
    await expect(page.getByTestId("aniki-running-session")).toContainText("Jogos em execução")
    await expect(play).toBeDisabled()
    await expect.poll(() => music.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true)
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true)
    await press(app, "cross")
    expect(await page.evaluate(() => (window as unknown as { fullscreenPlayCalls: number }).fullscreenPlayCalls)).toBe(1)
    await page.evaluate(() => (window as unknown as { finishFullscreenGame: () => void }).finishFullscreenGame())
    await expect(page.locator(".fs-running")).toHaveCount(0)
    await expect(page.getByTestId("fullscreen-details").getByRole("heading", { name: configured.title, exact: true })).toBeVisible()
    await expect(play).toBeFocused()
    await expect.poll(() => music.evaluate((node: HTMLAudioElement) => !node.paused)).toBe(true)
    await openMenuItem(page, "Voltar ao modo janela")
    await expect.poll(() => music.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true)
    await expect.poll(() => desktopMusic.evaluate((node: HTMLAudioElement) => !node.paused)).toBe(true)
  } finally {
    await app.close()
    removeDataDir(dataDir)
    if (files) removeDataDir(files)
  }
})
