import { join } from "node:path"
import Database from "better-sqlite3"
import { expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { RA_API_KEY, RA_USERNAME, startFakeMetadataServer, type FakeMetadataServer } from "./fakeMetadataServer"
import { chooseView, launchApp, removeDataDir, toast } from "./helpers"

// Os testes deste arquivo seguem em ordem, no mesmo app (com os 12 jogos de exemplo). O
// RetroAchievements é de mentira (fakeMetadataServer.ts): nada vai para a internet. Lá, os jogos de
// exemplo têm 8 de 15 conquistas desbloqueadas: Mar de Estrelas 3/6, Rally Extremo 3 2/4, Neon
// Madrugada 3/3 (platina) e Cidadela Sombria 0/2.
test.describe.configure({ mode: "serial" })

let server: FakeMetadataServer
let app: ElectronApplication
let page: Page
let dataDir: string

test.beforeAll(async () => {
  server = await startFakeMetadataServer()
  ;({ app, page, dataDir } = await launchApp({ env: { PLAYTROVE_METADATA_TEST_SERVER: server.url } }))
})

test.afterAll(async () => {
  await app?.close()
  await server?.close()
  removeDataDir(dataDir)
})

const navigate = (name: "Biblioteca" | "Conquistas" | "Configurações") =>
  page.getByRole("button", { name, exact: true }).click()
const raCard = () => page.locator('section[aria-label="RetroAchievements"]')
const gameButton = (title: string) => page.locator("main button[aria-pressed]", { hasText: title })
const rows = (listLabel: string) => page.locator(`main [aria-label="${listLabel}"] > li`)
/** O troféu com o progresso ("3 de 6 conquistas"). */
const count = (title: string, label: string | RegExp) => gameButton(title).getByRole("img", { name: label })

test("sem conta, a aba Conquistas leva às Configurações", async () => {
  await navigate("Conquistas")
  await expect(page.getByRole("heading", { level: 1, name: "Conquistas" })).toBeVisible()
  await expect(page.getByText("Conecte o RetroAchievements")).toBeVisible()
  await page.getByRole("button", { name: "Ir para Configurações" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible()
  await expect(raCard().getByLabel("Não configurado", { exact: true })).toBeVisible()
})

test("a conta é conferida antes de salvar, e a chave nunca volta para a tela", async () => {
  const card = raCard()
  await card.getByLabel("Usuário", { exact: true }).fill(RA_USERNAME)
  await card.getByLabel("Web API Key", { exact: true }).fill("chave-errada")
  await card.getByRole("button", { name: "Salvar" }).click()
  await expect(card.getByRole("alert")).toHaveText(
    "O RetroAchievements não aceitou a chave. Confira o usuário e a Web API Key em Configurações."
  )

  await card.getByLabel("Usuário", { exact: true }).fill("Ninguem")
  await card.getByLabel("Web API Key", { exact: true }).fill(RA_API_KEY)
  await card.getByRole("button", { name: "Salvar" }).click()
  await expect(card.getByRole("alert")).toHaveText('Não achei o usuário "Ninguem" no RetroAchievements.')

  await card.getByLabel("Usuário", { exact: true }).fill(RA_USERNAME)
  await card.getByRole("button", { name: "Salvar" }).click()
  await expect(card.getByLabel("Configurado", { exact: true })).toBeVisible()
  await expect(card).toContainText(`Usuário: ${RA_USERNAME}`)

  // A chave nunca volta para a interface e fica criptografada no banco.
  const config = await page.evaluate(() => window.api.achievements.getConfig())
  expect(JSON.stringify(config)).not.toContain(RA_API_KEY)
  const db = new Database(join(dataDir, "playtrove.db"), { readonly: true })
  const stored = db.prepare("SELECT group_concat(value, ' ') FROM settings").pluck().get() as string
  db.close()
  expect(stored).not.toContain(RA_API_KEY)

  // Logo depois de salvar, o app busca as conquistas. A primeira vez busca tudo (consoles, catálogo,
  // conquistas e insígnias de todos os jogos), e pode demorar numa máquina lenta.
  await expect(page.locator('main section[aria-label="Conquistas"]')).toContainText(
    /Última atualização: \d{2}\/\d{2}\/\d{4}/,
    { timeout: 30_000 }
  )
})

test("a biblioteca mostra o progresso na lista da esquerda (e só nos jogos certos)", async () => {
  await navigate("Biblioteca")
  await expect(count("Mar de Estrelas", "3 de 6 conquistas")).toHaveText("3/6")
  await expect(count("Rally Extremo 3", "2 de 4 conquistas")).toBeVisible()
  await expect(count("Neon Madrugada", "Platina: 3 de 3 conquistas")).toBeVisible()
  await expect(count("Cidadela Sombria", "0 de 2 conquistas")).toBeVisible()
  // Jogos que não estão no RetroAchievements (ou de console sem conquistas lá) ficam sem.
  await expect(count("Horizonte Partido", /conquistas/)).toHaveCount(0)
  await expect(count("Cavaleiros de Pixel", /conquistas/)).toHaveCount(0)
  // O hack e a sequência com outro número nunca são confundidos com os jogos da biblioteca.
  expect(server.requests.filter((request) => /g=(3003|3009)\b/.test(request))).toEqual([])
})

test("Detalhes: o cartão das conquistas e a janela com todas", async () => {
  await gameButton("Mar de Estrelas").click()
  const achievements = page.locator('main section[aria-label="Conquistas"]')
  await expect(achievements).toContainText("3/6")
  await expect(achievements).toContainText("50% · 25 pontos")
  await expect(achievements.getByRole("progressbar", { name: "Progresso nas conquistas" })).toHaveAttribute(
    "aria-valuenow",
    "50"
  )
  // Os troféus de cada tipo, como no PS3: o tipo sai dos pontos (5 = bronze, 10 = prata, 25 ou mais = ouro).
  await expect(achievements.getByRole("img", { name: "Platina: 0 de 1" })).toBeVisible()
  await expect(achievements.getByRole("img", { name: "Ouro: 0 de 3" })).toBeVisible()
  await expect(achievements.getByRole("img", { name: "Prata: 2 de 2" })).toBeVisible()
  await expect(achievements.getByRole("img", { name: "Bronze: 1 de 1" })).toBeVisible()
  // As insígnias das últimas desbloqueadas, baixadas do RetroAchievements (a mais nova primeiro).
  const badges = achievements.locator('[aria-label="Últimas desbloqueadas"] img')
  await expect(badges).toHaveCount(3)
  await expect(badges.first()).toHaveAttribute("alt", "Tempestade solar")
  await expect(badges.first()).toHaveAttribute("src", "playtrove-img://images/achievements/30013.png")
  await expect
    .poll(() => badges.first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
    .toBe(true)

  await achievements.getByRole("button", { name: "Ver todas" }).click()
  const dialog = page.getByRole("dialog", { name: "Conquistas de Mar de Estrelas" })
  await expect(dialog).toContainText("3 de 6 desbloqueadas · 25 de 125 pontos")
  const list = dialog.locator('[aria-label="Lista de conquistas"] > li')
  await expect(list).toHaveCount(6)
  // A raridade no estilo da PlayStation, pela porcentagem de jogadores.
  await expect(list.nth(0)).toContainText(/Primeira viagem.*Bronze · Comum · 90% dos jogadores · 5 pontos.*Hardcore/)
  await expect(list.nth(2)).toContainText(/Tempestade solar.*Prata · Rara · 30% dos jogadores · 10 pontos/)
  await expect(list.nth(3)).toContainText(/Colecionador de cometas.*Ouro · Muito rara · 10% dos jogadores · 25 pontos.*Falta/)
  await expect(list.nth(5)).toContainText(/Sem arranhões.*Ouro · Ultrarrara · 2% dos jogadores · 50 pontos.*Falta/)

  await dialog.getByRole("radio", { name: "Faltam" }).click()
  await expect(list).toHaveCount(3)
  await expect(list.first()).toContainText("Colecionador de cometas")
  await dialog.getByRole("radio", { name: "Desbloqueadas" }).click()
  await expect(list).toHaveCount(3)
  await expect(list.first()).toContainText("Primeira viagem")
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})

test("Lista (coluna Conquistas) e Grade (na capa) também mostram o progresso", async () => {
  await chooseView(page, "Lista")
  await expect(page.locator("main .sticky > span").last()).toHaveText("Conquistas")
  await expect(gameButton("Mar de Estrelas").locator(":scope > span").last()).toHaveText("3/6")
  await expect(gameButton("Horizonte Partido").locator(":scope > span").last()).toHaveText("—")

  await chooseView(page, "Grade")
  await expect(count("Neon Madrugada", "Platina: 3 de 3 conquistas")).toHaveText("3/3")
  await expect(count("Rally Extremo 3", "2 de 4 conquistas")).toBeVisible()
  await chooseView(page, "Detalhes")
})

test("aba Conquistas: resumo, gráficos, jogos e as desbloqueadas por último", async () => {
  await navigate("Conquistas")
  await expect(page.locator('main dl[aria-label="Resumo das conquistas"] > div')).toHaveText([
    /^Conquistas\s*8\s*de 15 \(53%\)$/,
    /^Platinas\s*1\s*Jogos platinados$/,
    /^Pontos\s*80$/,
    /^Jogos com conquistas\s*4$/,
  ])

  // Por dia: ontem 1, anteontem 2, hoje nada.
  const byDay = page.locator('figure[aria-label="Conquistas desbloqueadas por dia, nos últimos 30 dias"] button')
  await expect(byDay).toHaveCount(30)
  await expect(byDay.nth(28)).toHaveAttribute("aria-label", /: 1 conquista$/)
  await expect(byDay.nth(27)).toHaveAttribute("aria-label", /: 2 conquistas$/)
  await expect(byDay.last()).toHaveAttribute("aria-label", /: nenhuma conquista$/)
  // Por mês: todas as 8, inclusive a de 40 dias atrás.
  const byMonth = page.locator('figure[aria-label="Conquistas desbloqueadas por mês, nos últimos 12 meses"] button')
  await expect(byMonth).toHaveCount(12)
  const labels = await byMonth.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""))
  expect(labels.reduce((sum, label) => sum + Number(/: (\d+) conquistas?$/.exec(label)?.[1] ?? 0), 0)).toBe(8)

  // Os jogos, do desbloqueio mais recente para o mais antigo (e os sem nenhum no fim).
  await expect(rows("Jogos com conquistas").first().getByRole("img", { name: "Prata: 2 de 2" })).toBeVisible()
  await expect(rows("Jogos com conquistas")).toHaveText([
    /^Mar de Estrelas\s*3\/6 · 50%/,
    /^Rally Extremo 3\s*2\/4 · 50%/,
    /^Neon Madrugada\s*3\/3 · 100%\s*Platina/,
    /^Cidadela Sombria\s*0\/2 · 0%/,
  ])
  const recent = rows("Conquistas recentes")
  await expect(recent).toHaveCount(8)
  await expect(recent.first()).toContainText(/Tempestade solar\s*Mar de Estrelas/)
  await expect(recent.last()).toContainText(/Primeira viagem\s*Mar de Estrelas/)

  // Clicar num jogo abre as conquistas dele.
  await rows("Jogos com conquistas").nth(1).click()
  const dialog = page.getByRole("dialog", { name: "Conquistas de Rally Extremo 3" })
  await expect(dialog).toContainText("2 de 4 desbloqueadas · 15 de 90 pontos")
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})

test("conquista nova: aviso no canto e o progresso sobe na hora", async () => {
  server.unlockAchievement(30014)
  await page.getByRole("button", { name: "Atualizar", exact: true }).click()
  await expect(toast(page, "Conquista desbloqueada: Colecionador de cometas", "Mar de Estrelas · Ouro")).toBeVisible()
  await expect(page.locator('main dl[aria-label="Resumo das conquistas"] > div').first()).toHaveText(
    /^Conquistas\s*9\s*de 15 \(60%\)$/
  )
  await expect(rows("Conquistas recentes").first()).toContainText("Colecionador de cometas")
  await expect(page.locator('figure[aria-label="Conquistas desbloqueadas por dia, nos últimos 30 dias"] button').last()).toHaveAttribute(
    "aria-label",
    /: 1 conquista$/
  )

  await navigate("Biblioteca")
  await expect(count("Mar de Estrelas", "4 de 6 conquistas")).toBeVisible()
})

test("tirar a conta tira as conquistas da biblioteca", async () => {
  await navigate("Configurações")
  await raCard().getByRole("button", { name: "Remover" }).click()
  await expect(raCard().getByLabel("Não configurado", { exact: true })).toBeVisible()

  await navigate("Biblioteca")
  await expect(gameButton("Mar de Estrelas")).toBeVisible()
  await expect(count("Mar de Estrelas", /conquistas/)).toHaveCount(0)
  await expect(page.locator('main section[aria-label="Conquistas"]')).toHaveCount(0)
  await navigate("Conquistas")
  await expect(page.getByText("Conecte o RetroAchievements")).toBeVisible()
})
