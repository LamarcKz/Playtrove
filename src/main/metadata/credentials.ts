import type Database from "better-sqlite3"
import type { MetadataConfig } from "../../shared/types"
import { readSecret, saveSecret } from "../secrets"
import { getSetting, setSetting } from "../settings"
import type { IgdbCredentials } from "./igdb"

/** Onde cada coisa fica na tabela settings. As chaves secretas vão criptografadas. */
const KEYS = {
  igdbClientId: "igdbClientId",
  igdbClientSecret: "igdbClientSecret",
  steamGridDbKey: "steamGridDbKey",
  autoDownload: "metadataAutoDownload",
}

/** As chaves salvas (só o processo principal lê; a interface nunca recebe as chaves de volta). */
export function readMetadataCredentials(db: Database.Database): {
  igdb: IgdbCredentials | null
  steamGridDbKey: string | null
} {
  const clientId = getSetting(db, KEYS.igdbClientId)
  const clientSecret = readSecret(db, KEYS.igdbClientSecret)
  return {
    igdb: clientId && clientSecret ? { clientId, clientSecret } : null,
    steamGridDbKey: readSecret(db, KEYS.steamGridDbKey),
  }
}

/** O que está configurado, para a tela de Configurações. */
export function getMetadataConfig(db: Database.Database): MetadataConfig {
  const { igdb, steamGridDbKey } = readMetadataCredentials(db)
  return {
    igdb: igdb !== null,
    igdbClientId: igdb?.clientId ?? null,
    steamGridDb: steamGridDbKey !== null,
    autoDownload: getSetting(db, KEYS.autoDownload) !== "0",
  }
}

/** Salva (ou apaga, com null) o Client ID e o Client Secret do IGDB. */
export function saveIgdbCredentials(db: Database.Database, credentials: IgdbCredentials | null): void {
  setSetting(db, KEYS.igdbClientId, credentials?.clientId ?? null)
  saveSecret(db, KEYS.igdbClientSecret, credentials?.clientSecret ?? null)
}

/** Salva (ou apaga, com null) a chave do SteamGridDB. */
export function saveSteamGridDbKey(db: Database.Database, key: string | null): void {
  saveSecret(db, KEYS.steamGridDbKey, key)
}

export function setMetadataAutoDownload(db: Database.Database, enabled: boolean): void {
  setSetting(db, KEYS.autoDownload, enabled ? "1" : "0")
}
