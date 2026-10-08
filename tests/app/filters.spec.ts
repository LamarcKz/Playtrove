import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test"
import { chooseView, launchApp, removeDataDir } from "./helpers"

test.describe.configure({ mode: "serial" })

let app: ElectronApplication
let page: Page
let dataDir: string
let panel: Locator

test.beforeAll(async () => {
  ;({ app, page, dataDir } = await launchApp())
  panel = page.locator('main aside[aria-label="Filtros"]')
})

test.afterAll(async () => {
  await app?.close()
  removeDataDir(dataDir)
})

const filterButton = () => page.locator('header button[aria-label="Filtros"]')
const blueDot = () => filterButton().locator("span.rounded-full")
const select = (label: string) => panel.getByRole("button", { name: new RegExp(`^${label}`) })
const selectText = (label: string) => select(label).locator("span.truncate")
const rows = () => page.locator("main button[aria-pressed]")

/** Abre um seletor, marca as opções e fecha. */
async function pick(label: string, ...options: string[]) {
  await select(label).click()
  for (const option of options) {
    await page.getByRole("menuitemcheckbox", { name: new RegExp(`^${option.replace("%", "\\%")}\\s*\\d+$`) }).click()
  }
  await page.keyboard.press("Escape")
}

test("o botão abre o painel na direita, com caixinhas e seletores", async () => {
  await expect(panel).toHaveCount(0)
  await filterButton().click()
  await expect(panel).toBeVisible()
  await expect(filterButton()).toHaveAttribute("aria-pressed", "true")

  await expect(panel.locator("label")).toHaveText([/^Favoritos\s*3$/, /^Recentes.*5$/])
  await expect(panel.locator("div.space-y-1\\.5 > span")).toHaveText([
    "Status",
    "Tempo jogado",
    "Nota",
    "Dificuldade",
    "Biblioteca",
    "Plataforma",
    "Gênero",
    "Desenvolvedora",
    "Publicadora",
    "Ano de lançamento",
  ])
  for (const label of ["Status", "Tempo jogado", "Biblioteca", "Plataforma"]) {
    await expect(selectText(label)).toHaveText("Todos")
  }
  // Sem nenhum jogo avaliado, a nota e a dificuldade ficam desativadas, como os filtros de metadados.
  for (const label of ["Nota", "Dificuldade", "Gênero", "Desenvolvedora", "Publicadora", "Ano de lançamento"]) {
    await expect(select(label)).toBeDisabled()
    await expect(selectText(label)).toHaveText("Sem dados ainda")
  }
})

test("Status: várias opções, com a quantidade de jogos", async () => {
  await chooseView(page, "Lista")
  await select("Status").click()
  await expect(page.getByRole("menuitemcheckbox")).toHaveText([
    /Planejo jogar\s*2/,
    /Parei por um tempo\s*1/,
    /Abandonei\s*1/,
    /Jogando\s*3/,
    /Fazendo 100%\s*1/,
    /Platinando\s*1/,
    /Zerado\s*2/,
    /100%\s*0/,
    /Platinado\s*1/,
  ])
  await page.keyboard.press("Escape")

  await pick("Status", "Jogando", "Zerado")
  await expect(selectText("Status")).toHaveText("Jogando, Zerado")
  await expect(rows()).toHaveCount(5)
  await expect(blueDot()).toHaveCount(1)
})

test("Favoritos E (Jogando ou Zerado): nenhum jogo, com o botão Limpar filtros", async () => {
  await panel.locator("label", { hasText: "Favoritos" }).click()
  await expect(page.getByText("Nenhum jogo encontrado")).toBeVisible()
  await expect(panel).toBeVisible()
  await page.locator("main").getByRole("button", { name: "Limpar filtros" }).click()
  await expect(rows()).toHaveCount(12)
  await expect(selectText("Status")).toHaveText("Todos")
  await expect(blueDot()).toHaveCount(0)
})

test("Biblioteca e Plataforma, com os dados dos jogos", async () => {
  await select("Biblioteca").click()
  await expect(page.getByRole("menuitemcheckbox")).toHaveText([/DuckStation\s*3/, /PCSX2\s*5/, /RetroArch\s*4/])
  await page.keyboard.press("Escape")
  await pick("Biblioteca", "RetroArch")
  await expect(rows()).toHaveCount(4)

  await select("Plataforma").click()
  await expect(page.getByRole("menuitemcheckbox")).toHaveText([
    /Game Boy Advance\s*2/,
    /Nintendo DS\s*2/,
    /PlayStation\s*3/,
    /PlayStation 2\s*5/,
  ])
  await page.keyboard.press("Escape")
  await pick("Plataforma", "Nintendo DS")
  await expect(rows()).toHaveCount(2)
  await panel.getByRole("button", { name: "Limpar" }).click()
  await expect(rows()).toHaveCount(12)
})

test("Tempo jogado e busca sem acento", async () => {
  await pick("Tempo jogado", "Mais de 100 h")
  await expect(rows()).toHaveCount(1)
  await expect(rows().first()).toContainText("Mar de Estrelas")
  await pick("Tempo jogado", "Mais de 100 h")
  await expect(rows()).toHaveCount(12)

  await page.getByLabel("Buscar jogos").fill("cronicas")
  await expect(rows()).toHaveCount(1)
  await expect(rows().first()).toContainText("Crônicas de Valdoria")
  await page.getByLabel("Buscar jogos").fill("")
})

test("Kanban com o filtro de status mostra só essas colunas", async () => {
  await chooseView(page, "Kanban")
  await pick("Status", "Jogando", "Zerado")
  await expect(page.locator("main section[aria-label]")).toHaveCount(2)
  await panel.getByRole("button", { name: "Limpar" }).click()
  await expect(page.locator("main section[aria-label]")).toHaveCount(9)
})

test("fechar o painel pelo X mantém o filtro ligado", async () => {
  await panel.locator("label", { hasText: "Favoritos" }).click()
  await panel.getByRole("button", { name: "Fechar filtros" }).click()
  await expect(panel).toHaveCount(0)
  await expect(blueDot()).toHaveCount(1)
  await expect(page.locator("main button[draggable]")).toHaveCount(3)
})
