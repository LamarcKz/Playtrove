import { expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { launchApp, removeDataDir } from "./helpers"

// Os testes deste arquivo seguem em ordem, no mesmo app (com os 12 jogos de exemplo e as sessões deles).
test.describe.configure({ mode: "serial" })

let app: ElectronApplication
let page: Page
let dataDir: string

test.beforeAll(async () => {
  ;({ app, page, dataDir } = await launchApp())
  await page.getByRole("button", { name: "Estatísticas", exact: true }).click()
})

test.afterAll(async () => {
  await app?.close()
  removeDataDir(dataDir)
})

const card = (title: string) => page.locator(`main section[aria-label="${title}"]`)
const rows = (listLabel: string) => page.locator(`main [aria-label="${listLabel}"] > li`)

test("o menu tem a aba Estatísticas, logo depois da Biblioteca", async () => {
  const items = page.locator('nav[aria-label="Menu principal"] button')
  expect(await items.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual([
    "Biblioteca",
    "Estatísticas",
    "Conquistas",
    "Emuladores",
    "Configurações",
  ])
  await expect(page.getByRole("heading", { level: 1, name: "Estatísticas" })).toBeVisible()
})

test("resumo: jogos, tempo jogado, média e jogados nos últimos 30 dias", async () => {
  const tiles = page.locator('main dl[aria-label="Resumo"] > div')
  await expect(tiles).toHaveText([
    /^Jogos na biblioteca\s*12\s*3 favoritos$/,
    /^Tempo jogado\s*396 h 10 min\s*Em 10 jogos$/,
    /^Média por jogo jogado\s*39 h 37 min\s*2 jogos nunca jogados$/,
    /^Jogados nos últimos 30 dias\s*5$/,
  ])
})

test("os 10 mais jogados e os jogos por status", async () => {
  const top = rows("Os 10 mais jogados")
  await expect(top).toHaveCount(10)
  await expect(top.first()).toHaveText(/^1\s*Mar de Estrelas\s*200 h 40 min$/)
  await expect(top.nth(1)).toHaveText(/^2\s*Crônicas de Valdoria: Ecos do Abismo\s*73 h$/)
  await expect(top.last()).toHaveText(/^10\s*Jardim dos Autômatos\s*45 min$/)

  const statuses = rows("Jogos por status")
  await expect(statuses).toHaveCount(9)
  await expect(statuses.nth(3)).toHaveText(/^Jogando\s*3 · 25%$/)
  await expect(statuses.nth(7)).toHaveText(/^100%\s*0 · 0%$/)
})

test("atividade: 30 colunas, dica ao passar o mouse e a mesma informação em tabela", async () => {
  const activity = card("Atividade nos últimos 30 dias")
  await expect(activity).toContainText("6 h 45 min em 5 dias")
  const columns = activity.locator("figure button")
  await expect(columns).toHaveCount(30)
  // Só os dias com jogo recebem o foco do teclado.
  await expect(activity.locator('figure button[tabindex="0"]')).toHaveCount(5)

  const today = columns.last()
  await expect(today).toHaveAttribute("aria-label", /: 1 h 30 min$/)
  // Rola antes: a dica do Radix fecha se a página rolar no mesmo instante em que o mouse chega.
  await activity.scrollIntoViewIfNeeded()
  await today.hover()
  await expect(page.getByRole("tooltip")).toContainText("1 h 30 min")

  // Pelo teclado, a mesma dica. (O mouse sai em vários passos: o Radix só fecha a dica no
  // movimento seguinte ao que deixou a coluna.)
  await page.mouse.move(10, 10, { steps: 5 })
  await expect(page.getByRole("tooltip")).toHaveCount(0)
  await columns.nth(28).focus()
  await expect(page.getByRole("tooltip")).toContainText("45 min")

  await activity.getByText("Ver em tabela").click()
  await expect(activity.locator("tbody tr")).toHaveCount(5)
  await expect(activity.locator("tbody tr").first()).toContainText("1 h 30 min")
})

test("por plataforma, por biblioteca, jogados por último e nunca jogados", async () => {
  await expect(rows("Jogos por plataforma").first()).toHaveText(/^PlayStation 2\s*328 h 55 min jogadas\s*5 jogos$/)
  await expect(rows("Jogos por biblioteca")).toHaveText([/^PCSX2/, /^RetroArch/, /^DuckStation/])
  await expect(rows("Jogados por último").first()).toHaveText(/^Neon Madrugada\s*Hoje$/)
  await expect(rows("Jogados por último")).toHaveCount(5)
  await expect(rows("Nunca jogados")).toHaveText([/^Colônia Ártica\s*PlayStation$/, /^Horizonte Partido\s*PlayStation 2$/])
})

test("biblioteca vazia: aviso e o botão para a aba Emuladores", async () => {
  const empty = await launchApp({ sampleGames: false })
  try {
    await empty.page.getByRole("button", { name: "Estatísticas", exact: true }).click()
    await expect(empty.page.getByText("Sem estatísticas ainda")).toBeVisible()
    await empty.page.getByRole("button", { name: "Ir para Emuladores" }).click()
    await expect(empty.page.getByRole("heading", { level: 1, name: "Emuladores" })).toBeVisible()
  } finally {
    await empty.app.close()
    removeDataDir(empty.dataDir)
  }
})
