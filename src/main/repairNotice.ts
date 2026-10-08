import type { RepairReport } from "./databaseFile"
import { t } from "./i18n"

/** O aviso mostrado quando o banco estava danificado e foi consertado ao abrir o app. */
export function describeRepair(report: RepairReport): { message: string; detail: string } {
  const { repair } = t()
  const recovered = report.recovered.map(({ table, rows }) => `${repair.tables[table]} (${rows})`).join(", ")
  const lines = [
    recovered ? repair.recovered(recovered) : repair.nothingRecovered,
    ...report.lost.map((table) => repair.lost(repair.tables[table], repair.effects[table])),
    "",
    repair.damagedFile(report.damagedFile),
  ]
  return { message: repair.message, detail: lines.join("\n") }
}
