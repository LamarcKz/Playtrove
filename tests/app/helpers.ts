import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from "@playwright/test"

/** Pasta do projeto. */
export const ROOT = resolve(__dirname, "../..")

/** Caminho do executável do Electron (o pacote "electron", importado pelo Node, devolve isso). */
const electronPath = require("electron") as string

export interface TestApp {
  app: ElectronApplication
  page: Page
  /** Pasta de dados temporária desta execução (banco, imagens...). */
  dataDir: string
}

interface LaunchOptions {
  /** Começar com os 12 jogos de exemplo (padrão: sim). */
  sampleGames?: boolean
  /** Reaproveitar a pasta de dados de outra execução (para testar se algo ficou salvo). */
  dataDir?: string
  /** Deixar a janela maximizada, como ela abre (padrão: não; os testes usam 1280x800). */
  maximized?: boolean
  /** Variáveis extras para o app (ex.: o servidor de metadados de mentira). */
  env?: Record<string, string>
  /** O idioma que o Windows finge ter (padrão: português; o app abre nele até alguém escolher outro). */
  systemLanguage?: string
}

/**
 * Abre o app (build de produção em out/) com uma pasta de dados temporária, para nunca mexer na
 * biblioteca de verdade. Espera a janela aparecer e as fontes carregarem.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<TestApp> {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "playtrove-teste-"))
  const app = await electron.launch({
    executablePath: electronPath,
    args: [ROOT],
    cwd: ROOT,
    env: {
      ...process.env,
      PLAYTROVE_DATA_DIR: dataDir,
      PLAYTROVE_SAMPLE_GAMES: options.sampleGames === false ? "0" : "1",
      // Os testes não procuram os emuladores instalados neste computador: cada teste configura os seus.
      PLAYTROVE_SKIP_EMULATOR_DETECTION: "1",
      // Nem dependem do idioma deste Windows.
      PLAYTROVE_SYSTEM_LANGUAGE: options.systemLanguage ?? "pt-BR",
      ...options.env,
    },
  })
  const page = await app.firstWindow()
  await page.waitForSelector("nav button")
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false))
    .toBe(true)
  if (!options.maximized) {
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.unmaximize()
      win.setContentSize(1280, 800)
    })
  }
  // Espera as fontes: sem isso, o layout ainda muda um pouco e o primeiro arraste pode errar o alvo.
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(300)
  return { app, page, dataDir }
}

/** Apaga a pasta de dados temporária (depois de fechar o app). */
export function removeDataDir(dataDir: string): void {
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    // O Windows às vezes ainda segura o arquivo do banco por um instante; a pasta é temporária mesmo.
  }
}

/** Um aviso rápido (canto de baixo) com este título e este texto. */
export function toast(page: Page, title: string, description: string): Locator {
  return page.locator("[role=status], [role=alert]").filter({ hasText: title }).filter({ hasText: description })
}

/** Troca o modo de exibição da Biblioteca pela barra do topo. */
export async function chooseView(page: Page, view: "Detalhes" | "Grade" | "Lista" | "Kanban"): Promise<void> {
  await page.getByRole("radio", { name: view }).click()
}

/** Quantos cards há em cada coluna do Kanban, na ordem das colunas. */
export async function kanbanCounts(page: Page): Promise<Record<string, number>> {
  return page.$$eval("main section[aria-label]", (sections) =>
    Object.fromEntries(
      sections.map((section) => [section.getAttribute("aria-label"), section.querySelectorAll("button[draggable]").length])
    )
  )
}

/**
 * Cria uma pasta temporária com arquivos (vazios ou com o texto dado), para servir de pasta de ROMs
 * ou de emulador de mentira. Os caminhos usam "/" e podem ter subpastas. Apagar com removeDataDir.
 */
export function createFiles(files: Record<string, string> | string[]): string {
  const root = mkdtempSync(join(tmpdir(), "playtrove-arquivos-"))
  const entries = Array.isArray(files) ? files.map((file) => [file, ""]) : Object.entries(files)
  for (const [file, content] of entries) {
    const path = join(root, ...file.split("/"))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  return root
}

/** Faz a próxima janela de "Abrir" do Windows (arquivo ou pasta) responder com este caminho, sem abrir nada. */
export async function mockOpenDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, path)
}
