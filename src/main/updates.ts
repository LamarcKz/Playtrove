import { app } from "electron"
import { autoUpdater, type ProgressInfo } from "electron-updater"
import { portableDataFolder } from "./dataFolder"
import { testMode } from "./testMode"
import type { Updater } from "./updateService"

/** Esta é a versão portátil (o .zip, com o portable.txt ao lado do .exe)? */
export const isPortable = app.isPackaged && portableDataFolder(process.execPath) !== null

/** Quanto esperar, depois de o app abrir, para procurar versão nova (para não atrasar a abertura). */
export const STARTUP_CHECK_DELAY_MS = testMode.fakeUpdate ? 0 : 5000

/**
 * Quem procura e instala as versões novas: o electron-updater, que lê as releases do GitHub, no app
 * instalado e no portátil; nos testes automáticos, um de mentira (nunca a internet); e ninguém no
 * npm run dev, que roda o código direto.
 */
export function createUpdater(): Updater | null {
  if (testMode.fakeUpdate) return fakeUpdater(testMode.fakeUpdate)
  if (!app.isPackaged) return null

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.setFeedURL({ provider: "github", owner: "LamarcKz", repo: "Playtrove" })
  return {
    async check() {
      const result = await autoUpdater.checkForUpdates()
      return result?.isUpdateAvailable ? result.updateInfo.version : null
    },
    async download(onProgress) {
      const listener = (progress: ProgressInfo) => onProgress(progress.percent)
      autoUpdater.on("download-progress", listener)
      try {
        await autoUpdater.downloadUpdate()
      } finally {
        autoUpdater.off("download-progress", listener)
      }
    },
    // Instala sem mostrar o instalador e abre o app de novo.
    install: () => autoUpdater.quitAndInstall(true, true),
  }
}

/** Nos testes: sempre há a versão dada, o download termina na hora e instalar não fecha nada. */
function fakeUpdater(version: string): Updater {
  return {
    check: async () => version,
    download: async (onProgress) => {
      onProgress(50)
      onProgress(100)
    },
    install: () => undefined,
  }
}
