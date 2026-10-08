import type { UpdateStatus } from "../shared/types"

/** Quem procura, baixa e instala as versões novas (o electron-updater, ou um de mentira nos testes). */
export interface Updater {
  /** A versão nova, ou null se esta já é a mais nova. */
  check(): Promise<string | null>
  /** Baixa a versão encontrada, avisando o andamento (0 a 100). */
  download(onProgress: (percent: number) => void): Promise<void>
  /** Fecha o app, instala a versão baixada e abre de novo. */
  install(): void
}

export interface UpdateServiceOptions {
  /** null quando o app não se atualiza (rodando pelo npm run dev). */
  updater: Updater | null
  /** Versão portátil: não instala nada; o botão abre a página de download. */
  portable: boolean
  /** A opção "procurar ao abrir", guardada no banco. */
  autoCheck: { get(): boolean; set(enabled: boolean): void }
  openDownloadPage(): void
  onChange(status: UpdateStatus): void
}

export type UpdateService = ReturnType<typeof createUpdateService>

/**
 * A atualização do app: procura uma versão nova (ao abrir, se a opção estiver ligada, ou quando o
 * usuário pede) e, quando ele clica em "Atualizar", baixa, instala e abre o app de novo. Na versão
 * portátil, o mesmo botão só abre a página de download.
 */
export function createUpdateService(options: UpdateServiceOptions) {
  let state: Omit<UpdateStatus, "autoCheck"> = {
    state: options.updater ? "idle" : "unsupported",
    version: null,
    percent: 0,
    portable: options.portable,
  }

  const getStatus = (): UpdateStatus => ({ ...state, autoCheck: options.autoCheck.get() })
  const update = (changes: Partial<typeof state>) => {
    state = { ...state, ...changes }
    options.onChange(getStatus())
  }
  const busy = () => state.state === "checking" || state.state === "downloading" || state.state === "ready"

  /** Procura uma versão nova (se já estiver procurando ou baixando, não faz nada). */
  async function check(): Promise<void> {
    const { updater } = options
    if (!updater || busy()) return
    update({ state: "checking" })
    try {
      const version = await updater.check()
      update(version ? { state: "available", version } : { state: "latest", version: null })
    } catch (error) {
      console.error("[atualização] não deu para procurar:", error)
      update({ state: "error" })
    }
  }

  return {
    getStatus,
    check,

    /** Ao abrir o app: procura, se a opção estiver ligada. */
    checkOnStartup(): Promise<void> {
      return options.autoCheck.get() ? check() : Promise.resolve()
    },

    setAutoCheck(enabled: boolean): void {
      options.autoCheck.set(enabled)
      options.onChange(getStatus())
    },

    /** Instala a versão encontrada: baixa, fecha, instala e abre de novo. Na portátil, abre a página de download. */
    async install(): Promise<void> {
      const { updater } = options
      if (!updater || state.state !== "available") return
      if (options.portable) {
        options.openDownloadPage()
        return
      }
      update({ state: "downloading", percent: 0 })
      try {
        await updater.download((percent) => update({ percent: Math.round(percent) }))
      } catch (error) {
        console.error("[atualização] não deu para baixar:", error)
        update({ state: "error" })
        return
      }
      update({ state: "ready", percent: 100 })
      updater.install()
    },
  }
}
