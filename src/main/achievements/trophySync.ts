import { existsSync } from "node:fs"
import type Database from "better-sqlite3"
import { listTrophySets, readTrophySet } from "./trophyFiles"
import { copyTrophyIcons, trophyIconsDir } from "./trophyIcons"
import { linkTrophySets, saveTrophySet, trophySetStamp } from "./trophyStore"

export interface TrophySyncServices {
  /** A pasta de troféus do RPCS3 (findTrophyDir). */
  trophyDir: string
  imagesDir: string
  /** Copia a imagem de um troféu (no app, diminuída; nos testes, igual). */
  copyIcon: (source: string, target: string) => void
  /** Os conjuntos de troféus de um jogo, lidos do disco (readPs3TrophySets). */
  readGameSets: (romPath: string) => string[]
}

export interface TrophySyncResult {
  /** Algo mudou (a biblioteca precisa recarregar). */
  changed: boolean
  /** Troféus pegos desde a última leitura (para o aviso). */
  newlyUnlocked: { setId: string; id: number }[]
}

/**
 * Lê os troféus que o RPCS3 guardou: só os conjuntos cujos arquivos mudaram desde a última leitura.
 * Depois, liga os jogos de PS3 da biblioteca aos conjuntos. Tudo local, sem internet.
 */
export function syncTrophies(db: Database.Database, services: TrophySyncServices, now = new Date()): TrophySyncResult {
  let changed = false
  const newlyUnlocked: TrophySyncResult["newlyUnlocked"] = []
  for (const set of listTrophySets(services.trophyDir)) {
    const iconsDir = trophyIconsDir(services.imagesDir, set.id)
    if (trophySetStamp(db, set.id) === set.stamp && existsSync(iconsDir)) continue
    try {
      const { definition, unlocks } = readTrophySet(set, now)
      for (const id of saveTrophySet(db, set.id, definition, unlocks, set.stamp, now)) newlyUnlocked.push({ setId: set.id, id })
      copyTrophyIcons(set.dir, iconsDir, definition.trophies.map((trophy) => trophy.id), services.copyIcon)
      changed = true
    } catch (error) {
      // Arquivo pela metade (o RPCS3 gravando agora) ou estranho: tenta de novo na próxima leitura.
      console.error(`[troféus] não deu para ler ${set.id}:`, error)
    }
  }
  if (linkTrophySets(db, services.readGameSets, now) > 0) changed = true
  return { changed, newlyUnlocked }
}
