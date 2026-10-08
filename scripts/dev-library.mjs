// O comando `npm run dev:nova-copia`: joga fora a cópia da biblioteca que o npm run dev usa
// (%APPDATA%\Playtrove Dev). Na próxima vez que o npm run dev abrir, ele copia de novo a biblioteca de
// verdade (a do app instalado, em %APPDATA%\Playtrove), que este comando nunca toca.
import { existsSync, renameSync, rmSync } from "node:fs"
import { join } from "node:path"

const appData = process.env.APPDATA
if (!appData) {
  console.error("Não achei a pasta %APPDATA% do Windows.")
  process.exit(1)
}

const devFolder = join(appData, "Playtrove Dev")
if (!existsSync(devFolder)) {
  console.log("Ainda não há cópia: o npm run dev faz uma quando abrir.")
  process.exit(0)
}

// Com o npm run dev aberto, o banco está em uso e não dá para mover: aí nada é apagado.
const database = join(devFolder, "playtrove.db")
if (existsSync(database)) {
  try {
    renameSync(database, `${database}.apagando`)
  } catch {
    console.error("O npm run dev está aberto: feche o app e rode de novo.")
    process.exit(1)
  }
}
rmSync(devFolder, { recursive: true, force: true })
console.log("Pronto: na próxima vez que o npm run dev abrir, ele copia de novo a biblioteca do app instalado.")
