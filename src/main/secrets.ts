import type Database from "better-sqlite3"
import { safeStorage } from "electron"
import { t } from "./i18n"
import { getSetting, setSetting } from "./settings"

/**
 * Chaves secretas (das APIs), guardadas na tabela settings criptografadas pelo Windows: só a conta
 * do Windows que salvou consegue ler. A interface nunca recebe as chaves de volta.
 */

/** Guarda um segredo criptografado (null apaga). */
export function saveSecret(db: Database.Database, key: string, value: string | null): void {
  if (value === null) {
    setSetting(db, key, null)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(t().errors.cantProtectKey)
  }
  setSetting(db, key, safeStorage.encryptString(value).toString("base64"))
}

/** Lê um segredo. Se não der para abrir (ex.: o banco veio de outro computador), é como se não houvesse. */
export function readSecret(db: Database.Database, key: string): string | null {
  const stored = getSetting(db, key)
  if (!stored) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"))
  } catch {
    return null
  }
}
