import { expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { chooseView, launchApp, removeDataDir } from "./helpers"

// Os testes deste arquivo seguem em ordem, no mesmo app (com os 12 jogos de exemplo, nenhum avaliado).
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

const REVIEW = "Uma viagem linda pelo espaço.\nO final é emocionante."
const dialog = () => page.getByRole("dialog")
const game = (title: string) => page.locator("main button[aria-pressed]", { hasText: title })
/** O valor de "Minha nota" ou de "Dificuldade", ao lado do Jogar e do Mais. */
const score = (label: string) => page.locator("main dl dt", { hasText: label }).locator("xpath=following-sibling::dd[1]")
const review = () => page.getByRole("region", { name: "Minha análise" })

/** Abre um item do menu Mais (a janela dele precisa aparecer). */
async function openFromMenu(item: string | RegExp) {
  await page.getByRole("button", { name: "Mais", exact: true }).click()
  await page.getByRole("menuitem", { name: item }).click()
  await expect(dialog()).toBeVisible()
}

test("o menu Mais começa com \"Avaliar jogo…\" e \"Escrever análise…\"", async () => {
  await game("Mar de Estrelas").click()
  await expect(score("Minha nota")).toHaveText("—")
  await expect(score("Dificuldade")).toHaveText("—")

  await page.getByRole("button", { name: "Mais", exact: true }).click()
  await expect(page.getByRole("menuitem").nth(0)).toHaveText("Avaliar jogo…")
  await expect(page.getByRole("menuitem").nth(1)).toHaveText("Escrever análise…")
  await page.keyboard.press("Escape")
})

test("Avaliar jogo: só as estrelas e as pimentas, com meia estrela pelo mouse e pelo teclado", async () => {
  await openFromMenu("Avaliar jogo…")
  await expect(dialog().getByRole("heading")).toHaveText("Avaliar Mar de Estrelas")
  await expect(dialog().getByRole("textbox")).toHaveCount(0)
  const rating = dialog().getByRole("slider", { name: "Nota" })
  const difficulty = dialog().getByRole("slider", { name: "Dificuldade" })
  await expect(rating).toHaveAttribute("aria-valuetext", "Sem nota")
  await expect(difficulty).toHaveAttribute("aria-valuetext", "Sem dificuldade")

  // A metade esquerda da quinta estrela dá quatro e meia.
  await rating.locator('[data-score="9"]').click()
  await expect(rating).toHaveAttribute("aria-valuetext", "4,5 de 5 estrelas")
  // End vai às cinco pimentas; cada seta para a esquerda tira meia.
  await difficulty.focus()
  await page.keyboard.press("End")
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft")
  await expect(difficulty).toHaveAttribute("aria-valuetext", "3,5 de 5 pimentas")

  await dialog().getByRole("button", { name: "Salvar" }).click()
  await expect(dialog()).toHaveCount(0)
  await expect(score("Minha nota").getByRole("img")).toHaveAttribute("aria-label", "4,5 de 5 estrelas")
  await expect(score("Minha nota")).toHaveText("4,5")
  await expect(score("Dificuldade").getByRole("img")).toHaveAttribute("aria-label", "3,5 de 5 pimentas")
  await expect(review()).toHaveCount(0)
})

test("Escrever análise: a janela só com o texto, e a análise aparece em cima da descrição", async () => {
  await openFromMenu("Escrever análise…")
  await expect(dialog().getByRole("heading")).toHaveText("Minha análise de Mar de Estrelas")
  await expect(dialog().getByRole("slider")).toHaveCount(0)
  await dialog().getByLabel("Minha análise").fill(REVIEW)
  await dialog().getByRole("button", { name: "Salvar" }).click()
  await expect(dialog()).toHaveCount(0)

  await expect(review().locator("p")).toHaveText(REVIEW)
  const headings = await page.locator("main h2").allTextContents()
  expect(headings.indexOf("Minha análise")).toBeGreaterThanOrEqual(0)
  expect(headings.indexOf("Minha análise")).toBeLessThan(headings.indexOf("Descrição"))
  // Salvar a análise não mexeu na nota.
  await expect(score("Minha nota")).toHaveText("4,5")

  // Com a análise escrita, o item do menu vira "Editar análise…".
  await page.getByRole("button", { name: "Mais", exact: true }).click()
  await expect(page.getByRole("menuitem").nth(1)).toHaveText("Editar análise…")
  await page.keyboard.press("Escape")
})

test("depois de fechar a janela, o app continua respondendo aos cliques", async () => {
  await game("Neon Madrugada").click()
  await expect(page.locator("main h1")).toHaveText("Neon Madrugada")
  await expect(score("Minha nota")).toHaveText("—")
  await expect(review()).toHaveCount(0)
})

test("Cancelar não muda nada", async () => {
  await openFromMenu("Avaliar jogo…")
  await dialog().getByRole("slider", { name: "Nota" }).locator('[data-score="10"]').click()
  await dialog().getByRole("button", { name: "Cancelar" }).click()
  await expect(dialog()).toHaveCount(0)
  await expect(score("Minha nota")).toHaveText("—")
})

test("na Lista, as colunas Nota e Dificuldade", async () => {
  await chooseView(page, "Lista")
  const cells = game("Mar de Estrelas").locator(":scope > span")
  await expect(cells.nth(5)).toHaveAttribute("aria-label", "4,5 de 5 estrelas")
  await expect(cells.nth(6)).toHaveAttribute("aria-label", "3,5 de 5 pimentas")
  await expect(game("Neon Madrugada").locator(":scope > span").nth(5)).toHaveText("—")
})

test("filtro de nota: as faixas com a quantidade de jogos, e \"4 a 4,5 estrelas\" acha o jogo", async () => {
  const filterButton = page.locator('header button[aria-label="Filtros"]')
  const panel = page.locator('aside[aria-label="Filtros"]')
  await filterButton.click()
  await panel.getByRole("button", { name: /^Nota/ }).click()
  await expect(page.getByRole("menuitemcheckbox")).toHaveText([
    /^5 estrelas\s*0$/,
    /^4 a 4,5 estrelas\s*1$/,
    /^3 a 3,5 estrelas\s*0$/,
    /^2 a 2,5 estrelas\s*0$/,
    /^1 a 1,5 estrela\s*0$/,
    /^Meia estrela\s*0$/,
    /^Sem nota\s*11$/,
  ])
  await page.getByRole("menuitemcheckbox", { name: /^4 a 4,5 estrelas/ }).click()
  await page.keyboard.press("Escape")
  await expect(page.locator("main button[aria-pressed]")).toHaveCount(1)
  await expect(game("Mar de Estrelas")).toBeVisible()

  await panel.getByRole("button", { name: "Limpar" }).click()
  await filterButton.click()
})

test("fica salvo: continua depois de fechar e abrir o app", async () => {
  await app.close()
  ;({ app, page } = await launchApp({ dataDir }))
  await game("Mar de Estrelas").click()
  await expect(score("Minha nota")).toHaveText("4,5")
  await expect(review().locator("p")).toHaveText(REVIEW)
})

test("Limpar tira a nota e a dificuldade (a análise fica), e a análise em branco é apagada", async () => {
  await openFromMenu("Avaliar jogo…")
  await expect(dialog().getByRole("slider", { name: "Nota" })).toHaveAttribute("aria-valuetext", "4,5 de 5 estrelas")
  await dialog().getByRole("button", { name: "Limpar" }).first().click()
  await dialog().getByRole("button", { name: "Limpar" }).click()
  await dialog().getByRole("button", { name: "Salvar" }).click()
  await expect(score("Minha nota")).toHaveText("—")
  await expect(score("Dificuldade")).toHaveText("—")
  await expect(review().locator("p")).toHaveText(REVIEW)

  await openFromMenu("Editar análise…")
  await expect(dialog().getByLabel("Minha análise")).toHaveValue(REVIEW)
  await dialog().getByLabel("Minha análise").fill("   ")
  await dialog().getByRole("button", { name: "Salvar" }).click()
  await expect(review()).toHaveCount(0)
})
