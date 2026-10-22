import { spawn, type ChildProcess } from "node:child_process"
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { chromium, expect, type Browser, type Locator, type Page } from "@playwright/test"

/** Pasta do projeto. */
export const ROOT = resolve(__dirname, "../..")

/**
 * O app dos testes: o build de desenvolvimento do Tauri com a interface embutida (a marca DEV e as
 * variáveis PLAYTROVE_* valem nele). O `npm run test:app` compila antes (scripts/build-test-app.mjs).
 */
export const TEST_APP = join(ROOT, "src-tauri", "target", "testes", "debug", "Playtrove.exe")

/** A janela, como o Rust informa nos testes (src-tauri/src/test_hooks.rs), em pixels lógicos. */
export interface TestWindow {
  title: string
  maximized: boolean
  size: [number, number]
  workArea: [number, number]
}

/** O app aberto pelo teste: o processo e a página da janela, ligada pelo protocolo de depuração do WebView2. */
export class AppProcess {
  constructor(
    private readonly child: ChildProcess,
    private readonly browser: Browser,
    readonly page: Page
  ) {}

  /** Chama um comando do Rust, como a interface faz. */
  invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.page.evaluate(
      ([command, args]) =>
        (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(command, args),
      [command, args] as const
    ) as Promise<T>
  }

  version(): Promise<string> {
    return this.invoke("app_version")
  }

  window(): Promise<TestWindow> {
    return this.invoke("test_window")
  }

  /** Tira do maximizado e deixa a página com este tamanho. */
  async setWindowSize(width: number, height: number): Promise<void> {
    await this.invoke("test_set_window_size", { width, height })
    await expect
      .poll(() => this.page.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([width, height])
  }

  /** O que o app pediu para abrir no navegador ou mostrar no Explorador (nos testes, nada abre de verdade). */
  opened(): Promise<string[]> {
    return this.invoke("test_opened")
  }

  /** Fecha o app pela janela, como o usuário (ele registra o que precisa e sai). */
  async close(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      const exited = new Promise((resolve) => this.child.once("exit", resolve))
      await this.invoke("window_close").catch(() => undefined)
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))])
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill()
    }
    await this.browser.close().catch(() => undefined)
  }
}

export interface TestApp {
  app: AppProcess
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

/** Uma porta livre neste computador, para a depuração do WebView2 de cada app aberto. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("sem porta"))))
    })
  })
}

/** Onde fica o que cada app aberto pelos testes escreveu (vai junto com os resultados, se algo falhar). */
const APP_LOGS = join(ROOT, "test-results", "app-logs")

/** O fim do que o app escreveu, para a mensagem de erro. */
function logTail(log: string): string {
  try {
    return readFileSync(log, "utf8").split("\n").slice(-30).join("\n")
  } catch {
    return "(o app não escreveu nada)"
  }
}

/**
 * Liga o Playwright à janela do app, esperando o WebView2 abrir a porta de depuração. Desiste antes do
 * limite do teste, para o erro dizer o que o app escreveu.
 */
async function connect(port: number, child: ChildProcess, log: string): Promise<Browser> {
  const deadline = Date.now() + 40_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`o app fechou ao abrir (código ${child.exitCode}):\n${logTail(log)}`)
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch {
      if (Date.now() > deadline) {
        child.kill()
        throw new Error(`a janela do app não aceitou o Playwright em 40 s:\n${logTail(log)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

/**
 * Abre o app com uma pasta de dados temporária, para nunca mexer na biblioteca de verdade. Espera a
 * janela aparecer e as fontes carregarem.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<TestApp> {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "playtrove-teste-"))
  const port = await freePort()
  mkdirSync(APP_LOGS, { recursive: true })
  const log = join(APP_LOGS, `app-${port}.log`)
  const child = spawn(TEST_APP, [], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // A janela aceita o Playwright pela porta de depuração do WebView2 (só esta execução).
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      PLAYTROVE_DATA_DIR: dataDir,
      PLAYTROVE_SAMPLE_GAMES: options.sampleGames === false ? "0" : "1",
      // Os testes não procuram os emuladores instalados neste computador: cada teste configura os seus.
      PLAYTROVE_SKIP_EMULATOR_DETECTION: "1",
      // Nem dependem do idioma deste Windows.
      PLAYTROVE_SYSTEM_LANGUAGE: options.systemLanguage ?? "pt-BR",
      ...options.env,
    },
  })
  // O que o app escreve (inclusive os erros) vai para um arquivo, lido de novo se ele não abrir.
  const write = (chunk: Buffer) => appendFileSync(log, chunk)
  child.stdout?.on("data", write)
  child.stderr?.on("data", write)
  const browser = await connect(port, child, log)
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent("page"))
  const app = new AppProcess(child, browser, page)
  await page.waitForSelector("nav button")
  if (!options.maximized) await app.setWindowSize(1280, 800)
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
export async function mockOpenDialog(app: AppProcess, path: string): Promise<void> {
  await app.invoke("test_mock_open_dialog", { path })
}
