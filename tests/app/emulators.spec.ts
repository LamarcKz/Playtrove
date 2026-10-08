import { join } from "node:path"
import { expect, test, type ElectronApplication, type Page } from "@playwright/test"
import { writeFileSync } from "node:fs"
import { mkdirSync } from "node:fs"
import { buildIso } from "../fakeDiscs"
import { chooseView, createFiles, launchApp, mockOpenDialog, removeDataDir, toast as toastIn } from "./helpers"

// Os testes deste arquivo seguem em ordem, no mesmo app, que começa com a biblioteca vazia.
// Os emuladores são arquivos vazios numa pasta temporária: nenhum jogo é aberto de verdade.
test.describe.configure({ mode: "serial" })

let app: ElectronApplication
let page: Page
let dataDir: string
let emulatorsDir: string
let romsDir: string

test.beforeAll(async () => {
  ;({ app, page, dataDir } = await launchApp({ sampleGames: false }))
  emulatorsDir = createFiles({
    "PCSX2/pcsx2-qt.exe": "",
    "RetroArch/retroarch.exe": "",
    "RetroArch/cores/mgba_libretro.dll": "",
    "RetroArch/info/mgba_libretro.info": 'display_name = "Nintendo - Game Boy Advance (mGBA)"\nsupported_extensions = "gb|gbc|gba"\n',
  })
  romsDir = createFiles([
    "PS2/Salto Estelar (USA).iso",
    "PS2/Pista Real 4 (Europe, Australia).iso",
    "PS2/leia-me.txt",
    "GBA/Runas de Ouro (USA).gba",
    "PS1/Cidade Neon (USA)/Cidade Neon (USA).cue",
    "PS1/Cidade Neon (USA)/Cidade Neon (USA) (Track 1).bin",
    "PS3/Manobras Radicais 3 (USA).iso",
  ])
  // Uma ISO de verdade (de mentira), com o código do disco que o PCSX2 usa nos registros de tempo.
  writeFileSync(
    join(romsDir, "PS2", "Salto Estelar (USA).iso"),
    buildIso([{ path: ["SYSTEM.CNF"], content: Buffer.from("BOOT2 = cdrom0:\\SCUS_971.00;1\r\n", "latin1") }])
  )
  // E o registro de tempo do PCSX2 (37 min), na pasta de Documentos deste teste.
  mkdirSync(join(dataDir, "Documentos", "PCSX2", "inis"), { recursive: true })
  writeFileSync(
    join(dataDir, "Documentos", "PCSX2", "inis", "playtime.dat"),
    `${"SCUS-97100".padEnd(32)} ${"2237".padEnd(20)} ${String(Math.floor(Date.now() / 1000)).padEnd(20)}\n`
  )
})

test.afterAll(async () => {
  await app?.close()
  removeDataDir(dataDir)
  removeDataDir(emulatorsDir)
  removeDataDir(romsDir)
})

const emulatorRow = (name: string) => page.locator(`ul[aria-label="Emuladores"] > li[aria-label="${name}"]`)
const folderRows = () => page.locator('ul[aria-label="Pastas de ROMs"] > li')
const toast = (title: string, description: string) => toastIn(page, title, description)

/** Adiciona uma pasta de ROMs como o usuário faz (a janela do Windows é simulada). */
async function pickRomFolder(name: string) {
  await mockOpenDialog(app, join(romsDir, name))
  await page.getByRole("button", { name: "Adicionar pasta" }).click()
  return page.getByRole("form", { name: "Nova pasta de ROMs" })
}

test("biblioteca vazia leva para a aba Emuladores, com os 4 emuladores", async () => {
  await expect(page.getByText("Sua biblioteca está vazia")).toBeVisible()
  await page.getByRole("button", { name: "Ir para Emuladores" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Emuladores" })).toBeVisible()
  await expect(page.locator('ul[aria-label="Emuladores"] > li')).toHaveCount(4)
  for (const name of ["PCSX2", "DuckStation", "RetroArch", "RPCS3"]) {
    await expect(emulatorRow(name).getByLabel("Não encontrado")).toBeVisible()
    await expect(emulatorRow(name).getByRole("button", { name: "Escolher..." })).toBeVisible()
  }
  await expect(page.getByText("Nenhuma pasta ainda.")).toBeVisible()
})

test("escolher o executável de um emulador (e ver os cores do RetroArch)", async () => {
  await mockOpenDialog(app, join(emulatorsDir, "PCSX2", "pcsx2-qt.exe"))
  await emulatorRow("PCSX2").getByRole("button", { name: "Escolher..." }).click()
  await expect(emulatorRow("PCSX2").getByLabel("Encontrado")).toBeVisible()
  await expect(emulatorRow("PCSX2")).toContainText(join(emulatorsDir, "PCSX2", "pcsx2-qt.exe"))
  await expect(emulatorRow("PCSX2").getByRole("button", { name: "Trocar..." })).toBeVisible()

  await mockOpenDialog(app, join(emulatorsDir, "RetroArch", "retroarch.exe"))
  await emulatorRow("RetroArch").getByRole("button", { name: "Escolher..." }).click()
  await expect(emulatorRow("RetroArch")).toContainText("1 core: Nintendo - Game Boy Advance (mGBA)")
})

test("pasta de PS2: a sugestão vem do nome da pasta e os jogos entram na biblioteca", async () => {
  const form = await pickRomFolder("PS2")
  await expect(form.getByRole("combobox", { name: "Emulador" })).toHaveText("PCSX2")
  await expect(form.getByRole("combobox", { name: "Core" })).toHaveCount(0)
  await expect(form.getByLabel("Console")).toHaveValue("PlayStation 2")
  await form.getByRole("button", { name: "Adicionar e procurar jogos" }).click()

  await expect(toast("2 jogos novos na biblioteca", "Pista Real 4, Salto Estelar.")).toBeVisible()
  await expect(folderRows()).toHaveCount(1)
  await expect(folderRows().first()).toContainText("PCSX2 · PlayStation 2 · 2 jogos")
})

test("pasta de GBA: RetroArch com o core mGBA", async () => {
  const form = await pickRomFolder("GBA")
  await expect(form.getByRole("combobox", { name: "Emulador" })).toHaveText("RetroArch")
  await expect(form.getByRole("combobox", { name: "Core" })).toHaveText("mGBA")
  await expect(form.getByLabel("Console")).toHaveValue("Game Boy Advance")
  await form.getByRole("button", { name: "Adicionar e procurar jogos" }).click()

  await expect(toast("1 jogo novo na biblioteca", "Runas de Ouro.")).toBeVisible()
  await expect(folderRows().filter({ hasText: "GBA" })).toContainText("RetroArch (mGBA) · Game Boy Advance · 1 jogo")
})

test("pasta de PS1: fica só o .cue (o .bin não vira outro jogo)", async () => {
  const form = await pickRomFolder("PS1")
  await expect(form.getByRole("combobox", { name: "Emulador" })).toHaveText("DuckStation")
  await form.getByRole("button", { name: "Adicionar e procurar jogos" }).click()
  await expect(toast("1 jogo novo na biblioteca", "Cidade Neon.")).toBeVisible()
})

test("pasta de PS3: o RPCS3 é o emulador sugerido", async () => {
  const form = await pickRomFolder("PS3")
  await expect(form.getByRole("combobox", { name: "Emulador" })).toHaveText("RPCS3")
  await expect(form.getByLabel("Console")).toHaveValue("PlayStation 3")
  await form.getByRole("button", { name: "Adicionar e procurar jogos" }).click()
  await expect(toast("1 jogo novo na biblioteca", "Manobras Radicais 3.")).toBeVisible()
})

test("cancelar e pasta repetida", async () => {
  let form = await pickRomFolder("PS2")
  await form.getByRole("button", { name: "Cancelar" }).click()
  await expect(form).toHaveCount(0)

  form = await pickRomFolder("PS2")
  await form.getByRole("button", { name: "Adicionar e procurar jogos" }).click()
  await expect(toast("Não deu para adicionar a pasta", "Essa pasta já está na lista.")).toBeVisible()
  await form.getByRole("button", { name: "Cancelar" }).click()
  await expect(folderRows()).toHaveCount(4)
})

test("procurar de novo não duplica os jogos", async () => {
  await page.getByRole("button", { name: "Procurar jogos em todas" }).click()
  await expect(toast("Nenhum jogo novo", "5 jogos já estavam na biblioteca.")).toBeVisible()
})

test("o tempo que o emulador registrou aparece na biblioteca", async () => {
  await page.getByRole("button", { name: "Biblioteca", exact: true }).click()
  await chooseView(page, "Lista")
  const salto = page.locator("main button[aria-pressed]", { hasText: "Salto Estelar" })
  // A quinta coluna é o Tempo jogado (depois dela vêm a Nota, a Dificuldade e as Conquistas).
  await expect(salto.locator(":scope > span").nth(4)).toHaveText("37 min")
})

test("e também na atividade das Estatísticas, no dia da última vez jogado", async () => {
  await page.getByRole("button", { name: "Estatísticas", exact: true }).click()
  const activity = page.locator('main section[aria-label="Atividade nos últimos 30 dias"]')
  await expect(activity).toContainText("37 min em 1 dia")
  // A última coluna é hoje, que é quando o registro do PCSX2 diz que o jogo foi jogado.
  await expect(activity.locator("figure button").last()).toHaveAttribute("aria-label", /: 37 min$/)
})

test("os jogos aparecem na biblioteca com o console e a biblioteca", async () => {
  await page.getByRole("button", { name: "Biblioteca", exact: true }).click()
  const rows = page.locator("main button[aria-pressed]")
  await expect(rows).toHaveCount(5)
  const cells = (index: number) => rows.nth(index).locator(":scope > span")
  await expect(cells(0)).toHaveText(["Cidade Neon", "Planejo jogar", "PlayStation", "DuckStation", "Nunca jogado", "—", "—", "—"])
  await expect(cells(1)).toHaveText(["Manobras Radicais 3", "Planejo jogar", "PlayStation 3", "RPCS3", "Nunca jogado", "—", "—", "—"])
  await expect(cells(2)).toHaveText(["Pista Real 4", "Planejo jogar", "PlayStation 2", "PCSX2", "Nunca jogado", "—", "—", "—"])
  await expect(cells(3)).toHaveText(["Runas de Ouro", "Planejo jogar", "Game Boy Advance", "RetroArch", "Nunca jogado", "—", "—", "—"])
  await expect(cells(4)).toHaveText(["Salto Estelar", "Planejo jogar", "PlayStation 2", "PCSX2", "37 min", "—", "—", "—"])
})

test("Jogar sem o emulador configurado mostra o aviso", async () => {
  await chooseView(page, "Detalhes")
  await page.locator("main button[aria-pressed]", { hasText: "Cidade Neon" }).click()
  await page.getByRole("button", { name: "Jogar", exact: true }).click()
  await expect(
    toast("Não deu para abrir Cidade Neon", "O DuckStation não foi encontrado. Configure ele na aba Emuladores.")
  ).toBeVisible()
})

test("tirar uma pasta não tira os jogos dela", async () => {
  await page.getByRole("button", { name: "Emuladores", exact: true }).click()
  const gba = join(romsDir, "GBA")
  await page.getByRole("button", { name: `Tirar a pasta ${gba}` }).click()
  await expect(folderRows()).toHaveCount(3)
  await page.getByRole("button", { name: "Biblioteca", exact: true }).click()
  await expect(page.locator("main button[aria-pressed]", { hasText: "Runas de Ouro" })).toBeVisible()
})
