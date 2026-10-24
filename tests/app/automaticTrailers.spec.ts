import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"
import { expect, test } from "@playwright/test"
import { IGDB_CLIENT_ID, IGDB_CLIENT_SECRET, startFakeMetadataServer, STEAMGRIDDB_KEY, type FakeMetadataServer } from "./fakeMetadataServer"
import { createFiles, launchApp, mockOpenDialog, removeDataDir, type TestApp } from "./helpers"

test.describe.configure({ mode: "serial" })

let session: TestApp
let server: FakeMetadataServer
let gameId: number
let files: string
let manualFile: string
let videoBytes: Buffer
let romsDir: string
const TITLE = "Mar de Estrelas"
const VIDEO_ID = "Trailer001A"
const video = () => session.page.locator('[data-slot="game-background-video"]')
const game = () => session.page.evaluate(async (id) => (await window.api.library.get()).games.find((item) => item.id === id)!, gameId)

async function action(name: string) {
  await session.page.getByRole("button", { name: "Mais", exact: true }).click()
  const item = session.page.getByRole("menuitem", { name, exact: true })
  await expect(item).toBeVisible()
  await item.click()
}

test.beforeAll(async () => {
  server = await startFakeMetadataServer()
  session = await launchApp({ env: { PLAYTROVE_METADATA_TEST_SERVER: server.url } })
  await session.page.emulateMedia({ reducedMotion: "no-preference" })
  const encoded = await session.page.evaluate(async () => {
    const mimeType = "video/mp4;codecs=avc1.42001E"
    if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error("O WebView precisa gravar MP4 para esta mídia sintética")
    const canvas = document.createElement("canvas")
    canvas.width = 160
    canvas.height = 90
    const context = canvas.getContext("2d")!
    const stream = canvas.captureStream(10)
    const recorder = new MediaRecorder(stream, { mimeType })
    const parts: Blob[] = []
    recorder.ondataavailable = (event) => parts.push(event.data)
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })
    recorder.start()
    const draw = setInterval(() => {
      context.fillStyle = "#286fa0"
      context.fillRect(0, 0, 160, 90)
    }, 50)
    await new Promise((resolve) => setTimeout(resolve, 700))
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
  videoBytes = Buffer.from(encoded, "base64")
  server.setTrailer(TITLE, VIDEO_ID, videoBytes)
  files = mkdtempSync(join(tmpdir(), "playtrove-trailers-"))
  manualFile = join(files, "manual.mp4")
  writeFileSync(manualFile, videoBytes)
  await session.page.evaluate(async ({ clientId, clientSecret }) => window.api.metadata.setIgdb({ clientId, clientSecret }), {
    clientId: IGDB_CLIENT_ID,
    clientSecret: IGDB_CLIENT_SECRET,
  })
  await session.page.evaluate((key) => window.api.metadata.setSteamGridDb(key), STEAMGRIDDB_KEY)
  await session.page.locator("main button[aria-pressed]").filter({ hasText: TITLE }).click()
  gameId = await session.page.evaluate(async (title) => (await window.api.library.get()).games.find((item) => item.title === title)!.id, TITLE)
})

test.afterAll(async () => {
  if (session) {
    await session.app.close()
    removeDataDir(session.dataDir)
  }
  await server?.close()
  if (files) removeDataDir(files)
  if (romsDir) removeDataDir(romsDir)
})

test("remover desliga o automático e baixar metadados respeita essa escolha", async () => {
  await action("Desativar vídeo automático")
  await expect.poll(async () => (await game()).backgroundVideoMode).toBe("disabled")
  await session.page.evaluate((id) => window.api.metadata.download([id]), gameId)
  await expect.poll(async () => (await game()).metadataUpdatedAt).not.toBeNull()
  await expect.poll(() => session.page.evaluate(async () => (await window.api.metadata.getProgress()).running)).toBe(false)
  await expect(video()).toHaveCount(0)
  expect(server.requests.some((path) => path.includes("/trailers/"))).toBe(false)
})

test("restaurar o automático baixa o trailer e reproduz a cópia local", async () => {
  await action("Usar trailer automático")
  await expect(video()).toHaveCount(1)
  await expect.poll(() => video().evaluate((element: HTMLVideoElement) => element.readyState >= 2 && !element.paused)).toBe(true)
  expect((await game()).backgroundVideoMode).toBe("auto")
  expect(server.requests).toContain(`GET /trailers/${VIDEO_ID}.mp4`)
  await expect(video()).toHaveAttribute("src", /^http:\/\/playtrove-video\.localhost\//)
})

test("um vídeo manual tem prioridade sobre o automático nas atualizações", async () => {
  await mockOpenDialog(session.app, manualFile)
  await action("Escolher vídeo de fundo…")
  await expect.poll(async () => (await game()).backgroundVideoMode).toBe("manual")
  const manualUrl = (await game()).backgroundVideoUrl
  const downloads = server.requests.filter((path) => path.includes("/trailers/")).length
  await session.page.evaluate((id) => window.api.metadata.download([id]), gameId)
  await expect.poll(() => session.page.evaluate(async () => (await window.api.metadata.getProgress()).running)).toBe(false)
  await expect(video()).toHaveAttribute("src", manualUrl!)
  expect(server.requests.filter((path) => path.includes("/trailers/"))).toHaveLength(downloads)
})

test("trailer indisponível conserva a imagem e os metadados, com aviso", async () => {
  server.setTrailer(TITLE, VIDEO_ID, null)
  await action("Usar trailer automático")
  await expect.poll(async () => (await game()).backgroundVideoUrl).toBeNull()
  await expect(session.page.getByRole("alert")).toContainText("trailer")
  expect((await game()).description).toContain("Uma viagem")
  expect((await game()).backgroundUrl).not.toBeNull()
})

test("jogos antigos sem trailer verificado entram no download de faltantes", async () => {
  server.setTrailer(TITLE, VIDEO_ID, videoBytes)
  const dataDir = session.dataDir
  await session.app.close()
  const db = new DatabaseSync(join(dataDir, "playtrove.db"))
  try {
    db.exec("UPDATE games SET metadata_updated_at = '2026-01-01T00:00:00.000Z', background_video_mode = 'disabled'")
    db.prepare("UPDATE games SET background_video_mode = 'auto', background_video = NULL, background_video_checked_at = NULL WHERE id = ?").run(gameId)
  } finally {
    db.close()
  }
  session = await launchApp({ dataDir, env: { PLAYTROVE_METADATA_TEST_SERVER: server.url } })
  await session.page.getByRole("button", { name: "Configurações", exact: true }).click()
  const download = session.page.getByRole("button", { name: "Baixar metadados", exact: true })
  await expect(download).toBeEnabled()
  await download.click()
  await expect.poll(async () => (await game()).backgroundVideoUrl).not.toBeNull()
  expect((await game()).backgroundVideoCheckedAt).not.toBeNull()
  await expect(session.page.getByText("Todos os jogos já têm metadados.")).toBeVisible()
})

test("jogo novo recebe o trailer sozinho durante a varredura de ROMs", async () => {
  server.setTrailer("Salto Estelar", "Trailer002B", videoBytes)
  romsDir = createFiles(["PS2/Salto Estelar (USA).iso"])
  await session.page.getByRole("button", { name: "Emuladores", exact: true }).click()
  await mockOpenDialog(session.app, join(romsDir, "PS2"))
  await session.page.getByRole("button", { name: "Adicionar pasta", exact: true }).click()
  await session.page.getByRole("button", { name: "Adicionar e procurar jogos", exact: true }).click()
  await expect.poll(() => session.page.evaluate(async () => {
    const added = (await window.api.library.get()).games.find((item) => item.title === "Salto Estelar")
    return added?.backgroundVideoUrl ?? null
  })).not.toBeNull()
  expect(server.requests).toContain("GET /trailers/Trailer002B.mp4")
  await session.page.getByRole("button", { name: "Biblioteca", exact: true }).click()
  await session.page.locator("main button[aria-pressed]").filter({ hasText: "Salto Estelar" }).click()
  await expect.poll(() => video().evaluate((element: HTMLVideoElement) => element.readyState >= 2)).toBe(true)
})
