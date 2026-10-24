import { existsSync, mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { chooseView, launchApp, mockOpenDialog, removeDataDir, type TestApp } from "./helpers"

test.describe.configure({ mode: "serial" })

let session: TestApp
let files: string
let source: string
let gameId: number
let title: string
let savedUrl: string

const video = () => session.page.locator('[data-slot="game-background-video"]')

async function chooseVideo(path?: string) {
  if (path) await mockOpenDialog(session.app, path)
  await session.page.getByRole("button", { name: "Mais", exact: true }).click()
  await session.page.getByRole("menuitem", { name: "Escolher vídeo de fundo…", exact: true }).click()
}

test.beforeAll(async () => {
  session = await launchApp()
  await session.page.emulateMedia({ reducedMotion: "no-preference" })
  files = mkdtempSync(join(tmpdir(), "playtrove-video-"))
  source = join(files, "trailer.webm")
  // Vídeo sintético de ruído: o tamanho força a leitura de vários blocos, sem rede ou mídia real.
  const encoded = await session.page.evaluate(async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 640
    canvas.height = 360
    const context = canvas.getContext("2d")!
    const frame = context.createImageData(canvas.width, canvas.height)
    const pixels = new Uint32Array(frame.data.buffer)
    let seed = 1
    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 32_000_000 })
    const parts: Blob[] = []
    recorder.ondataavailable = (event) => parts.push(event.data)
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })
    recorder.start()
    const draw = setInterval(() => {
      for (let index = 0; index < pixels.length; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0
        pixels[index] = seed | 0xff000000
      }
      context.putImageData(frame, 0, 0)
    }, 33)
    await new Promise((resolve) => setTimeout(resolve, 1800))
    recorder.stop()
    await stopped
    clearInterval(draw)
    stream.getTracks().forEach((track) => track.stop())
    return await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(",")[1])
      reader.readAsDataURL(new Blob(parts))
    })
  })
  writeFileSync(source, Buffer.from(encoded, "base64"))
  expect(statSync(source).size).toBeGreaterThan(2 * 1024 * 1024)
  title = await session.page.locator("main h1").innerText()
  gameId = await session.page.evaluate(async (name) => (await window.api.library.get()).games.find((game) => game.title === name)!.id, title)
})

test.afterAll(async () => {
  if (session) {
    await session.app.close()
    removeDataDir(session.dataDir)
  }
  if (files) removeDataDir(files)
})

test("cancelar a seleção conserva o fundo e importar toca a cópia local sem som", async () => {
  await chooseVideo()
  await expect(video()).toHaveCount(0)
  await chooseVideo(source)
  await expect(video()).toHaveCount(1)
  await expect.poll(() => video().evaluate((element: HTMLVideoElement) => element.readyState >= 2 && !element.paused)).toBe(true)
  expect(await video().evaluate((element: HTMLVideoElement) => ({ muted: element.muted, loop: element.loop }))).toEqual({ muted: true, loop: true })
  savedUrl = (await video().getAttribute("src"))!
  expect(savedUrl).toMatch(/^http:\/\/playtrove-video\.localhost\//)
  const stored = join(session.dataDir, "images", ...new URL(savedUrl).pathname.split("/").filter(Boolean))
  expect(readFileSync(stored)).toEqual(readFileSync(source))
  await chooseVideo()
  await expect(video()).toHaveAttribute("src", savedUrl)
  const invalid = join(files, "invalido.mp4")
  writeFileSync(invalid, "arquivo que nao e video")
  await chooseVideo(invalid)
  await expect(session.page.getByRole("alert")).toContainText("MP4")
  await expect(video()).toHaveAttribute("src", savedUrl)
  await expect(session.page.getByRole("button", { name: "Pausar vídeo de fundo", exact: true })).toHaveCount(0)
  await expect(session.page.getByRole("button", { name: "Reproduzir vídeo de fundo", exact: true })).toHaveCount(0)
})

test("trocar de jogo ou modo interrompe o vídeo e o painel lateral mantém a imagem", async () => {
  const previous = await video().elementHandle()
  const other = session.page.locator("main button[aria-pressed]").filter({ hasNotText: title }).first()
  await other.click()
  await expect(video()).toHaveCount(0)
  expect(await previous!.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await session.page.locator("main button[aria-pressed]").filter({ hasText: title }).click()
  await expect(video()).toHaveCount(1)
  await chooseView(session.page, "Grade")
  await expect(video()).toHaveCount(0)
  await session.page.locator("main button[aria-pressed]").filter({ hasText: title }).click()
  await expect(session.page.getByRole("complementary")).toBeVisible()
  await expect(video()).toHaveCount(0)
  await chooseView(session.page, "Detalhes")
  await expect(video()).toHaveCount(1)
})

test("a cópia persiste sem o original e remover conserva o arquivo escolhido", async () => {
  const originalBytes = readFileSync(source)
  unlinkSync(source)
  const dataDir = session.dataDir
  await session.app.close()
  session = await launchApp({ dataDir })
  await session.page.emulateMedia({ reducedMotion: "no-preference" })
  await expect(video()).toHaveAttribute("src", savedUrl)
  await expect.poll(() => video().evaluate((element: HTMLVideoElement) => element.readyState >= 2)).toBe(true)
  writeFileSync(source, originalBytes)
  await session.page.getByRole("button", { name: "Mais", exact: true }).click()
  await session.page.getByRole("menuitem", { name: "Remover vídeo de fundo", exact: true }).click()
  await expect(video()).toHaveCount(0)
  expect(existsSync(source)).toBe(true)
  expect(await session.page.evaluate(async (id) => (await window.api.library.get()).games.find((game) => game.id === id)!.backgroundVideoUrl, gameId)).toBeNull()
})

test("falha na reprodução volta para a imagem e movimento reduzido começa pausado", async () => {
  // Contêiner reconhecível, mas sem trilha decodificável: a falha vem do player real.
  const unsupported = join(files, "sem-trilha.mp4")
  writeFileSync(unsupported, Buffer.from("000000186674797069736f6d0000000069736f6d6d703432", "hex"))
  await chooseVideo(unsupported)
  await expect.poll(() => session.page.evaluate(async (id) => (await window.api.library.get()).games.find((game) => game.id === id)!.backgroundVideoUrl, gameId)).toMatch(/\.mp4$/)
  await expect(video()).toHaveCount(0)
  await expect(session.page.locator('[data-slot="game-backdrop"]')).toBeVisible()
  await expect(session.page.getByRole("button", { name: "Pausar vídeo de fundo", exact: true })).toHaveCount(0)
  await session.page.emulateMedia({ reducedMotion: "reduce" })
  await chooseVideo(source)
  await expect(video()).toHaveCount(1)
  await session.page.reload()
  await expect(video()).toHaveCount(1)
  await expect.poll(() => video().evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await expect(session.page.getByRole("button", { name: "Reproduzir vídeo de fundo", exact: true })).toHaveCount(0)
})

test("reproduz o vídeo após ler vários blocos do protocolo local", async () => {
  let readNextBlock = false
  session.page.on("response", async (response) => {
    if (!response.url().includes("playtrove-video")) return
    const range = (await response.allHeaders())["content-range"]
    if (range && /^bytes [1-9]\d*-/.test(range)) readNextBlock = true
  })
  await session.page.emulateMedia({ reducedMotion: "no-preference" })
  await chooseVideo(source)
  await expect.poll(() => video().evaluate((element: HTMLVideoElement) => !element.paused && element.currentTime > 1.2)).toBe(true)
  await expect.poll(() => readNextBlock).toBe(true)
})
