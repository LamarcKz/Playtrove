import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"
import { expect, test, type Locator } from "@playwright/test"
import { runMigrations } from "../../src/main/migrations"
import { makePng } from "../fakePng"
import { chooseView, launchApp, removeDataDir, type TestApp } from "./helpers"

// Somente medidas e interações: estes testes não fazem capturas nem usam a biblioteca real.
test.describe.configure({ mode: "serial" })

const SIZES = [
  { width: 960, height: 600 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]
const STATUS = "Planejo explorar esta aventura com calma"
const COVERS = [
  { id: 1, title: "Capa quadrada com um nome bastante longo", width: 240, height: 240 },
  { id: 2, title: "Capa paisagem", width: 480, height: 240 },
  { id: 3, title: "Capa retrato", width: 240, height: 360 },
  { id: 4, title: "Capa estreita", width: 160, height: 360 },
  { id: 5, title: "Capa extremamente alta", width: 48, height: 2400 },
]
const EMPTY = { id: 6, title: "A aventura sem capa" }
const BROKEN = { id: 7, title: "Imagem inválida" }
const LOADING = { id: 8, title: "Imagem em carregamento", width: 200, height: 360 }
const PREVIOUS = { id: 9, title: "Imagem anterior lenta", width: 320, height: 200 }

type CoverFixture = (typeof COVERS)[number]
interface ProtocolGate {
  wait: Promise<void>
  release: () => void
  requests: number
}
interface CoverProtocolState {
  gates: Map<number, ProtocolGate>
}
type CoverTestGlobal = typeof globalThis & { __playtroveCoverTest?: CoverProtocolState }

let session: TestApp
let dataDir: string

/** Prepara o banco e as imagens antes de abrir o Electron, sempre numa pasta temporária. */
function createLibrary() {
  dataDir = mkdtempSync(join(tmpdir(), "playtrove-capas-"))
  const images = [...COVERS, LOADING, PREVIOUS].map((cover) => ({
    id: cover.id,
    bytes: makePng(cover.width, cover.height, [40, 120, 200], [15, 35, 75]),
  }))
  images.push({ id: BROKEN.id, bytes: Buffer.from("arquivo de imagem inválido") })
  for (const image of images) {
    const folder = join(dataDir, "images", String(image.id))
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, "cover.png"), image.bytes)
  }

  const db = new Database(join(dataDir, "playtrove.db"))
  try {
    runMigrations(db)
    db.prepare("INSERT INTO statuses (id, name, position) VALUES (?, ?, ?)").run(100, STATUS, 100)
    const insert = db.prepare(`
      INSERT INTO games (id, title, status_id, added_at, cover_image, metadata_updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const game of [...COVERS, EMPTY, BROKEN, LOADING, PREVIOUS]) {
      insert.run(game.id, game.title, 100, "2026-01-02T03:04:05.000Z", game.id === EMPTY.id ? null : "cover.png", null)
    }
  } finally {
    db.close()
  }
  return images.map((image) => ({ id: image.id, bytes: Array.from(image.bytes) }))
}

test.beforeAll(async () => {
  const images = createLibrary()
  session = await launchApp({ dataDir, sampleGames: false })
  // Os dois pedidos lentos ficam retidos por promessas, sem temporizadores ou dependência de rede.
  // A troca de protocolo existe apenas neste processo de teste e desaparece quando ele fecha.
  await session.app.evaluate(({ protocol }, fixtures) => {
    const gates = new Map<number, ProtocolGate>()
    for (const id of [8, 9]) {
      let release!: () => void
      const wait = new Promise<void>((resolve) => { release = resolve })
      gates.set(id, { wait, release, requests: 0 })
    }
    ;(globalThis as CoverTestGlobal).__playtroveCoverTest = { gates }
    const bytesById = new Map(fixtures.map((image) => [image.id, image.bytes]))
    protocol.unhandle("playtrove-img")
    protocol.handle("playtrove-img", async (request) => {
      const match = /^\/(\d+)\/cover\.png$/.exec(new URL(request.url).pathname)
      const id = match ? Number(match[1]) : -1
      const bytes = bytesById.get(id)
      if (!bytes) return new Response(null, { status: 404 })
      const gate = gates.get(id)
      if (gate) {
        gate.requests++
        await gate.wait
      }
      return new Response(new Uint8Array(bytes), {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      })
    })
  }, images)
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.session.clearCache())
  // Não espera o evento load: ele depende justamente das imagens que o teste segura.
  await session.page.reload({ waitUntil: "domcontentloaded" })
  await expect(gameButton(EMPTY.title)).toBeVisible()
  await session.page.evaluate(() => document.fonts.ready.then(() => undefined))
})

test.afterAll(async () => {
  if (session) {
    await session.app.evaluate(() => {
      for (const gate of (globalThis as CoverTestGlobal).__playtroveCoverTest?.gates.values() ?? []) gate.release()
    })
    await session.app.close()
  }
  if (dataDir) removeDataDir(dataDir)
})

const gameButton = (title: string) => session.page.locator("main button[aria-pressed]").filter({ hasText: title })
const coverIn = (scope: Locator, title: string) => scope.getByRole("img", { name: `Capa de ${title}`, exact: true })
const mainCover = (title: string) => coverIn(session.page.locator("main"), title)
const detailsPanel = (title: string) => session.page.getByRole("complementary", { name: `Detalhes de ${title}`, exact: true })

async function resize(size: (typeof SIZES)[number]) {
  await session.app.evaluate(({ BrowserWindow }, requested) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.unmaximize()
    window.setContentSize(requested.width, requested.height)
  }, size)
  // O monitor do runner pode ser menor que a janela solicitada.
  await session.page.setViewportSize(size)
  await expect.poll(() => session.page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(size)
  await session.page.mouse.move(0, 0)
}

async function expectNativeCover(cover: Locator, fixture: CoverFixture, maxHeight: number, maxWidth?: number) {
  await cover.scrollIntoViewIfNeeded()
  await expect(cover).toHaveAttribute("data-state", "loaded")
  const image = cover.locator('[data-slot="game-cover-image"]')
  await expect(image).toHaveAttribute("alt", "")
  const metrics = await image.evaluate((element: HTMLImageElement) => {
    const rect = element.getBoundingClientRect()
    const frame = element.closest('[data-slot="game-cover"]')!.getBoundingClientRect()
    return {
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      width: rect.width,
      height: rect.height,
      frameWidth: frame.width,
      frameHeight: frame.height,
    }
  })
  expect(metrics.naturalWidth).toBe(fixture.width)
  expect(metrics.naturalHeight).toBe(fixture.height)
  expect(metrics.width).toBeGreaterThan(0)
  expect(metrics.height).toBeGreaterThan(0)
  expect(Math.abs(metrics.height - metrics.width * fixture.height / fixture.width)).toBeLessThanOrEqual(1)
  // O quadro carregado acompanha a arte: não sobra o antigo retângulo 2:3.
  expect(Math.abs(metrics.frameWidth - metrics.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(metrics.frameHeight - metrics.height)).toBeLessThanOrEqual(1)
  expect(metrics.height).toBeLessThanOrEqual(maxHeight + 1)
  if (maxWidth !== undefined) expect(metrics.width).toBeLessThanOrEqual(maxWidth + 1)
  const blurredCopies = await cover.evaluate((element) => [...element.querySelectorAll("*")].filter((child) => {
    const style = getComputedStyle(child)
    return style.backgroundImage.includes("url(") && style.filter.includes("blur(")
  }).length)
  expect(blurredCopies).toBe(0)
}

async function expectTextFits(text: Locator) {
  const overflow = await text.evaluate((element) => ({
    x: element.scrollWidth - element.clientWidth,
    y: element.scrollHeight - element.clientHeight,
  }))
  expect(overflow.x).toBeLessThanOrEqual(1)
  expect(overflow.y).toBeLessThanOrEqual(1)
}

async function selectWithKeyboard(title: string) {
  const button = gameButton(title)
  await button.focus()
  await expect(button).toBeFocused()
  await session.page.keyboard.press("Enter")
  await expect(button).toHaveAttribute("aria-pressed", "true")
}

for (const size of SIZES) {
  test(`${size.width}x${size.height}: proporção original na Grade, em Detalhes e no painel`, async () => {
    await resize(size)
    await chooseView(session.page, "Detalhes")
    await chooseView(session.page, "Grade")
    for (const fixture of COVERS) {
      const button = gameButton(fixture.title)
      const cover = coverIn(button, fixture.title)
      await expectNativeCover(cover, fixture, 384)
      const status = button.getByText(STATUS, { exact: true })
      const title = button.getByText(fixture.title, { exact: true })
      const imageBounds = await cover.boundingBox()
      const statusBounds = await status.boundingBox()
      const titleBounds = await title.boundingBox()
      expect(imageBounds).not.toBeNull()
      expect(statusBounds).not.toBeNull()
      expect(titleBounds).not.toBeNull()
      if (!imageBounds || !statusBounds || !titleBounds) return
      expect(statusBounds.y).toBeGreaterThanOrEqual(imageBounds.y + imageBounds.height - 1)
      expect(titleBounds.y).toBeGreaterThanOrEqual(statusBounds.y + statusBounds.height - 1)
      await expectTextFits(status)
      await expectTextFits(title)
      // Um cartão menor termina junto das suas informações, sem esticar até a altura do vizinho.
      const trailingSpace = await button.evaluate((element) =>
        element.getBoundingClientRect().bottom - element.lastElementChild!.getBoundingClientRect().bottom
      )
      expect(Math.abs(trailingSpace)).toBeLessThanOrEqual(1)
    }

    await chooseView(session.page, "Detalhes")
    for (const fixture of COVERS) {
      await selectWithKeyboard(fixture.title)
      await expect(session.page.locator("main h1")).toHaveText(fixture.title)
      await expectNativeCover(mainCover(fixture.title), fixture, 288, 160)
    }

    await chooseView(session.page, "Grade")
    for (const fixture of COVERS) {
      await selectWithKeyboard(fixture.title)
      const panel = detailsPanel(fixture.title)
      await expect(panel).toBeVisible()
      await expectNativeCover(coverIn(panel, fixture.title), fixture, 320, 176)
      await panel.getByRole("button", { name: "Fechar detalhes", exact: true }).press("Enter")
      await expect(panel).toHaveCount(0)
      await expect(gameButton(fixture.title)).toHaveAttribute("aria-pressed", "true")
    }
  })
}

test("sem capa, imagem inválida e carregamento conservam um placeholder estável", async () => {
  for (const size of SIZES) {
    await resize(size)
    await chooseView(session.page, "Detalhes")
    await chooseView(session.page, "Grade")
    for (const [fixture, state] of [[EMPTY, "empty"], [BROKEN, "error"], [LOADING, "loading"]] as const) {
      const cover = coverIn(gameButton(fixture.title), fixture.title)
      await cover.scrollIntoViewIfNeeded()
      await expect(cover).toHaveAttribute("data-state", state)
      const first = await cover.boundingBox()
      expect(first).not.toBeNull()
      if (!first) return
      expect(first.width).toBeGreaterThan(0)
      expect(Math.abs(first.height - first.width * 1.5)).toBeLessThanOrEqual(1)
      await gameButton(fixture.title).focus()
      const afterFocus = await cover.boundingBox()
      expect(afterFocus).not.toBeNull()
      if (!afterFocus) return
      expect(Math.abs(afterFocus.height - first.height)).toBeLessThanOrEqual(1)
      expect(Math.abs(afterFocus.width - first.width)).toBeLessThanOrEqual(1)
    }
  }

  await chooseView(session.page, "Detalhes")
  await selectWithKeyboard(LOADING.title)
  const cover = mainCover(LOADING.title)
  await expect(cover).toHaveAttribute("data-state", "loading")
  const before = await cover.boundingBox()
  await session.page.evaluate((id) => window.api.games.setFavorite(id, true), LOADING.id)
  await expect(session.page.locator("main h1").getByLabel("Favorito", { exact: true })).toBeVisible()
  await expect(cover).toHaveAttribute("data-state", "loading")
  const after = await cover.boundingBox()
  expect(before).not.toBeNull()
  expect(after).not.toBeNull()
  if (before && after) expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(1)
  await releaseImage(LOADING.id)
  await expectNativeCover(cover, LOADING, 288, 160)
})

async function releaseImage(id: number) {
  await expect.poll(() => session.app.evaluate((_electron, requested) =>
    (globalThis as CoverTestGlobal).__playtroveCoverTest?.gates.get(requested)?.requests ?? 0, id)).toBeGreaterThan(0)
  await session.app.evaluate((_electron, requested) => {
    ;(globalThis as CoverTestGlobal).__playtroveCoverTest?.gates.get(requested)?.release()
  }, id)
}

test("uma imagem lenta do jogo anterior não substitui a seleção atual", async () => {
  await resize(SIZES[0])
  await chooseView(session.page, "Detalhes")
  await selectWithKeyboard(PREVIOUS.title)
  await expect(mainCover(PREVIOUS.title)).toHaveAttribute("data-state", "loading")
  const selected = COVERS[0]
  await selectWithKeyboard(selected.title)
  await expectNativeCover(mainCover(selected.title), selected, 288, 160)
  await releaseImage(PREVIOUS.id)
  // Decodificar o pedido liberado confirma que o resultado tardio já chegou ao renderer.
  await session.page.evaluate(async (id) => {
    const image = new Image()
    image.src = `playtrove-img://images/${id}/cover.png`
    await image.decode()
  }, PREVIOUS.id)
  await expect(session.page.locator("main h1")).toHaveText(selected.title)
  await expect(mainCover(PREVIOUS.title)).toHaveCount(0)
  await expectNativeCover(mainCover(selected.title), selected, 288, 160)
  await expect(gameButton(selected.title)).toHaveAttribute("aria-pressed", "true")
})
