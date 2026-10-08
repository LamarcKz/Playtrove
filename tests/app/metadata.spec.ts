import { join } from "node:path"
import Database from "better-sqlite3"
import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test"
import {
  IGDB_CLIENT_ID,
  IGDB_CLIENT_SECRET,
  startFakeMetadataServer,
  STEAMGRIDDB_KEY,
  type FakeMetadataServer,
} from "./fakeMetadataServer"
import { chooseView, createFiles, launchApp, mockOpenDialog, removeDataDir, toast } from "./helpers"

// Os testes deste arquivo seguem em ordem, no mesmo app (com os 12 jogos de exemplo). O IGDB e o
// SteamGridDB são de mentira (fakeMetadataServer.ts): nada vai para a internet.
test.describe.configure({ mode: "serial" })

let server: FakeMetadataServer
let app: ElectronApplication
let page: Page
let dataDir: string
let romsDir: string

test.beforeAll(async () => {
  server = await startFakeMetadataServer()
  ;({ app, page, dataDir } = await launchApp({ env: { PLAYTROVE_METADATA_TEST_SERVER: server.url } }))
  romsDir = createFiles(["PS2/Salto Estelar (USA).iso"])
})

test.afterAll(async () => {
  await app?.close()
  await server?.close()
  removeDataDir(dataDir)
  removeDataDir(romsDir)
})

const card = (name: "IGDB" | "SteamGridDB") => page.locator(`section[aria-label="${name}"]`)
const gameButton = (title: string) => page.locator("main button[aria-pressed]", { hasText: title })
const info = (label: string) => page.locator("main dl dt", { hasText: label }).locator("xpath=following-sibling::dd[1]")
const navigate = (page_: "Biblioteca" | "Emuladores" | "Configurações") =>
  page.getByRole("button", { name: page_, exact: true }).click()

/** A imagem aparece de verdade: veio do protocolo das imagens do app e carregou. */
async function expectLoaded(image: Locator, kind: "cover" | "background") {
  await expect(image).toHaveAttribute("src", new RegExp(`^playtrove-img://images/\\d+/${kind}\\.\\w+\\?v=`))
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
}

test("Configurações → Metadados: as três fontes, e só duas pedem chave", async () => {
  await navigate("Configurações")
  await expect(page.locator('section[aria-label="libretro-thumbnails"]')).toContainText("Não precisa de chave.")
  await expect(card("IGDB").getByLabel("Não configurado", { exact: true })).toBeVisible()
  await expect(card("SteamGridDB").getByLabel("Não configurado", { exact: true })).toBeVisible()
  await expect(page.getByText("12 jogos ainda sem metadados.")).toBeVisible()
  // Sem chave nenhuma já dá para baixar: as capas do libretro-thumbnails não pedem chave.
  await expect(page.getByRole("button", { name: "Baixar metadados", exact: true })).toBeEnabled()
})

test("chave errada mostra o erro; a certa é conferida e salva (sem voltar para a tela)", async () => {
  const igdb = card("IGDB")
  await igdb.getByLabel("Client ID", { exact: true }).fill(IGDB_CLIENT_ID)
  await igdb.getByLabel("Client Secret", { exact: true }).fill("segredo-errado")
  await igdb.getByRole("button", { name: "Salvar" }).click()
  await expect(igdb.getByRole("alert")).toHaveText("O Client ID ou o Client Secret do IGDB estão errados.")
  await igdb.getByLabel("Client Secret", { exact: true }).fill(IGDB_CLIENT_SECRET)
  await igdb.getByRole("button", { name: "Salvar" }).click()
  await expect(igdb.getByLabel("Configurado", { exact: true })).toBeVisible()
  await expect(igdb).toContainText(`Client ID: ${IGDB_CLIENT_ID}`)

  const sgdb = card("SteamGridDB")
  await sgdb.getByLabel("Chave da API", { exact: true }).fill("chave-errada")
  await sgdb.getByRole("button", { name: "Salvar" }).click()
  await expect(sgdb.getByRole("alert")).toHaveText("A chave do SteamGridDB está errada.")
  await sgdb.getByLabel("Chave da API", { exact: true }).fill(STEAMGRIDDB_KEY)
  await sgdb.getByRole("button", { name: "Salvar" }).click()
  await expect(sgdb.getByLabel("Configurado", { exact: true })).toBeVisible()
  await expect(sgdb).toContainText("Chave salva.")

  // As chaves secretas nunca voltam para a interface...
  const config = await page.evaluate(() => window.api.metadata.getConfig())
  expect(JSON.stringify(config)).not.toContain(IGDB_CLIENT_SECRET)
  expect(JSON.stringify(config)).not.toContain(STEAMGRIDDB_KEY)
  // ...e ficam criptografadas no banco.
  const db = new Database(join(dataDir, "playtrove.db"), { readonly: true })
  const stored = db.prepare("SELECT group_concat(value, ' ') FROM settings").pluck().get() as string
  db.close()
  expect(stored).not.toContain(IGDB_CLIENT_SECRET)
  expect(stored).not.toContain(STEAMGRIDDB_KEY)
})

test("baixar os metadados dos jogos que ainda não têm", async () => {
  await page.getByRole("button", { name: "Baixar metadados", exact: true }).click()
  await expect(page.getByRole("status", { name: /^Baixando metadados/ })).toBeVisible()
  await expect(
    toast(page, "Metadados baixados para 2 jogos", "Não encontrados: Cavaleiros de Pixel, Cidadela Sombria")
  ).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText("Todos os jogos já têm metadados.")).toBeVisible()
})

test("modo Detalhes: ícone na lista, capa acima do nome, fundo, descrição e detalhes", async () => {
  await navigate("Biblioteca")
  await gameButton("Mar de Estrelas").click()

  // O ícone da lista é um pedaço da capa.
  await expectLoaded(gameButton("Mar de Estrelas").locator("img"), "cover")
  await expectLoaded(page.getByRole("img", { name: "Capa de Mar de Estrelas" }).locator("img"), "cover")
  await expectLoaded(page.locator('main [data-slot="game-backdrop"] img'), "background")
  await expect(page.getByText("Uma viagem pelos mares do espaço, de planeta em planeta.")).toBeVisible()
  await expect(info("Gênero")).toHaveText("Aventura, RPG")
  await expect(info("Desenvolvedora")).toHaveText("Estúdio Aurora")
  await expect(info("Publicadora")).toHaveText("Editora Cometa")
  await expect(info("Lançamento")).toHaveText("14/10/2003")

  // Sem imagens no SteamGridDB: a capa e o fundo vêm do IGDB.
  await gameButton("Rally Extremo 3").click()
  await expectLoaded(page.getByRole("img", { name: "Capa de Rally Extremo 3" }).locator("img"), "cover")
  await expectLoaded(page.locator('main [data-slot="game-backdrop"] img'), "background")
  await expectLoaded(gameButton("Rally Extremo 3").locator("img"), "cover")
  await expect(info("Gênero")).toHaveText("Corrida, Simulação")
})

test("Grade e painel de detalhes: capa no card e fundo no painel", async () => {
  await chooseView(page, "Grade")
  const card_ = gameButton("Mar de Estrelas")
  await expectLoaded(card_.getByRole("img", { name: "Capa de Mar de Estrelas" }).locator("img"), "cover")
  await card_.click()
  const panel = page.locator('main aside[aria-label="Detalhes de Mar de Estrelas"]')
  await expectLoaded(panel.locator('[data-slot="game-backdrop"] img'), "background")
  await panel.getByRole("button", { name: "Fechar detalhes" }).click()

  // Jogo sem metadados continua com o desenho padrão.
  await expect(gameButton("Neon Madrugada").locator("img")).toHaveCount(0)
})

test("filtros de Gênero e Ano de lançamento passam a funcionar", async () => {
  await chooseView(page, "Lista")
  await page.locator('header button[aria-label="Filtros"]').click()
  const panel = page.locator('main aside[aria-label="Filtros"]')
  await panel.getByRole("button", { name: /^Gênero/ }).click()
  await page.getByRole("menuitemcheckbox", { name: /^Corrida\s*1$/ }).click()
  await page.keyboard.press("Escape")
  await expect(page.locator("main button[aria-pressed]")).toHaveText([/^Rally Extremo 3/])

  await panel.getByRole("button", { name: "Limpar" }).click()
  await panel.getByRole("button", { name: /^Ano de lançamento/ }).click()
  await expect(page.getByRole("menuitemcheckbox")).toHaveText([/^2003\s*1$/, /^2005\s*1$/])
  await page.keyboard.press("Escape")
  await panel.getByRole("button", { name: "Fechar filtros" }).click()
})

test("menu Mais: favorito e baixar os metadados de um jogo só", async () => {
  await chooseView(page, "Detalhes")
  await gameButton("Horizonte Partido").click()
  const star = page.locator("main h1").getByLabel("Favorito", { exact: true })
  await expect(star).toHaveCount(0)

  await page.getByRole("button", { name: "Mais", exact: true }).click()
  await page.getByRole("menuitem", { name: "Marcar como favorito" }).click()
  await expect(star).toBeVisible()
  await page.getByRole("button", { name: "Mais", exact: true }).click()
  await page.getByRole("menuitem", { name: "Tirar dos favoritos" }).click()
  await expect(star).toHaveCount(0)

  await page.getByRole("button", { name: "Mais", exact: true }).click()
  await page.getByRole("menuitem", { name: "Baixar metadados" }).click()
  await expect(toast(page, "O jogo não foi encontrado", "Horizonte Partido. Confira se o nome do jogo está certo.")).toBeVisible()
})

test("o protocolo das imagens só entrega arquivos da pasta de imagens", async () => {
  const cover = await page.evaluate(async () => {
    const game = (await window.api.library.get()).games.find((item) => item.title === "Mar de Estrelas")
    return game?.coverUrl ?? ""
  })
  const load = (src: string) =>
    page.evaluate(
      (url) =>
        new Promise<string>((resolve) => {
          const image = new Image()
          image.onload = () => resolve("carregou")
          image.onerror = () => resolve("erro")
          image.src = url
        }),
      src
    )
  expect(await load(cover)).toBe("carregou")
  expect(await load("playtrove-img://images/..%2Fplaytrove.db")).toBe("erro")
  expect(await load("playtrove-img://images/%2E%2E%2F%2E%2E%2Fplaytrove.db")).toBe("erro")
  expect(await load(cover.replace("//images/", "//outro/"))).toBe("erro")
})

test("jogos novos de uma pasta de ROMs já ganham os metadados sozinhos", async () => {
  await navigate("Emuladores")
  await mockOpenDialog(app, join(romsDir, "PS2"))
  await page.getByRole("button", { name: "Adicionar pasta" }).click()
  await page.getByRole("button", { name: "Adicionar e procurar jogos" }).click()
  await expect(toast(page, "1 jogo novo na biblioteca", "Salto Estelar.")).toBeVisible()
  await expect(toast(page, "Metadados baixados para 1 jogo", "")).toBeVisible({ timeout: 20_000 })

  await navigate("Biblioteca")
  await gameButton("Salto Estelar").click()
  await expect(page.getByText("Um herói, um salto e uma cidade inteira para atravessar.")).toBeVisible()
  // A capa veio do libretro-thumbnails, pelo nome exato da ROM.
  expect(server.requests.some((request) => request.includes("/libretro/"))).toBe(true)
  await expectLoaded(page.getByRole("img", { name: "Capa de Salto Estelar" }).locator("img"), "cover")
  await expectLoaded(gameButton("Salto Estelar").locator("img"), "cover")
})
