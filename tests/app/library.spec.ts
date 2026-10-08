import { expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { chooseView, kanbanCounts, launchApp, removeDataDir } from "./helpers"

// Os testes deste arquivo seguem em ordem, no mesmo app (com os 12 jogos de exemplo).
test.describe.configure({ mode: "serial" })

let app: ElectronApplication
let page: Page
let dataDir: string

test.beforeAll(async () => {
  ;({ app, page, dataDir } = await launchApp())
})

test.afterAll(async () => {
  await app?.close()
  removeDataDir(dataDir)
})

const INITIAL_COUNTS = {
  "Planejo jogar": 2,
  "Parei por um tempo": 1,
  Abandonei: 1,
  Jogando: 3,
  "Fazendo 100%": 1,
  Platinando: 1,
  Zerado: 2,
  "100%": 0,
  Platinado: 1,
}

test("seletor com os 4 modos", async () => {
  const views = page.locator('[aria-label="Modo de exibição"] [role="radio"]')
  await expect(views).toHaveText(["", "", "", ""])
  expect(await views.evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")))).toEqual([
    "Detalhes",
    "Grade",
    "Lista",
    "Kanban",
  ])
})

test("Detalhes: jogos em ordem alfabética e as informações do jogo aberto", async () => {
  const list = page.locator("main button[aria-pressed]")
  await expect(list).toHaveCount(12)
  await expect(list.first()).toHaveText("Cavaleiros de Pixel")
  const info = (label: string) => page.locator("main dl dt", { hasText: label }).locator("xpath=following-sibling::dd[1]")
  await expect(info("Status")).toHaveText("Abandonei")
  await expect(info("Biblioteca")).toHaveText("RetroArch")
  await expect(info("Plataforma")).toHaveText("Nintendo DS")
  await expect(info("Tempo jogado")).toHaveText("1 h 35 min")
})

test("Grade: cada capa tem a faixa com o status", async () => {
  await chooseView(page, "Grade")
  const cards = page.locator("main button[aria-pressed]")
  await expect(cards).toHaveCount(12)
  await expect(cards.filter({ hasText: "Mar de Estrelas" }).locator("span.absolute")).toHaveText("Platinado")
  await expect(cards.filter({ hasText: "Horizonte Partido" }).locator("span.absolute")).toHaveText("Planejo jogar")
})

test("trocar de modo fecha os detalhes, e o jogo continua destacado", async () => {
  const details = page.locator("main aside").filter({ has: page.getByRole("button", { name: "Fechar detalhes" }) })
  const game = page.locator("main button[aria-pressed]", { hasText: "Mar de Estrelas" })
  await chooseView(page, "Detalhes")
  await game.click()

  // Na Grade aparece só a biblioteca: o painel de detalhes abre quando o usuário clica num jogo.
  await chooseView(page, "Grade")
  await expect(details).toHaveCount(0)
  await expect(game).toHaveAttribute("aria-pressed", "true")
  await game.click()
  await expect(details.locator("h2")).toHaveText("Mar de Estrelas")

  // E trocar de modo com o painel aberto fecha ele, mantendo o jogo destacado.
  await chooseView(page, "Lista")
  await expect(details).toHaveCount(0)
  await expect(game).toHaveAttribute("aria-pressed", "true")
})

test("Lista: colunas Nome, Status, Plataforma, Biblioteca, Tempo jogado, Nota, Dificuldade e Conquistas", async () => {
  await chooseView(page, "Lista")
  const header = page.locator("main .sticky > span")
  await expect(header).toHaveText([
    "Nome",
    "Status",
    "Plataforma",
    "Biblioteca",
    "Tempo jogado",
    "Nota",
    "Dificuldade",
    "Conquistas",
  ])
  const row = page.locator("main button[aria-pressed]", { hasText: "Mar de Estrelas" })
  await expect(row.locator(":scope > span")).toHaveText([
    "Mar de Estrelas",
    "Platinado",
    "PlayStation 2",
    "PCSX2",
    "200 h 40 min",
    "—",
    "—",
    "—",
  ])
})

test("Kanban: 9 colunas na tela, sem rolagem para os lados", async () => {
  await chooseView(page, "Kanban")
  await expect(page.locator("main section[aria-label]")).toHaveCount(9)
  expect(await kanbanCounts(page)).toEqual(INITIAL_COUNTS)
  const overflow = await page.$eval("main section[aria-label]", (section) => {
    const board = section.parentElement!
    return board.scrollWidth - board.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)
})

test("Kanban: arrastar muda o status, e o painel de detalhes abre por cima", async () => {
  const card = page.locator('main section[aria-label="Planejo jogar"] button[draggable]', { hasText: "Horizonte Partido" })
  await card.dragTo(page.locator('main section[aria-label="Jogando"]'))
  await expect(page.locator('main section[aria-label="Jogando"] button[draggable]')).toHaveCount(4)
  await expect(page.locator('main section[aria-label="Planejo jogar"] button[draggable]')).toHaveCount(1)

  const widthBefore = await page.locator("main section[aria-label]").first().evaluate((el) => el.clientWidth)
  await page.locator("main button[draggable]", { hasText: "Horizonte Partido" }).click()
  const panel = page.locator("main aside")
  await expect(panel.locator("h2")).toHaveText("Horizonte Partido")
  expect(await panel.evaluate((el) => getComputedStyle(el).position)).toBe("absolute")
  expect(await page.locator("main section[aria-label]").first().evaluate((el) => el.clientWidth)).toBe(widthBefore)
  await panel.getByRole("button", { name: "Fechar detalhes" }).click()
})

test("o status arrastado fica salvo: continua depois de fechar e abrir o app", async () => {
  await app.close()
  ;({ app, page } = await launchApp({ dataDir }))
  await chooseView(page, "Kanban")
  await expect(page.locator('main section[aria-label="Jogando"] button[draggable]', { hasText: "Horizonte Partido" })).toBeVisible()
  expect(await kanbanCounts(page)).toEqual({ ...INITIAL_COUNTS, "Planejo jogar": 1, Jogando: 4 })
})
