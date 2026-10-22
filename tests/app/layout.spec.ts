import { join } from "node:path"
import { expect, test, type Locator } from "@playwright/test"
import { messagesFor, type Language, type Messages } from "../../src/shared/i18n"
import { IGDB_CLIENT_ID, RA_API_KEY, RA_USERNAME, startFakeMetadataServer, type FakeMetadataServer } from "./fakeMetadataServer"
import { createFiles, launchApp, mockOpenDialog, removeDataDir, type TestApp } from "./helpers"

// Confere a interface por medidas e interações: estes testes não tiram capturas de tela.
const SIZES = [
  { width: 960, height: 600 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]
const PAGES = ["stats", "achievements", "settings", "emulators"] as const
type TestedPage = (typeof PAGES)[number]
const LONG_STATUS = "Aguardando uma oportunidade para rejogar"
const LONG_GAME = "Uma aventura extraordinariamente comprida pelas constelacoes e pelos mares de um universo desconhecido"
const LONG_FOLDER = "PS2 Colecao experimental para conferir nomes e caminhos extensos"
const STATUS_DRAFT = "Rascunho preservado ao redimensionar"
// Com 1200 px de janela, a largura útil ainda não chega aos 1120 px das duas colunas.
const DRAFT_SIZES = [SIZES[0], { width: 1200, height: 800 }, SIZES[2], SIZES[1]]

async function resize(session: TestApp, size: (typeof SIZES)[number]) {
  await session.app.invoke("test_set_window_size", { width: size.width, height: size.height })
  // O monitor do runner pode ser menor que 1920x1080. O viewport torna a medida do layout
  // determinística mesmo quando o Windows limita o tamanho da janela física.
  await session.page.setViewportSize(size)
  await expect.poll(() => session.page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(size)
}

async function navigate(session: TestApp, page: TestedPage, t: Messages) {
  await session.page.getByRole("button", { name: t.pages[page], exact: true }).click()
  await expect(session.page.getByRole("heading", { level: 1, name: t.pages[page], exact: true })).toBeVisible()
  await expect(session.page.getByTestId("page-content")).toBeVisible()
}

/** Confere largura útil, centralização e controles que poderiam ficar cortados pelo main. */
async function expectPageGeometry(session: TestApp) {
  const content = session.page.getByTestId("page-content")
  const metrics = await content.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    let scroller = element.parentElement!
    while (scroller.parentElement && !["auto", "scroll"].includes(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement
    }
    const frame = scroller.getBoundingClientRect()
    const left = frame.left + scroller.clientLeft
    return {
      width: rect.width,
      available: scroller.clientWidth,
      left: rect.left - left,
      right: left + scroller.clientWidth - rect.right,
    }
  })
  expect(metrics.width).toBeLessThanOrEqual(1601)
  expect(metrics.width).toBeGreaterThanOrEqual(Math.min(1600, metrics.available - 64) - 1)
  expect(metrics.left).toBeGreaterThanOrEqual(15)
  expect(metrics.right).toBeGreaterThanOrEqual(15)
  expect(Math.abs(metrics.left - metrics.right)).toBeLessThanOrEqual(2)

  const overflow = await session.page.evaluate(() => {
    const main = document.querySelector("main")!
    const bounds = main.getBoundingClientRect()
    const overflowing = [...document.querySelectorAll<HTMLElement>("main, main *")].filter((element) => {
      if (element.getClientRects().length === 0) return false
      const overflowX = getComputedStyle(element).overflowX
      return ["auto", "scroll"].includes(overflowX) && element.scrollWidth > element.clientWidth + 1
    })
    const clippedControls = [...main.querySelectorAll<HTMLElement>("button, input, summary, [role=combobox]")].filter((element) => {
      if (element.getClientRects().length === 0) return false
      const style = getComputedStyle(element)
      if (style.visibility !== "visible" || style.opacity === "0") return false
      const rect = element.getBoundingClientRect()
      return rect.left < bounds.left - 1 || rect.right > bounds.right + 1
    })
    return {
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main: main.scrollWidth - main.clientWidth,
      scrollers: overflowing.map((element) => element.getAttribute("aria-label") ?? element.tagName),
      controls: clippedControls.map((element) => element.getAttribute("aria-label") ?? element.textContent),
    }
  })
  expect(overflow.document).toBeLessThanOrEqual(1)
  expect(overflow.main).toBeLessThanOrEqual(1)
  expect(overflow.scrollers).toEqual([])
  expect(overflow.controls).toEqual([])
}

/** O breakpoint deve considerar o conteúdo disponível, inclusive a barra lateral e as margens. */
async function expectSectionArrangement(session: TestApp, first: Locator, second: Locator) {
  const width = await session.page.getByTestId("page-content").evaluate((element) => element.getBoundingClientRect().width)
  const a = await first.boundingBox()
  const b = await second.boundingBox()
  expect(a).not.toBeNull()
  expect(b).not.toBeNull()
  if (!a || !b) return
  if (width >= 1120) {
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(2)
    expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(15)
  } else {
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(2)
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height)
  }
}

async function expectInsideViewport(control: Locator) {
  await control.scrollIntoViewIfNeeded()
  const metrics = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }
  })
  expect(metrics.left).toBeGreaterThanOrEqual(0)
  expect(metrics.top).toBeGreaterThanOrEqual(0)
  expect(metrics.right).toBeLessThanOrEqual(metrics.width)
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.height)
}

async function expectLastActionReachable(session: TestApp) {
  const action = session.page.locator(
    "main button:enabled:visible, main summary:visible, main input:enabled:visible, main [role=combobox]:visible"
  ).last()
  await expect(action).toBeVisible()
  await expectInsideViewport(action)
}

for (const language of ["pt-BR", "en"] satisfies Language[]) {
  const t = messagesFor(language)
  test.describe(`layout das quatro abas em ${language}`, () => {
    test.describe.configure({ mode: "serial" })
    let session: TestApp
    let server: FakeMetadataServer
    let files: string
    let longFolderPath: string

    test.beforeAll(async () => {
      test.setTimeout(120_000)
      server = await startFakeMetadataServer()
      session = await launchApp({
        systemLanguage: language,
        env: { PLAYTROVE_METADATA_TEST_SERVER: server.url },
      })
      files = createFiles({
        [`${LONG_FOLDER}/${LONG_GAME}.iso`]: "",
        "Emuladores de teste para conferir caminhos de instalacao extensos/PCSX2/pcsx2-qt.exe": "",
        ...Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`${LONG_FOLDER} ${index + 2}/.keep`, ""])),
      })
      longFolderPath = join(files, LONG_FOLDER)
      const emulatorPath = join(files, "Emuladores de teste para conferir caminhos de instalacao extensos", "PCSX2", "pcsx2-qt.exe")
      await mockOpenDialog(session.app, emulatorPath)
      await session.page.evaluate(async ({ folder, others, status }) => {
        await window.api.metadata.setAutoDownload(false)
        await window.api.emulators.pickPath("pcsx2")
        const created = await window.api.romFolders.add({ path: folder, emulatorId: "pcsx2", core: null, platform: "PlayStation 2" })
        for (const path of others) {
          await window.api.romFolders.add({ path, emulatorId: "pcsx2", core: null, platform: "PlayStation 2" })
        }
        await window.api.romFolders.scan(created.id)
        await window.api.statuses.create(status)
      }, {
        folder: longFolderPath,
        others: Array.from({ length: 5 }, (_, index) => join(files, `${LONG_FOLDER} ${index + 2}`)),
        status: LONG_STATUS,
      })
      await session.page.evaluate((account) => window.api.achievements.setAccount(account), { username: RA_USERNAME, apiKey: RA_API_KEY })
      await expect.poll(() => session.page.evaluate(async () => (await window.api.achievements.overview()).games.length), {
        timeout: 45_000,
      }).toBe(4)
      await expect.poll(() => session.page.evaluate(async () => (await window.api.achievements.getConfig()).syncing)).toBe(false)
    })

    test.afterAll(async () => {
      await session?.app.close()
      await server?.close()
      if (session) removeDataDir(session.dataDir)
      if (files) removeDataDir(files)
    })

    for (const size of SIZES) {
      test(`${size.width}x${size.height}: conteúdo acessível, centralizado e sem cortes`, async () => {
        await resize(session, size)
        for (const page of PAGES) {
          await navigate(session, page, t)
          if (page === "stats") {
            await expect(session.page.getByRole("list", { name: t.stats.neverPlayed, exact: true })).toContainText(LONG_GAME)
            await expect(session.page.getByRole("list", { name: t.stats.byStatus, exact: true })).toContainText(LONG_STATUS)
          } else if (page === "achievements") {
            await expect(session.page.getByRole("list", { name: t.achievements.gamesList, exact: true }).locator(":scope > li")).toHaveCount(4)
          } else if (page === "settings") {
            await expectSectionArrangement(session,
              session.page.getByRole("region", { name: t.settings.general, exact: true }),
              session.page.getByRole("region", { name: t.settings.metadata, exact: true }))
          } else {
            await expect(session.page.getByRole("listitem", { name: longFolderPath, exact: true })).toContainText(LONG_FOLDER)
            await expectSectionArrangement(session,
              session.page.getByRole("region", { name: t.emulators.title, exact: true }),
              session.page.getByRole("region", { name: t.romFolders.title, exact: true }))
          }
          await expectPageGeometry(session)
          await expectLastActionReachable(session)
        }

        // O diálogo usa um portal, por isso precisa de medidas próprias além das do main.
        await navigate(session, "achievements", t)
        await session.page.getByRole("list", { name: t.achievements.gamesList, exact: true })
          .getByRole("button").filter({ hasText: "Mar de Estrelas" }).click()
        const words = t.achievements.sources.retroachievements
        const dialog = session.page.getByRole("dialog", { name: words.titleOf("Mar de Estrelas"), exact: true })
        await expect(dialog.getByRole("list", { name: words.list }).locator(":scope > li")).toHaveCount(6)
        await expectInsideViewport(dialog)
        await dialog.getByRole("radio", { name: words.unlocked, exact: true }).click()
        await expect(dialog.getByRole("list", { name: words.list }).locator(":scope > li")).toHaveCount(3)
        await expectInsideViewport(dialog.getByRole("button", { name: t.dialog.close, exact: true }))
        await session.page.keyboard.press("Escape")
        await expect(dialog).toHaveCount(0)
      })
    }

    test("redimensionar preserva formulários, erro de chave e o preenchimento da pasta", async () => {
      await navigate(session, "settings", t)
      const igdb = session.page.getByRole("region", { name: "IGDB", exact: true })
      await igdb.getByLabel("Client ID", { exact: true }).fill(IGDB_CLIENT_ID)
      await igdb.getByLabel("Client Secret", { exact: true }).fill("segredo-invalido-de-teste")
      await igdb.getByRole("button", { name: t.common.save, exact: true }).click()
      await expect(igdb.getByRole("alert")).toBeVisible()
      const error = await igdb.getByRole("alert").innerText()
      await session.page.getByLabel(t.statuses.newName, { exact: true }).fill(STATUS_DRAFT)
      for (const size of DRAFT_SIZES) {
        await resize(session, size)
        await expect(igdb.getByLabel("Client ID", { exact: true })).toHaveValue(IGDB_CLIENT_ID)
        await expect(igdb.getByLabel("Client Secret", { exact: true })).toHaveValue("segredo-invalido-de-teste")
        await expect(igdb.getByRole("alert")).toHaveText(error)
        await expect(session.page.getByLabel(t.statuses.newName, { exact: true })).toHaveValue(STATUS_DRAFT)
        await expectSectionArrangement(session,
          session.page.getByRole("region", { name: t.settings.general, exact: true }),
          session.page.getByRole("region", { name: t.settings.metadata, exact: true }))
        await expectPageGeometry(session)
        await expectInsideViewport(igdb.getByRole("button", { name: t.common.save, exact: true }))
      }

      await navigate(session, "emulators", t)
      await mockOpenDialog(session.app, longFolderPath)
      await session.page.getByRole("button", { name: t.romFolders.add, exact: true }).click()
      const form = session.page.getByRole("form", { name: t.romFolders.newFolder, exact: true })
      await form.getByRole("combobox", { name: t.romFolders.emulator, exact: true }).click()
      await session.page.getByRole("option", { name: "PCSX2", exact: true }).click()
      const consoleName = "Console de teste com nome extenso ainda nao salvo"
      await form.getByLabel(t.romFolders.console, { exact: true }).fill(consoleName)
      for (const size of DRAFT_SIZES) {
        await resize(session, size)
        await expect(form.getByLabel(t.romFolders.console, { exact: true })).toHaveValue(consoleName)
        await expect(form.getByRole("combobox", { name: t.romFolders.emulator, exact: true })).toHaveText("PCSX2")
        await expect(form).toContainText(longFolderPath)
        await expectSectionArrangement(session,
          session.page.getByRole("region", { name: t.emulators.title, exact: true }),
          session.page.getByRole("region", { name: t.romFolders.title, exact: true }))
        await expectPageGeometry(session)
        await expectInsideViewport(form.getByRole("button", { name: t.romFolders.addAndScan, exact: true }))
      }
      await form.getByRole("button", { name: t.common.cancel, exact: true }).click()
      await expect(form).toHaveCount(0)
    })

    test("960x600: biblioteca vazia mantém os avisos e atalhos das quatro abas", async () => {
      const empty = await launchApp({ sampleGames: false, systemLanguage: language })
      try {
        await resize(empty, SIZES[0])
        for (const page of PAGES) {
          await navigate(empty, page, t)
          if (page === "stats") {
            await expect(empty.page.getByText(t.stats.emptyTitle, { exact: true })).toBeVisible()
          } else if (page === "achievements") {
            await expect(empty.page.getByText(t.achievements.emptyTitle, { exact: true })).toBeVisible()
          } else if (page === "emulators") {
            await expect(empty.page.getByRole("list", { name: t.emulators.title, exact: true }).locator(":scope > li")).toHaveCount(7)
            await expect(empty.page.getByText(t.romFolders.empty, { exact: true })).toBeVisible()
          }
          await expectPageGeometry(empty)
          await expectLastActionReachable(empty)
        }
        await navigate(empty, "stats", t)
        await empty.page.getByRole("button", { name: t.library.goToEmulators, exact: true }).click()
        await expect(empty.page.getByRole("heading", { level: 1, name: t.pages.emulators, exact: true })).toBeVisible()
        await navigate(empty, "achievements", t)
        await empty.page.getByRole("button", { name: t.achievements.goToSettings, exact: true }).click()
        await expect(empty.page.getByRole("heading", { level: 1, name: t.pages.settings, exact: true })).toBeVisible()
        await expectInsideViewport(empty.page.getByRole("region", { name: "RetroAchievements", exact: true })
          .getByRole("button", { name: t.common.save, exact: true }))
      } finally {
        await empty.app.close()
        removeDataDir(empty.dataDir)
      }
    })
  })
}
