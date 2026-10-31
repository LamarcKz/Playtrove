import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { expect, test } from "@playwright/test"
import { startFakeMetadataServer, type FakeMetadataServer } from "./fakeMetadataServer"
import { launchApp, removeDataDir, type TestApp } from "./helpers"

test.describe.configure({ mode: "serial" })
let session: TestApp
let server: FakeMetadataServer
let id: number
let title: string
const candidates = [
  { videoId: "MusicTest01", title: "Tema de aventura", channel: "Trilha de teste", duration: 93, viewCount: null },
  { videoId: "MusicTest02", title: "Tema do mapa", channel: "Arquivo de teste", duration: 120, viewCount: 20 },
  { videoId: "MusicTest03", title: "Tema da cidade", channel: null, duration: null, viewCount: null },
  { videoId: "MusicTest04", title: "Tema de batalha", channel: "Trilha de teste", duration: 74, viewCount: 30 },
]
const currentGame = () => session.page.evaluate(async (gameId) => (await window.api.library.get()).games.find((game) => game.id === gameId)!, id)
const idle = () => expect.poll(() => session.page.evaluate(async () => (await window.api.metadata.getProgress()).running)).toBe(false)
const dialog = () => session.page.getByRole("dialog")

test.beforeAll(async () => {
  server = await startFakeMetadataServer()
  session = await launchApp({ env: { PLAYTROVE_METADATA_TEST_SERVER: server.url } })
  title = await session.page.locator("main h1").innerText()
  id = await session.page.evaluate(async (title) => (await window.api.library.get()).games.find((game) => game.title === title)!.id, title)
  const dataDir = session.dataDir
  await session.app.close()
  // Somente o banco temporário do harness, com o app fechado.
  const db = new DatabaseSync(join(dataDir, "playtrove.db"))
  db.prepare("UPDATE games SET metadata_updated_at = ?, theme_music_mode = 'disabled'").run("2026-01-01T00:00:00.000Z")
  db.prepare("UPDATE games SET theme_music_mode = 'auto', theme_music_checked_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", id)
  db.close()
  server.setThemeSearch(title, { candidates, automaticVideoId: null })
  session = await launchApp({ dataDir, env: { PLAYTROVE_METADATA_TEST_SERVER: server.url } })
})

test.afterAll(async () => {
  if (session) { await session.app.close(); removeDataDir(session.dataDir) }
  await server?.close()
})

test("só música faltante habilita Metadados mesmo com busca automática desligada", async () => {
  await session.page.evaluate(async () => window.api.music.setConfig({ enabled: false, volume: 27, autoDownload: false }))
  await session.page.getByRole("button", { name: "Configurações", exact: true }).click()
  const general = session.page.getByRole("group", { name: "Música tema", exact: true })
  await expect(general.getByRole("checkbox")).toHaveCount(1)
  const acquisition = session.page.getByRole("group", { name: "Músicas dos jogos", exact: true })
  await expect(acquisition.getByRole("checkbox")).not.toBeChecked()
  const button = session.page.getByRole("button", { name: "Baixar metadados", exact: true })
  await expect(button).toBeEnabled()
  const before = server.requests.length
  await button.click()
  await idle()
  await expect(acquisition.getByRole("button", { name: "Revisar músicas", exact: true })).toBeVisible()
  expect(server.requests.slice(before).some((path) => /\/(igdb|sgdb|libretro)\//.test(path))).toBe(false)
  expect((await currentGame()).themeMusicUrl).toBeNull()
  await expect(button).toBeDisabled()
  await expect(dialog()).toHaveCount(0)
})

test("leitura de revisões retida ou falha não mostra escolha persistida como download faltante", async () => {
  await session.page.getByRole("button", { name: "Biblioteca", exact: true }).click()
  await session.page.evaluate(async () => {
    const original = window.api.music.getReviews
    const reviews = await original()
    const pending: ((values: typeof reviews) => void)[] = []
    window.api.music.getReviews = () => new Promise((resolve) => pending.push(resolve))
    Object.assign(window, { releaseMusicReviews: () => { window.api.music.getReviews = original; pending.forEach((resolve) => resolve(reviews)) } })
  })
  await session.page.getByRole("button", { name: "Configurações", exact: true }).click()
  const acquisition = session.page.getByRole("group", { name: "Músicas dos jogos", exact: true })
  const download = session.page.getByRole("button", { name: "Baixar metadados", exact: true })
  await expect(acquisition.getByRole("status")).toHaveText("Conferindo músicas pendentes…")
  await expect(download).toBeDisabled()
  await expect(acquisition.getByText(/jogo precisa de uma busca/)).toHaveCount(0)
  await session.page.evaluate(() => {
    const release = (window as unknown as { releaseMusicReviews: () => void }).releaseMusicReviews
    release()
  })
  await expect(acquisition.getByRole("button", { name: "Revisar músicas", exact: true })).toBeVisible()
  await expect(download).toBeDisabled()
  await session.page.getByRole("button", { name: "Biblioteca", exact: true }).click()
  await session.page.evaluate(() => {
    const original = window.api.music.getReviews
    window.api.music.getReviews = () => Promise.reject(new Error("test failure"))
    Object.assign(window, { restoreMusicReviews: () => { window.api.music.getReviews = original } })
  })
  await session.page.getByRole("button", { name: "Configurações", exact: true }).click()
  await expect(acquisition.getByRole("alert")).toHaveText("Não deu para carregar as músicas pendentes")
  await expect(download).toBeDisabled()
  await expect(acquisition.getByText(/jogo precisa de uma busca/)).toHaveCount(0)
  await session.page.evaluate(() => (window as unknown as { restoreMusicReviews: () => void }).restoreMusicReviews())
  await acquisition.getByRole("button", { name: "Tentar carregar novamente", exact: true }).click()
  await expect(acquisition.getByRole("button", { name: "Revisar músicas", exact: true })).toBeVisible()
})

test("diálogo mantém a mesma instância e consulta durante recarga retida ou falha da lista", async () => {
  for (const page of ["Configurações", "Biblioteca"] as const) {
    await session.page.getByRole("button", { name: page, exact: true }).click()
    await session.page.getByRole("button", { name: /^Revisar músicas/ }).click()
    const input = dialog().getByLabel("Nome do jogo ou da música")
    const originalInput = await input.elementHandle()
    await input.fill("Consulta preservada")
    await session.page.evaluate(async (id) => {
      const original = window.api.music.getReviews
      const pending: { resolve: (reviews: Awaited<ReturnType<typeof original>>) => void; reject: (error: Error) => void }[] = []
      window.api.music.getReviews = () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
      Object.assign(window, {
        pendingMusicRefreshCount: () => pending.length,
        rejectMusicRefresh: () => pending.splice(0).forEach(({ reject }) => reject(new Error("test failure"))),
        releaseMusicRefresh: async () => {
          window.api.music.getReviews = original
          const reviews = await original()
          pending.splice(0).forEach(({ resolve }) => resolve(reviews))
        },
      })
      const game = (await window.api.library.get()).games.find((game) => game.id === id)!
      await window.api.games.setFavorite(id, !game.favorite)
    }, id)
    // A consulta é do elemento real anterior, não de um novo input com os mesmos atributos.
    await expect.poll(() => session.page.evaluate(() => (window as unknown as { pendingMusicRefreshCount: () => number }).pendingMusicRefreshCount())).toBeGreaterThan(0)
    await session.page.evaluate(async () => {
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
    })
    await expect.poll(() => originalInput!.evaluate((element) => element.isConnected)).toBe(true)
    await expect(input).toHaveValue("Consulta preservada")
    await session.page.evaluate(() => (window as unknown as { rejectMusicRefresh: () => void }).rejectMusicRefresh())
    await session.page.evaluate(async () => {
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
    })
    if (page === "Configurações") await expect(session.page.getByText("Não deu para carregar as músicas pendentes", { exact: true }).first()).toBeAttached()
    expect(await originalInput!.evaluate((element) => element.isConnected)).toBe(true)
    await expect(input).toHaveValue("Consulta preservada")
    await session.page.evaluate(() => (window as unknown as { releaseMusicRefresh: () => Promise<void> }).releaseMusicRefresh())
    // Uma busca real publica outra geração e library:changed; o formulário precisa sobreviver.
    const query = "Tema com nova geração"
    server.setThemeSearch(title, { candidates: [candidates[3]], automaticVideoId: null }, query)
    await input.fill(query)
    await dialog().getByRole("button", { name: "Buscar músicas", exact: true }).click()
    await expect(dialog().getByText(candidates[3].title, { exact: true })).toBeVisible()
    await expect(dialog().getByText(candidates[0].title, { exact: true })).toHaveCount(0)
    expect(await originalInput!.evaluate((element) => element.isConnected)).toBe(true)
    await expect(input).toHaveValue(query)
    // Restaura a lista de opções sintéticas usada pelos próximos casos.
    await input.fill(title)
    await dialog().getByRole("button", { name: "Buscar músicas", exact: true }).click()
    await expect(dialog().getByText(candidates[0].title, { exact: true })).toBeVisible()
    await dialog().getByRole("button", { name: "Agora não", exact: true }).click()
    await originalInput!.dispose()
  }
  await session.page.getByRole("button", { name: "Configurações", exact: true }).click()
})

test("Agora não preserva escolhas depois de reiniciar e permite consultar pelo nome da música", async () => {
  await session.page.getByRole("button", { name: "Revisar músicas", exact: true }).click()
  await expect(dialog()).toContainText(candidates[0].title)
  await expect(dialog()).toContainText("1:33")
  await expect(dialog().getByText(candidates[3].title, { exact: true })).toHaveCount(0)
  await dialog().getByRole("button", { name: "Mostrar mais opções" }).click()
  await expect(dialog()).toContainText(candidates[3].title)
  await dialog().getByRole("button", { name: "Agora não", exact: true }).click()
  const dataDir = session.dataDir
  await session.app.close()
  session = await launchApp({ dataDir, env: { PLAYTROVE_METADATA_TEST_SERVER: server.url } })
  await session.page.getByRole("button", { name: /^Revisar músicas/ }).click()
  await expect(dialog()).toContainText(candidates[0].title)
  server.setThemeSearch(title, { candidates: [candidates[3]], automaticVideoId: null }, "Tema de batalha")
  await dialog().getByLabel("Nome do jogo ou da música").fill("Tema de batalha")
  await dialog().getByRole("button", { name: "Buscar músicas", exact: true }).click()
  await expect(dialog()).toContainText(candidates[3].title)
  await expect(dialog().getByText(candidates[0].title, { exact: true })).toHaveCount(0)
})

test("prévia usa volume com ambiente desligado e só confirma após áudio salvo", async () => {
  const encoded = await session.page.evaluate(async () => {
    const context = new AudioContext()
    const destination = context.createMediaStreamDestination()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    gain.gain.value = 0
    oscillator.connect(gain).connect(destination)
    oscillator.start()
    await context.resume()
    const recorder = new MediaRecorder(destination.stream, { mimeType: "audio/mp4" })
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
      reader.readAsDataURL(new Blob(parts, { type: "audio/mp4" }))
    })
  })
  server.setThemeAudio(candidates[3].videoId, Buffer.from(encoded, "base64"))
  await dialog().getByRole("button", { name: "Ouvir", exact: true }).click()
  const preview = dialog().locator("audio[data-music-preview]")
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => !audio.paused)).toBe(true)
  expect(await preview.evaluate((audio: HTMLAudioElement) => audio.volume)).toBeCloseTo(0.27)
  expect(await session.page.locator("audio[data-theme-music]").evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
  expect((await session.page.evaluate(() => window.api.music.getConfig())).enabled).toBe(false)
  const audioRequests = server.requests.filter((path) => path.startsWith("GET /theme-audio/")).length
  await dialog().getByRole("button", { name: "Usar esta música", exact: true }).click()
  await expect(dialog()).toHaveCount(0)
  expect((await currentGame()).themeMusicUrl).toMatch(/\.m4a$/)
  expect(server.requests.filter((path) => path.startsWith("GET /theme-audio/"))).toHaveLength(audioRequests)
  expect(await session.page.evaluate(() => window.api.music.getReviews())).toEqual([])
  await session.page.getByRole("button", { name: "Mais", exact: true }).click()
  await session.page.getByRole("menuitem", { name: "Buscar outra música…", exact: true }).click()
  await expect(dialog().getByLabel("Nome do jogo ou da música")).toBeVisible()
})

test("falha ao salvar mantém revisão e fechar cancela resposta de prévia antiga", async () => {
  server.setThemeSearch(title, { candidates: [candidates[0]], automaticVideoId: null })
  await dialog().getByRole("button", { name: "Buscar músicas", exact: true }).click()
  await expect(dialog()).toContainText(candidates[0].title)
  server.setThemeAudio(candidates[0].videoId, null)
  const previous = (await currentGame()).themeMusicUrl
  await dialog().getByRole("button", { name: "Usar esta música", exact: true }).click()
  await expect(session.page.getByRole("alert")).toBeVisible()
  await expect(dialog()).toBeVisible()
  expect((await currentGame()).themeMusicUrl).toBe(previous)
  await dialog().getByRole("button", { name: "Ouvir", exact: true }).click()
  await dialog().getByRole("button", { name: "Agora não", exact: true }).click()
  await expect(session.page.locator("audio[data-music-preview]")).toHaveCount(0)
  expect((await session.page.evaluate(() => window.api.music.getReviews())).some((review) => review.gameId === id)).toBe(true)
})

test("fechar confirmação sem ouvir cancela o download e conserva a música instalada", async () => {
  const previous = (await currentGame()).themeMusicUrl
  expect(previous).not.toBeNull()
  server.setThemeAudio(candidates[0].videoId, Buffer.from("\0\0\0\x18ftypM4A \0\0\0\0M4A isomconteudo", "binary"))
  for (const close of ["later", "escape", "close", "immediate"] as const) {
    await session.page.getByRole("button", { name: "Mais", exact: true }).click()
    await session.page.getByRole("menuitem", { name: "Buscar outra música…", exact: true }).click()
    await expect(dialog().getByText(candidates[0].title, { exact: true })).toBeVisible()
    const release = server.holdThemeAudio(candidates[0].videoId)
    const requests = server.requests.length
    await session.page.evaluate(() => {
      const original = window.api.music.choose
      const probe = { outcome: "notStarted", restore: () => { window.api.music.choose = original } }
      window.api.music.choose = async (...args) => {
        probe.outcome = "pending"
        try { await original(...args); probe.outcome = "installed" }
        catch (error) { probe.outcome = "cancelled"; throw error }
      }
      Object.assign(window, { choiceProbe: probe })
    })
    try {
      if (close === "immediate") {
        await dialog().evaluate((element) => {
          const buttons = Array.from(element.querySelectorAll("button"))
          buttons.find((button) => button.textContent === "Usar esta música")!.click()
          buttons.find((button) => button.textContent === "Agora não")!.click()
        })
      } else {
        await dialog().getByRole("button", { name: "Usar esta música", exact: true }).click()
        await expect.poll(() => server.requests.slice(requests).some((path) => path.startsWith("GET /theme-audio/"))).toBe(true)
        if (close === "later") await dialog().getByRole("button", { name: "Agora não", exact: true }).click()
        else if (close === "escape") await session.page.keyboard.press("Escape")
        else await dialog().getByRole("button", { name: "Fechar", exact: true }).click()
      }
      await expect(session.page.locator("audio[data-music-preview]")).toHaveCount(0)
      release()
      const outcome = () => session.page.evaluate(() => (window as unknown as { choiceProbe: { outcome: string } }).choiceProbe.outcome)
      if (close === "immediate") await expect.poll(outcome).toMatch(/^(cancelled|notStarted)$/)
      else await expect.poll(outcome).toBe("cancelled")
      expect((await currentGame()).themeMusicUrl).toBe(previous)
      expect((await session.page.evaluate(() => window.api.music.getReviews())).some((review) => review.gameId === id)).toBe(true)
    } finally {
      release()
      await session.page.evaluate(() => (window as unknown as { choiceProbe: { restore: () => void } }).choiceProbe.restore())
    }
  }
})
