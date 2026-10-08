import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { app, BrowserWindow, dialog } from "electron"
import { languageFromSystem } from "../shared/i18n"
import { allowControllerAccess } from "./controllers"
import { closeDatabase, getDatabase, openDatabase, takeRepairReport } from "./database"
import { DATABASE_FILE, locateData, portableDataFolder, type DataLocation } from "./dataFolder"
import type { RepairReport } from "./databaseFile"
import { DEV_FOLDER, devLibrary } from "./devLibrary"
import { fillMissingEmulators } from "./emulators"
import { getLanguage, loadLanguage, setCurrentLanguage, t } from "./i18n"
import { handleImageProtocol, registerImageScheme } from "./imageProtocol"
import { registerIpcHandlers, sendWindowStateChanges } from "./ipc"
import { finishAllSessions } from "./launcher"
import { describeRepair } from "./repairNotice"
import { seedSampleGames } from "./sampleGames"
import { emulatorDetectionEnabled, systemDetectionSources, systemLanguages } from "./systemSources"
import { testMode } from "./testMode"
import { createMainWindow } from "./window"

/** Rodando pelo npm run dev (e não nos testes automáticos): usa a cópia da biblioteca, a "Playtrove Dev". */
const isDevBuild = !app.isPackaged && !testMode.dataDir

// Onde ficam os dados. Isto precisa vir antes de o app ficar pronto, porque vale para o app inteiro.
const data = dataLocation()
mkdirSync(data.folder, { recursive: true })
app.setPath("userData", data.folder)

// O mesmo id do instalador: o Windows junta a janela, os atalhos e os avisos do app num ícone só. O
// npm run dev tem o seu, para aparecer separado na barra de tarefas.
app.setAppUserModelId(isDevBuild ? "io.github.lamarckz.playtrove.dev" : "io.github.lamarckz.playtrove")

// Abrir o app de novo só traz para a frente a janela que já está aberta (dois apps mexendo no mesmo
// banco, não). Fica de fora no npm run dev, que fecha e abre o app sozinho a cada mudança no código.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", showMainWindow)
  start()
}

/**
 * Abre o app: o banco, o idioma, os canais IPC, as imagens dos jogos, a leitura dos controles e a
 * janela.
 */
function start(): void {
  // O protocolo das imagens dos jogos (capas, ícones e fundos) precisa ser declarado antes de o app ficar pronto.
  registerImageScheme()

  app
    .whenReady()
    .then(() => {
      // O idioma do Windows vale até o banco abrir (inclusive no aviso de erro, se ele não abrir).
      const locales = systemLanguages()
      setCurrentLanguage(languageFromSystem(locales))
      const db = openDatabase(join(data.folder, data.databaseFile))
      loadLanguage(db, locales)
      const repair = takeRepairReport()
      // Se os emuladores se perderam no conserto, procura de novo agora (para o Jogar funcionar).
      if (repair?.lost.includes("emulators") && emulatorDetectionEnabled) fillMissingEmulators(db, systemDetectionSources())
      if (testMode.sampleGames) seedSampleGames(db)
      registerIpcHandlers()
      handleImageProtocol()
      allowControllerAccess()
      const mainWindow = createMainWindow(getLanguage(), isDevBuild)
      sendWindowStateChanges(mainWindow)
      if (repair) showRepairNotice(mainWindow, repair)
    })
    .catch((error: unknown) => {
      dialog.showErrorBox(t().dialogs.startupError, String(error))
      app.quit()
    })

  // Fechou a janela: encerra o app.
  app.on("window-all-closed", () => app.quit())

  // Fechando o app com jogos abertos: registra o tempo jogado até agora (os emuladores continuam).
  app.on("before-quit", () => finishAllSessions(getDatabase()))

  // Antes de sair, fecha a conexão com o banco.
  app.on("will-quit", () => closeDatabase())
}

/**
 * Onde ficam os dados: nos testes automáticos, numa pasta temporária (nunca a biblioteca de verdade);
 * na versão portátil, na pasta "data" ao lado do .exe; no app instalado, em %APPDATA%\Playtrove, com o
 * que veio da época em que o app se chamava Bibliotecaofgames; e no npm run dev, numa cópia dela, em
 * %APPDATA%\Playtrove Dev, para o código em desenvolvimento nunca mexer nos jogos de verdade.
 */
function dataLocation(): DataLocation {
  if (testMode.dataDir) return { folder: testMode.dataDir, databaseFile: DATABASE_FILE }
  const portable = app.isPackaged ? portableDataFolder(process.execPath) : null
  if (portable) return { folder: portable, databaseFile: DATABASE_FILE }
  const real = locateData(app.getPath("appData"), app.getPath("userData"))
  return app.isPackaged ? real : devLibrary(real, join(app.getPath("appData"), DEV_FOLDER))
}

/** Traz a janela do app para a frente (quando alguém tenta abrir o app de novo). */
function showMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Avisa, quando a janela aparecer, que o banco estava danificado e o que foi recuperado. */
function showRepairNotice(win: BrowserWindow, repair: RepairReport): void {
  const { message, detail } = describeRepair(repair)
  win.once("show", () => {
    void dialog.showMessageBox(win, { type: "warning", title: t().dialogs.repairedTitle, message, detail })
  })
}
