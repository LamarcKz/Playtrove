import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { startFakeMetadataServer, type FakeMetadataServer } from "./fakeMetadataServer"
import { chooseView, createFiles, launchApp, mockOpenDialog, removeDataDir, type TestApp } from "./helpers"

test.describe.configure({ mode: "serial" })
let session: TestApp
let server: FakeMetadataServer
let files: string
let source: string
let id: number
let title: string
let manualUrl: string
let automaticBytes: Buffer
let roms: string | undefined
const audio = () => session.page.locator("audio[data-theme-music]")
const game = () => session.page.evaluate(async (id) => (await window.api.library.get()).games.find((game) => game.id === id)!, id)
const idle = () => expect.poll(() => session.page.evaluate(async () => (await window.api.metadata.getProgress()).running)).toBe(false)

async function action(name: string) {
  await session.page.getByRole("button", { name: "Mais", exact: true }).click()
  await session.page.getByRole("menuitem", { name, exact: true }).click()
}

async function activate() {
  await session.page.bringToFront()
  // O evento é o mesmo recebido ao ativar a janela; não altera o estado de jogos ou autoplay.
  await session.page.evaluate(() => window.dispatchEvent(new Event("focus")))
}

async function playing() {
  await activate()
  await session.page.locator("main h1").click()
  await expect.poll(() => audio().evaluate((element: HTMLAudioElement) => element.readyState >= 2)).toBe(true)
  await expect.poll(() => audio().evaluate((element: HTMLAudioElement) => ({
    playing: !element.paused && element.currentTime > 0,
    paused: element.paused, currentTime: element.currentTime, readyState: element.readyState,
    error: element.error?.message ?? null, hidden: document.hidden, focused: document.hasFocus(),
  }))).toMatchObject({ playing: true })
}

function silentWav() {
  const data = Buffer.alloc(44 + 44_100 * 2 * 4)
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

test.beforeAll(async () => {
  server = await startFakeMetadataServer()
  session = await launchApp({ env: { PLAYTROVE_METADATA_TEST_SERVER: server.url } })
  files = mkdtempSync(join(tmpdir(), "playtrove-tema-"))
  source = join(files, "tema.wav")
  writeFileSync(source, silentWav())
  title = await session.page.locator("main h1").innerText()
  id = await session.page.evaluate(async (title) => (await window.api.library.get()).games.find((game) => game.title === title)!.id, title)
})

test.afterAll(async () => {
  if (session) {
    await session.app.close()
    removeDataDir(session.dataDir)
  }
  await server?.close()
  if (files) removeDataDir(files)
  if (roms) removeDataDir(roms)
})

test("cancelar e arquivo inválido conservam estado; arquivo manual toca de cópia local", async () => {
  await action("Escolher música tema…")
  expect((await game()).themeMusicUrl).toBeNull()
  const invalid = join(files, "invalido.mp3")
  writeFileSync(invalid, "isto não é áudio")
  await mockOpenDialog(session.app, invalid)
  await action("Escolher música tema…")
  await expect(session.page.getByRole("alert")).toContainText("MP3")
  expect((await game()).themeMusicUrl).toBeNull()
  // Simula a política de autoplay do WebView2; um clique normal deve recuperar a reprodução.
  await session.page.evaluate(() => {
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      HTMLMediaElement.prototype.play = play
      Object.assign(window, { themeAutoplayBlocked: true })
      return Promise.reject(new DOMException("Autoplay bloqueado no teste", "NotAllowedError"))
    }
  })
  await mockOpenDialog(session.app, source)
  await action("Escolher música tema…")
  await expect.poll(async () => (await game()).themeMusicMode).toBe("manual")
  manualUrl = (await game()).themeMusicUrl!
  await expect(audio()).toHaveAttribute("src", manualUrl)
  const stored = join(session.dataDir, "images", ...new URL(manualUrl).pathname.split("/").filter(Boolean))
  expect(readFileSync(stored)).toEqual(readFileSync(source))
  await expect.poll(() => session.page.evaluate(() => (window as unknown as { themeAutoplayBlocked?: boolean }).themeAutoplayBlocked)).toBe(true)
  await playing()
  expect(await audio().evaluate((element: HTMLAudioElement) => ({ loop: element.loop, muted: element.muted }))).toEqual({ loop: true, muted: false })
})

test("a faixa continua entre os quatro modos e para ao selecionar jogo sem música", async () => {
  const original = await audio().elementHandle()
  for (const view of ["Grade", "Lista", "Kanban", "Detalhes"] as const) {
    await chooseView(session.page, view)
    await expect(audio()).toHaveAttribute("src", manualUrl)
    expect(await original!.evaluate((element) => element.isConnected)).toBe(true)
    await expect(audio()).toHaveCount(1)
    await expect(session.page.getByRole("slider", { name: "Volume da música tema" })).toHaveCount(0)
    await expect(session.page.getByRole("button", { name: /^(Tocar|Pausar) música tema$/ })).toHaveCount(0)
  }
  await session.page.locator("main button[aria-pressed]").filter({ hasNotText: title }).first().click()
  await expect.poll(() => audio().getAttribute("src")).toBeNull()
  expect(await audio().evaluate((element: HTMLAudioElement) => element.paused)).toBe(true)
  await session.page.locator("main button[aria-pressed]").filter({ hasText: title }).click()
  await playing()
})

test("reprodução e volume ficam nas configurações e respeitam o foco", async () => {
  await session.page.evaluate(() => window.dispatchEvent(new Event("blur")))
  await expect.poll(() => audio().evaluate((element: HTMLAudioElement) => element.paused)).toBe(true)
  await session.page.evaluate(async () => window.api.music.setConfig({ enabled: false, volume: 7, autoDownload: true }))
  await activate()
  expect(await audio().evaluate((element: HTMLAudioElement) => element.paused)).toBe(true)
  await session.page.getByRole("button", { name: "Configurações", exact: true }).click()
  await expect(audio()).toHaveCount(0)
  const settings = session.page.getByRole("group", { name: "Música tema", exact: true })
  await expect(settings).toBeVisible()
  await expect(settings.getByRole("checkbox")).not.toBeChecked()
  await settings.getByRole("checkbox").check()
  const volume = settings.getByRole("slider")
  await volume.focus()
  await volume.press("Home")
  for (let step = 0; step < 7; step++) await volume.press("ArrowRight")
  await expect(volume).toHaveValue("7")
  await expect.poll(() => session.page.evaluate(() => window.api.music.getConfig())).toMatchObject({ enabled: true, volume: 7 })
  expect((await session.page.evaluate(() => window.api.music.getConfig())).volume).toBe(7)
  await session.page.getByRole("button", { name: "Biblioteca", exact: true }).click()
  await playing()
  await expect.poll(() => audio().evaluate((element: HTMLAudioElement) => element.volume)).toBeCloseTo(0.07, 2)
})

test("busca automática baixa M4A sintético e escolha manual impede substituição", async () => {
  const encoded = await session.page.evaluate(async () => {
    const context = new AudioContext()
    const destination = context.createMediaStreamDestination()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    gain.gain.value = 0
    oscillator.connect(gain).connect(destination)
    oscillator.start()
    await context.resume()
    const mimeType = "audio/mp4"
    if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error("WebView2 sem gravador AAC para fixture sintética")
    const recorder = new MediaRecorder(destination.stream, { mimeType })
    const parts: Blob[] = []
    recorder.ondataavailable = (event) => parts.push(event.data)
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })
    recorder.start()
    await new Promise((resolve) => setTimeout(resolve, 900))
    recorder.stop()
    await stopped
    oscillator.stop()
    await context.close()
    return await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(",")[1])
      reader.readAsDataURL(new Blob(parts, { type: mimeType }))
    })
  })
  automaticBytes = Buffer.from(encoded, "base64")
  server.setTheme(title, automaticBytes)
  const initialRequests = server.requests.filter((path) => path.startsWith("GET /theme-search")).length
  await session.page.evaluate((id) => window.api.metadata.download([id]), id)
  await idle()
  expect((await game()).themeMusicUrl).toBe(manualUrl)
  expect(server.requests.filter((path) => path.startsWith("GET /theme-search"))).toHaveLength(initialRequests)
  await action("Usar música automática")
  await idle()
  await expect.poll(async () => (await game()).themeMusicUrl).toMatch(/\.m4a$/)
  expect((await game()).themeMusicCheckedAt).not.toBeNull()
  await playing()
  const requests = server.requests.filter((path) => path.startsWith("GET /theme-search")).length
  await session.page.evaluate((id) => window.api.metadata.download([id]), id)
  await idle()
  expect(server.requests.filter((path) => path.startsWith("GET /theme-search"))).toHaveLength(requests)
})

test("remoção desativa buscas e pedido explícito funciona com automático global desligado", async () => {
  await action("Remover música tema")
  expect(existsSync(source)).toBe(true)
  await expect.poll(async () => (await game()).themeMusicMode).toBe("disabled")
  await session.page.evaluate(async (id) => {
    await window.api.music.setConfig({ enabled: true, volume: 7, autoDownload: false })
    await window.api.metadata.download([id])
  }, id)
  await idle()
  expect((await game()).themeMusicUrl).toBeNull()
  await action("Usar música automática")
  await idle()
  await expect.poll(async () => (await game()).themeMusicUrl).not.toBeNull()
})

test("arquivo e configurações persistem sem o original; validações rejeitam entradas inválidas", async () => {
  await mockOpenDialog(session.app, source)
  await action("Escolher música tema…")
  await expect.poll(async () => (await game()).themeMusicMode).toBe("manual")
  const stored = (await game()).themeMusicUrl
  unlinkSync(source)
  const dataDir = session.dataDir
  await session.app.close()
  session = await launchApp({ dataDir, env: { PLAYTROVE_METADATA_TEST_SERVER: server.url } })
  await expect.poll(async () => (await game()).themeMusicUrl).toBe(stored)
  await playing()
  const invalid = await session.app.invoke("music_set_config", { config: { enabled: true, volume: 101, autoDownload: true } }).then(() => false, () => true)
  expect(invalid).toBe(true)
  expect(await session.page.evaluate(() => window.api.music.getConfig())).toEqual({ enabled: true, volume: 7, autoDownload: false })
  const result = await session.app.invoke("games_use_automatic_theme_music", { gameId: "inválido" }).then(() => false, () => true)
  expect(result).toBe(true)
})

test("pedir música durante uma leva conserva o pedido de metadados pendente", async () => {
  const games = await session.page.evaluate(async () => (await window.api.library.get()).games)
  const target = games.filter((game) => game.id !== id).at(-1)!
  expect(target.metadataUpdatedAt).toBeNull()
  await session.page.evaluate(async ({ ids, target }) => {
    await window.api.metadata.download(ids)
    await window.api.games.useAutomaticThemeMusic(target)
  }, { ids: games.map((game) => game.id), target: target.id })
  await idle()
  const result = await session.page.evaluate(async (id) => (await window.api.library.get()).games.find((game) => game.id === id)!, target.id)
  expect(result.metadataUpdatedAt).not.toBeNull()
  expect(result.themeMusicCheckedAt).not.toBeNull()
})

test("varredura baixa música sozinha quando os metadados automáticos estão desligados", async () => {
  const name = "Tema Novo"
  server.setTheme(name, automaticBytes)
  await session.page.evaluate(async () => {
    await window.api.metadata.setAutoDownload(false)
    await window.api.music.setConfig({ enabled: true, volume: 7, autoDownload: true })
  })
  roms = createFiles(["PS2/Tema Novo (USA).iso"])
  const before = server.requests.length
  await session.page.getByRole("button", { name: "Emuladores", exact: true }).click()
  await mockOpenDialog(session.app, join(roms, "PS2"))
  await session.page.getByRole("button", { name: "Adicionar pasta", exact: true }).click()
  await session.page.getByRole("button", { name: "Adicionar e procurar jogos", exact: true }).click()
  await expect.poll(() => session.page.evaluate(async (title) => (await window.api.library.get()).games.find((game) => game.title === title)?.themeMusicUrl ?? null, name)).not.toBeNull()
  await idle()
  const result = await session.page.evaluate(async (title) => (await window.api.library.get()).games.find((game) => game.title === title)!, name)
  expect(result.metadataUpdatedAt).toBeNull()
  expect(server.requests.slice(before).filter((path) => /\/(igdb|sgdb|libretro)\//.test(path))).toEqual([])
})
