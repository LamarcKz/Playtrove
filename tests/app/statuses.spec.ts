import { expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { chooseView, kanbanCounts, launchApp, removeDataDir } from "./helpers"

test.describe.configure({ mode: "serial" })

let app: ElectronApplication
let page: Page
let dataDir: string

test.beforeAll(async () => {
  ;({ app, page, dataDir } = await launchApp())
  await page.getByRole("button", { name: "Configurações" }).click()
})

test.afterAll(async () => {
  await app?.close()
  removeDataDir(dataDir)
})

const statusSection = () => page.locator('section[aria-label="Status"]')
const names = () => statusSection().locator("ul[aria-label='Status'] input")
const nameInput = (name: string) => statusSection().getByLabel(`Nome do status ${name}`)
/** A linha (li) de um status, achada pelo campo com o nome dele. */
const row = (name: string) => statusSection().locator("li").filter({ has: page.getByLabel(`Nome do status ${name}`) })

test("Configurações → Status lista os 9 status, com os jogos de cada um", async () => {
  await expect(names()).toHaveCount(9)
  expect(await names().evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual([
    "Planejo jogar",
    "Parei por um tempo",
    "Abandonei",
    "Jogando",
    "Fazendo 100%",
    "Platinando",
    "Zerado",
    "100%",
    "Platinado",
  ])
  await expect(row("Jogando")).toContainText("3 jogos")
  await expect(row("Abandonei")).toContainText("1 jogo")
})

test("renomear e mudar a ordem aparecem no Kanban", async () => {
  // O nome acessível do campo só muda depois de salvar (Enter).
  await nameInput("Planejo jogar").fill("Quero jogar")
  await nameInput("Planejo jogar").press("Enter")
  await statusSection().getByRole("button", { name: "Descer Quero jogar" }).click()
  await expect(names().nth(1)).toHaveValue("Quero jogar")

  await page.getByRole("button", { name: "Biblioteca" }).click()
  await chooseView(page, "Kanban")
  const columns = await page.locator("main section[aria-label]").evaluateAll((sections) =>
    sections.map((section) => section.getAttribute("aria-label"))
  )
  expect(columns.slice(0, 2)).toEqual(["Parei por um tempo", "Quero jogar"])
  await page.getByRole("button", { name: "Configurações" }).click()
})

test("nome repetido mostra o erro e volta o nome antigo", async () => {
  await nameInput("Abandonei").fill("zerado")
  await nameInput("Abandonei").press("Enter")
  await expect(statusSection().getByRole("alert")).toContainText('Já existe um status chamado "zerado"')
  await expect(nameInput("Abandonei")).toHaveValue("Abandonei")
})

test("criar um status novo (vai para o fim)", async () => {
  await statusSection().getByLabel("Nome do novo status").fill("Quero rejogar")
  await statusSection().getByRole("button", { name: "Adicionar" }).click()
  await expect(names()).toHaveCount(10)
  await expect(names().last()).toHaveValue("Quero rejogar")
})

test("apagar um status leva os jogos para o status escolhido", async () => {
  await statusSection().getByRole("button", { name: "Apagar Zerado" }).click()
  await expect(statusSection().getByText("Os 2 jogos dele vão para")).toBeVisible()
  await statusSection().getByLabel("Status que recebe os jogos").click()
  await page.getByRole("option", { name: "Platinado" }).click()
  await statusSection().getByRole("button", { name: "Apagar", exact: true }).click()
  await expect(names()).toHaveCount(9)
  await expect(row("Platinado")).toContainText("3 jogos")
})

test("regras automáticas: escolher o status de jogo novo", async () => {
  const rule = statusSection().getByLabel("Jogo novo entra em")
  await expect(rule).toHaveText("Quero jogar")
  await rule.click()
  await page.getByRole("option", { name: "Quero rejogar" }).click()
  await expect(rule).toHaveText("Quero rejogar")
})

test("tudo continua salvo depois de fechar e abrir o app", async () => {
  await app.close()
  ;({ app, page } = await launchApp({ dataDir }))
  await chooseView(page, "Kanban")
  const counts = await kanbanCounts(page)
  expect(Object.keys(counts)).toEqual([
    "Parei por um tempo",
    "Quero jogar",
    "Abandonei",
    "Jogando",
    "Fazendo 100%",
    "Platinando",
    "100%",
    "Platinado",
    "Quero rejogar",
  ])
  expect(counts.Platinado).toBe(3)
  await page.getByRole("button", { name: "Configurações" }).click()
  await expect(statusSection().getByLabel("Jogo novo entra em")).toHaveText("Quero rejogar")
})
