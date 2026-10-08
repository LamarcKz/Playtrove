import { join } from "node:path"
import { app } from "electron"
import { getDatabase } from "./database"
import { getEmulatorPaths } from "./emulators"
import { findPlaytimeFiles, readEmulatorRecords, syncEmulatorPlaytime } from "./emulatorPlaytime"
import { testMode } from "./testMode"

/** De quanto em quanto tempo o app relê os registros de tempo dos emuladores. */
const SYNC_INTERVAL_MS = 60_000

/**
 * Lê o tempo jogado que os emuladores registraram e atualiza os jogos. Devolve quantos mudaram.
 * Nos testes, as pastas do Windows ficam dentro da pasta de dados do teste: nada do computador de
 * verdade é lido.
 */
function syncPlaytimeNow(): number {
  const testDataDir = testMode.dataDir
  const folders = testDataDir
    ? { documents: join(testDataDir, "Documentos"), localAppData: join(testDataDir, "LocalAppData") }
    : { documents: app.getPath("documents"), localAppData: process.env["LOCALAPPDATA"] }

  const db = getDatabase()
  return syncEmulatorPlaytime(db, readEmulatorRecords(findPlaytimeFiles(getEmulatorPaths(db), folders)))
}

/**
 * Começa a acompanhar o tempo jogado nos emuladores: lê agora, a cada minuto e sempre que a função
 * devolvida for chamada (ex.: quando um jogo fecha). `onChange` avisa a interface quando algo mudou.
 */
export function startPlaytimeSync(onChange: () => void): () => void {
  const run = () => {
    try {
      if (syncPlaytimeNow() > 0) onChange()
    } catch (error) {
      console.error("[tempo jogado] não deu para ler os registros dos emuladores:", error)
    }
  }
  run()
  setInterval(run, SYNC_INTERVAL_MS).unref()
  return run
}
