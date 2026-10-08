import { join } from "node:path"
import { app, BrowserWindow } from "electron"
import type { Language } from "../shared/i18n"

/** Cor de fundo da janela enquanto a interface carrega: a mesma de --background no tema escuro. */
const BACKGROUND_COLOR = "#12161d"

/**
 * Cria a janela principal: sem a barra padrão do Windows (frameless) e com o preload seguro. O idioma
 * vai no endereço da interface (?lang=en), para a primeira tela já aparecer no idioma certo. No npm run
 * dev (`dev`), a janela se chama "Playtrove Dev" e a interface mostra a marca DEV (?dev=1), para não
 * confundir com o app instalado, que pode estar aberto ao lado.
 */
export function createMainWindow(language: Language, dev: boolean): BrowserWindow {
  const win = new BrowserWindow({
    title: dev ? "Playtrove Dev" : "Playtrove",
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: BACKGROUND_COLOR,
    // O app instalado usa o ícone do próprio .exe. Pelo npm run dev, o .exe é o do Electron: sem isto,
    // a janela e a barra de tarefas mostrariam o ícone dele.
    ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), "build", "icon.ico") }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true, // o React não enxerga as variáveis do preload nem do Node
      nodeIntegration: false, // o React não pode usar require() nem módulos do Node
      sandbox: true, // o preload roda com permissões mínimas
    },
  })

  // Só mostra a janela quando a interface já está pronta (evita um flash vazio), e já maximizada.
  // O tamanho de 1280x800 acima vale quando o usuário restaura a janela.
  win.once("ready-to-show", () => {
    win.maximize()
    win.show()
  })

  // Segurança: o app nunca abre outras janelas nem navega para outros endereços.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  win.webContents.on("will-navigate", (event) => {
    if (event.url !== win.webContents.getURL()) event.preventDefault()
  })

  // Em desenvolvimento carrega o servidor do Vite (recarrega sozinho ao salvar);
  // no app final, carrega o HTML gerado pelo build.
  // O título fica o da janela (o do HTML é só "Playtrove").
  win.on("page-title-updated", (event) => event.preventDefault())
  const query: Record<string, string> = dev ? { lang: language, dev: "1" } : { lang: language }
  const devServerUrl = getDevServerUrl()
  if (devServerUrl) {
    const url = new URL(devServerUrl)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    win.loadURL(url.toString())
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"), { query })
  }

  return win
}

/** Confere se uma origem (ex.: "file://") é a da própria interface do app. */
export function isAppOrigin(origin: string): boolean {
  const devServerUrl = getDevServerUrl()
  return origin === (devServerUrl ? new URL(devServerUrl).origin : "file://")
}

/** Endereço do servidor do Vite, quando o app roda em desenvolvimento (npm run dev). */
function getDevServerUrl(): string | undefined {
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"]
  return !app.isPackaged && devServerUrl ? devServerUrl : undefined
}
