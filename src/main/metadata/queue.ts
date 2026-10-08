import type Database from "better-sqlite3"
import type { MetadataProgress } from "../../shared/types"
import { t } from "../i18n"
import { getMetadataTarget } from "../library"
import { downloadGameMetadata, type MetadataServices } from "./download"
import { MetadataStopError } from "./http"

export interface MetadataQueueOptions {
  getDatabase: () => Database.Database
  /** Monta os serviços com as chaves salvas agora; null se nenhum estiver configurado. */
  getServices: () => MetadataServices | null
  /** O andamento mudou (a interface mostra na barra do topo e avisa no fim). */
  onProgress: (progress: MetadataProgress) => void
  /** Um jogo ganhou metadados (a interface recarrega a biblioteca). */
  onGameUpdated: () => void
  /** Pausa entre um jogo e outro, para não sobrecarregar os serviços (em milissegundos). */
  delayMs?: number
}

export interface MetadataQueue {
  /** Coloca jogos na fila (os que já estão nela não entram de novo). Devolve quantos entraram. */
  enqueue: (gameIds: number[]) => number
  getProgress: () => MetadataProgress
}

const IDLE: MetadataProgress = { running: false, done: 0, total: 0, current: null, found: 0, notFound: [], errors: [] }

/**
 * Fila de downloads de metadados: um jogo de cada vez, avisando o andamento a cada passo.
 * Jogos pedidos enquanto a fila anda entram na mesma leva. Uma chave errada ou a falta de internet
 * param a leva inteira (todos os jogos falhariam igual); outros problemas pulam só aquele jogo.
 */
export function createMetadataQueue(options: MetadataQueueOptions): MetadataQueue {
  const pending: number[] = []
  /** Jogo sendo processado agora (pedir ele de novo no meio do download não repete o trabalho). */
  let currentId: number | null = null
  let progress: MetadataProgress = IDLE

  function update(changes: Partial<MetadataProgress>) {
    progress = { ...progress, ...changes }
    options.onProgress(progress)
  }

  async function run() {
    const services = options.getServices()
    if (!services) {
      pending.length = 0
      update({ running: false, errors: [t().errors.noMetadataServices] })
      return
    }

    while (pending.length > 0) {
      const gameId = pending.shift() as number
      currentId = gameId
      let title = t().errors.gameFallback(gameId)
      try {
        title = getMetadataTarget(options.getDatabase(), gameId).title
        update({ current: title })
        const found = await downloadGameMetadata(options.getDatabase(), gameId, services)
        update(found ? { found: progress.found + 1 } : { notFound: [...progress.notFound, title] })
        options.onGameUpdated()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (error instanceof MetadataStopError) {
          // Os que ficaram na fila não serão processados: saem do total.
          update({ errors: [...progress.errors, message], total: progress.total - pending.length })
          pending.length = 0
        } else {
          update({ errors: [...progress.errors, `${title}: ${message}`] })
        }
      }
      currentId = null
      update({ done: progress.done + 1 })
      if (pending.length > 0 && options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
    }
    update({ running: false, current: null })
  }

  return {
    enqueue(gameIds) {
      const fresh = [...new Set(gameIds)].filter((id) => !pending.includes(id) && id !== currentId)
      if (fresh.length === 0) return 0
      pending.push(...fresh)
      if (progress.running) {
        update({ total: progress.total + fresh.length })
      } else {
        update({ ...IDLE, running: true, total: fresh.length })
        void run()
      }
      return fresh.length
    },
    getProgress: () => progress,
  }
}
