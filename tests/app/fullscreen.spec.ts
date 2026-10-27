import { expect, test, type Page } from "@playwright/test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ControllerButton } from "../../src/shared/controllers"
import { type AppProcess, type TestApp, createFiles, launchApp, mockOpenDialog, removeDataDir } from "./helpers"

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

/** A tela cheia abre no Hub, como no Aniki; os testes da biblioteca começam nela. */
async function startInLibrary(page: Page) {
  await page.evaluate(() => window.api.fullscreen.setConfig({ startDestination: "library" }))
}

/** Abre o menu principal do Aniki pela barra do topo e escolhe um item. */
async function openMenuItem(page: Page, item: string, menu = "Menu") {
  await page.getByTestId("fullscreen-shell").getByRole("button", { name: menu, exact: true }).click()
  await page.getByTestId("aniki-main-menu").getByRole("button", { name: item, exact: true }).click()
}

for (const maximized of [false, true]) {
  test(`tela cheia restaura a janela ${maximized ? "maximizada" : "restaurada"} e as duas seleções`, async () => {
    const { app, page, dataDir } = await launchApp({ maximized })
    try {
      if (!maximized) await app.setWindowSize(1000, 650)
      const previous = await app.window()
      const desktopGame = page.locator("main button[aria-pressed]", { hasText: "Neon Madrugada" })
      await desktopGame.click()
      await expect(page.locator("main h1")).toHaveText("Neon Madrugada")
      await startInLibrary(page)
      await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
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
      await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
      await expect(page.getByTestId("fullscreen-details").getByRole("heading", { name: "Mar de Estrelas", exact: true })).toBeVisible()
    } finally {
      await app.close()
      removeDataDir(dataDir)
    }
  })
}

test("controle exige neutro, abre detalhes uma vez e restaura foco depois de reconectar", async () => {
  const session = await launchApp()
  const { app, page, dataDir } = session
  let files: string | undefined
  try {
    const configured = await configuredGame(session)
    files = configured.files
    await app.focus()
    await startInLibrary(page)
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
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
  const { app, page, dataDir } = await launchApp()
  try {
    await app.focus()
    await startInLibrary(page)
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
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
  const { app, page, dataDir } = await launchApp()
  try {
    await startInLibrary(page)
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
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
    await expect(page.getByRole("dialog", { name: "Preferências da tela cheia" })).toBeVisible()
    await press(app, "circle")
    await press(app, "triangle")
    await expect(page.getByRole("dialog", { name: "Opções do jogo" })).toBeVisible()
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("Welcome Hub abre primeiro, troca de página, abre um jogo e chega aos painéis rápidos", async () => {
  const { app, page, dataDir } = await launchApp()
  try {
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
    const hub = page.getByTestId("aniki-hub")
    await expect(hub).toBeVisible()
    await expect(hub.getByRole("heading", { name: "Jogador", exact: true })).toBeVisible()
    await app.focus()
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
    const preferences = page.getByRole("dialog", { name: "Preferências da tela cheia" })
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
  const { app, page, dataDir } = await launchApp()
  try {
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
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
  const { app, page, dataDir } = await launchApp()
  try {
    await startInLibrary(page)
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
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

test("busca global pelo teclado virtual sai de Favoritos e devolve a coleção anterior", async () => {
  const { app, page, dataDir } = await launchApp()
  try {
    await startInLibrary(page)
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
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
  const { app, page, dataDir } = await launchApp()
  try {
    await app.focus()
    await startInLibrary(page)
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
    await page.getByTestId("fullscreen-library").getByRole("button", { name: "Mar de Estrelas", exact: true }).click()
    await page.getByTestId("fullscreen-details").getByRole("button", { name: "Descrição", exact: true }).click()
    await page.getByRole("button", { name: "Editar análise", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Minha análise" })
    const review = "Ação 🎮 — uma aventura!\n".repeat(30)
    await dialog.getByRole("textbox", { name: "Minha análise" }).fill(review)
    await app.focus()
    await dialog.getByRole("textbox", { name: "Minha análise" }).press("F11")
    await expect(page.getByRole("button", { name: "Tela cheia", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
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
  let { app, page, dataDir } = await launchApp()
  try {
    const desktopMusic = await page.evaluate(() => window.api.music.getConfig())
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
    await openMenuItem(page, "Configurações")
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("checkbox", { name: "Abrir em tela cheia ao iniciar" }).check()
    for (const volume of [25, 30, 35]) {
      await dialog.getByRole("button", { name: "Volume da música na tela cheia +", exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.api.fullscreen.getConfig())).toMatchObject({ musicVolume: volume })
    }
    await expect.poll(() => page.evaluate(() => window.api.fullscreen.getConfig())).toMatchObject({ startOnLaunch: true, musicVolume: 35 })
    expect(await page.evaluate(() => window.api.music.getConfig())).toEqual(desktopMusic)
    await app.close()
    ;({ app, page } = await launchApp({ dataDir }))
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
  const { app, page, dataDir } = await launchApp({ sampleGames: false, systemLanguage: "en" })
  try {
    await page.getByRole("button", { name: "Fullscreen", exact: true }).click()
    await expect(page.getByTestId("fullscreen-shell")).toBeVisible()
    await openMenuItem(page, "Back to window mode", "Menu")
    await expect(page.getByRole("button", { name: "Fullscreen", exact: true })).toBeVisible()
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("mídia local pausa fora do app e durante execução simulada, com retorno aos mesmos detalhes", async () => {
  const session = await launchApp()
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
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click()
    const music = page.locator("audio[data-fullscreen-music]")
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
    await expect(page.locator(".fs-running")).toContainText("Jogo em execução")
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
