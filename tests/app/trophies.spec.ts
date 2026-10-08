import { mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { buildParamSfo } from "../fakeDiscs"
import { makePng } from "../fakePng"
import { buildTropConf, buildTropUsr, type FakeTrophy } from "../fakeTrophies"
import { chooseView, createFiles, launchApp, mockOpenDialog, removeDataDir, toast } from "./helpers"

// Os testes deste arquivo seguem em ordem, no mesmo app, que começa com a biblioteca vazia. O RPCS3
// é de mentira: um executável vazio e a pasta de troféus que ele guardaria, com um jogo fictício.
test.describe.configure({ mode: "serial" })

const SET = "NPWR99999_00"
const TROPHIES: FakeTrophy[] = [
  { id: 0, name: "Lenda das Pistas", detail: "Pegue todos os outros troféus.", grade: "P" },
  { id: 1, name: "Primeira manobra", detail: "Faça a sua primeira manobra.", grade: "B" },
  { id: 2, name: "Rei do half-pipe", detail: "Vença o campeonato de half-pipe.", grade: "S" },
  { id: 3, name: "Segredo da cidade", detail: "Ache a pista escondida.", grade: "G", hidden: true },
  { id: 4, name: "Pico nevado", detail: "Vença na montanha.", grade: "B", group: "001" },
]
const DAY = 24 * 60 * 60 * 1000

let app: ElectronApplication
let page: Page
let dataDir: string
let emulatorsDir: string
let romsDir: string
let setDir: string
let fileVersion = 0

/** Grava o que foi pego, como o RPCS3 faz durante o jogo (a data do arquivo muda a cada gravação). */
function writeUnlocks(unlocked: Record<number, Date>) {
  const file = join(setDir, "TROPUSR.DAT")
  writeFileSync(file, buildTropUsr(TROPHIES.length, unlocked))
  const time = new Date(Date.now() + ++fileVersion * 5000)
  utimesSync(file, time, time)
}

const earlier = { 1: new Date(Date.now() - 3 * DAY), 2: new Date(Date.now() - DAY) }

test.beforeAll(async () => {
  ;({ app, page, dataDir } = await launchApp({ sampleGames: false }))
  emulatorsDir = createFiles({ "RPCS3/rpcs3.exe": "" })
  setDir = join(emulatorsDir, "RPCS3", "dev_hdd0", "home", "00000001", "trophy", SET)
  mkdirSync(setDir, { recursive: true })
  writeFileSync(
    join(setDir, "TROPCONF.SFM"),
    buildTropConf({ id: SET, title: "Manobras Radicais 3", trophies: TROPHIES, groups: [{ id: "001", name: "Pacote Montanha" }] })
  )
  for (const trophy of TROPHIES) {
    writeFileSync(join(setDir, `TROP00${trophy.id}.PNG`), makePng(120, 120, [220, 150 - trophy.id * 20, 40], [80, 40, 10]))
  }
  writeUnlocks(earlier)

  // O jogo, extraído numa pasta: o nome vem do PARAM.SFO e o conjunto de troféus, do TROPDIR.
  romsDir = createFiles({
    "PS3/Manobras Radicais 3/PS3_GAME/USRDIR/EBOOT.BIN": "",
    [`PS3/Manobras Radicais 3/PS3_GAME/TROPDIR/${SET}/TROPHY.TRP`]: "",
  })
  writeFileSync(
    join(romsDir, "PS3", "Manobras Radicais 3", "PS3_GAME", "PARAM.SFO"),
    buildParamSfo({ TITLE_ID: "BLUS30100", TITLE: "Manobras Radicais 3" })
  )
})

test.afterAll(async () => {
  await app?.close()
  removeDataDir(dataDir)
  removeDataDir(emulatorsDir)
  removeDataDir(romsDir)
})

const navigate = (name: "Biblioteca" | "Conquistas" | "Emuladores") => page.getByRole("button", { name, exact: true }).click()
const gameButton = (title: string) => page.locator("main button[aria-pressed]", { hasText: title })
const count = (title: string, label: string) => gameButton(title).getByRole("img", { name: label })
const rows = (listLabel: string) => page.locator(`main [aria-label="${listLabel}"] > li`)
const trophyCard = () => page.locator('main section[aria-label="Troféus"]')

test("com o RPCS3 e a pasta de PS3, os troféus aparecem sozinhos (sem conta)", async () => {
  await page.getByRole("button", { name: "Ir para Emuladores" }).click()
  const rpcs3 = page.locator('ul[aria-label="Emuladores"] > li[aria-label="RPCS3"]')
  await mockOpenDialog(app, join(emulatorsDir, "RPCS3", "rpcs3.exe"))
  await rpcs3.getByRole("button", { name: "Escolher..." }).click()
  await expect(rpcs3.getByLabel("Encontrado")).toBeVisible()

  await mockOpenDialog(app, join(romsDir, "PS3"))
  await page.getByRole("button", { name: "Adicionar pasta" }).click()
  await page.getByRole("form", { name: "Nova pasta de ROMs" }).getByRole("button", { name: "Adicionar e procurar jogos" }).click()
  await expect(toast(page, "1 jogo novo na biblioteca", "Manobras Radicais 3.")).toBeVisible()

  await navigate("Biblioteca")
  await expect(count("Manobras Radicais 3", "2 de 5 troféus")).toHaveText("2/5")
})

test("Detalhes: o cartão dos troféus, com quantos de cada tipo", async () => {
  await gameButton("Manobras Radicais 3").click()
  const card = trophyCard()
  await expect(card).toContainText("2/5")
  await expect(card).toContainText("40%")
  await expect(card).not.toContainText("pontos")
  await expect(card.getByRole("img", { name: "Platina: 0 de 1" })).toBeVisible()
  await expect(card.getByRole("img", { name: "Ouro: 0 de 1" })).toBeVisible()
  await expect(card.getByRole("img", { name: "Prata: 1 de 1" })).toBeVisible()
  await expect(card.getByRole("img", { name: "Bronze: 1 de 2" })).toBeVisible()
  // A imagem de cada troféu vem da pasta do RPCS3 (copiada para a pasta do app).
  const badges = card.locator('[aria-label="Últimos desbloqueados"] img')
  await expect(badges).toHaveCount(2)
  await expect(badges.first()).toHaveAttribute("alt", "Rei do half-pipe")
  await expect(badges.first()).toHaveAttribute("src", `playtrove-img://images/trophies/${SET}/2.png`)
  await expect
    .poll(() => badges.first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
    .toBe(true)
})

test("Ver todos: o tipo de cada troféu, o pacote extra e os ocultos escondidos até pedir", async () => {
  await trophyCard().getByRole("button", { name: "Ver todos" }).click()
  const dialog = page.getByRole("dialog", { name: "Troféus de Manobras Radicais 3" })
  await expect(dialog).toContainText("2 de 5 desbloqueados")
  await expect(dialog).not.toContainText("pontos")
  const list = dialog.locator('[aria-label="Lista de troféus"] > li')
  await expect(list).toHaveCount(5)
  await expect(list.nth(0)).toContainText(/Lenda das Pistas.*Platina.*Falta/)
  await expect(list.nth(2)).toContainText(/Rei do half-pipe.*Prata/)
  await expect(list.nth(3)).toContainText(/Troféu oculto.*Continue jogando para descobrir.*Ouro.*Falta/)
  await expect(list.nth(3)).not.toContainText("Segredo da cidade")
  await expect(list.nth(4)).toContainText(/Pico nevado.*Bronze · Pacote Montanha/)

  await dialog.getByRole("button", { name: "Mostrar ocultos" }).click()
  await expect(list.nth(3)).toContainText(/Segredo da cidade.*Ache a pista escondida/)
  await dialog.getByRole("radio", { name: "Desbloqueados" }).click()
  await expect(list).toHaveCount(2)
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})

test("Lista e Grade: o troféu com o progresso", async () => {
  await chooseView(page, "Lista")
  await expect(gameButton("Manobras Radicais 3").locator(":scope > span").last()).toHaveText("2/5")
  await chooseView(page, "Grade")
  await expect(count("Manobras Radicais 3", "2 de 5 troféus")).toBeVisible()
  await chooseView(page, "Detalhes")
})

test("aba Conquistas sem a conta do RetroAchievements: os troféus aparecem", async () => {
  await navigate("Conquistas")
  await expect(page.getByText("Os troféus do PS3 vêm do RPCS3.")).toBeVisible()
  await expect(page.locator('main dl[aria-label="Resumo das conquistas"] > div')).toHaveText([
    /^Conquistas\s*2\s*de 5 \(40%\)$/,
    /^Platinas\s*0\s*Jogos platinados$/,
    /^Jogos com conquistas\s*1$/,
  ])
  const game = rows("Jogos com conquistas").first()
  await expect(game).toContainText("Manobras Radicais 3")
  await expect(game.getByRole("img", { name: "Prata: 1 de 1" })).toBeVisible()
  await expect(game.getByRole("img", { name: "Bronze: 1 de 2" })).toBeVisible()
  await expect(rows("Conquistas recentes")).toHaveCount(2)
  await expect(rows("Conquistas recentes").first()).toContainText(/Rei do half-pipe\s*Manobras Radicais 3/)
})

test("troféu novo no RPCS3: aviso no canto, e a platina", async () => {
  const now = new Date()
  writeUnlocks({ ...earlier, 0: now, 3: now })
  await page.getByRole("button", { name: "Atualizar", exact: true }).click()
  await expect(toast(page, "Troféu desbloqueado: Segredo da cidade", "Manobras Radicais 3 · Ouro")).toBeVisible()
  await expect(toast(page, "Troféu desbloqueado: Lenda das Pistas", "Manobras Radicais 3 · Platina")).toBeVisible()
  await expect(page.locator('main dl[aria-label="Resumo das conquistas"] > div').nth(1)).toHaveText(/^Platinas\s*1/)

  await navigate("Biblioteca")
  await expect(count("Manobras Radicais 3", "Platina: 4 de 5 troféus")).toBeVisible()
  await expect(trophyCard()).toContainText("Platina")
})
