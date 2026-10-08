import { describe, expect, it, vi } from "vitest"
import type { UpdateStatus } from "@shared/types"
import { createUpdateService, type Updater, type UpdateServiceOptions } from "../../src/main/updateService"

/** O serviço com um atualizador de mentira (acha a 0.6.0 e baixa na hora), e o que ele avisou. */
function setup(options: Partial<UpdateServiceOptions> = {}, updater: Partial<Updater> | null = {}) {
  let autoCheck = true
  const changes: UpdateStatus[] = []
  const fake: Updater | null =
    updater === null
      ? null
      : {
          check: vi.fn(async () => "0.6.0"),
          download: async (onProgress) => {
            onProgress(33.4)
            onProgress(100)
          },
          install: vi.fn(),
          ...updater,
        }
  const openDownloadPage = vi.fn()
  const service = createUpdateService({
    updater: fake,
    portable: false,
    autoCheck: { get: () => autoCheck, set: (enabled) => (autoCheck = enabled) },
    openDownloadPage,
    onChange: (status) => changes.push(status),
    ...options,
  })
  const states = () => changes.map((status) => status.state)
  return { service, fake, changes, states, openDownloadPage }
}

describe("atualização do app", () => {
  it("rodando pelo código-fonte, não procura nada", async () => {
    const { service, changes } = setup({}, null)
    await service.check()
    await service.install()
    expect(service.getStatus()).toMatchObject({ state: "unsupported", version: null })
    expect(changes).toEqual([])
  })

  it("acha a versão nova", async () => {
    const { service, states } = setup()
    await service.check()
    expect(states()).toEqual(["checking", "available"])
    expect(service.getStatus()).toEqual({ state: "available", version: "0.6.0", percent: 0, portable: false, autoCheck: true })
  })

  it("já na versão mais nova", async () => {
    const { service } = setup({}, { check: async () => null })
    await service.check()
    expect(service.getStatus()).toMatchObject({ state: "latest", version: null })
  })

  it("sem internet: erro, e dá para tentar de novo", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("sem internet")).mockResolvedValueOnce("0.6.0")
    const { service } = setup({}, { check })
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    await service.check()
    expect(service.getStatus().state).toBe("error")
    await service.check()
    expect(service.getStatus()).toMatchObject({ state: "available", version: "0.6.0" })
  })

  it("não procura duas vezes ao mesmo tempo", async () => {
    const { service, fake } = setup()
    await Promise.all([service.check(), service.check()])
    expect(fake?.check).toHaveBeenCalledTimes(1)
  })

  it("Atualizar: baixa, avisando o andamento, e instala", async () => {
    const { service, fake, changes } = setup()
    await service.check()
    await service.install()
    expect(changes.slice(2).map(({ state, percent }) => [state, percent])).toEqual([
      ["downloading", 0],
      ["downloading", 33],
      ["downloading", 100],
      ["ready", 100],
    ])
    expect(fake?.install).toHaveBeenCalledTimes(1)
  })

  it("se o download falhar, não instala nada", async () => {
    const { service, fake } = setup({}, { download: async () => Promise.reject(new Error("caiu a internet")) })
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    await service.check()
    await service.install()
    expect(service.getStatus().state).toBe("error")
    expect(fake?.install).not.toHaveBeenCalled()
  })

  it("na versão portátil, o botão abre a página de download, sem baixar nada", async () => {
    const { service, fake, openDownloadPage } = setup({ portable: true })
    await service.check()
    await service.install()
    expect(openDownloadPage).toHaveBeenCalledTimes(1)
    expect(service.getStatus()).toMatchObject({ state: "available", portable: true })
    expect(fake?.install).not.toHaveBeenCalled()
  })

  it("sem versão nova encontrada, Atualizar não faz nada", async () => {
    const { service, fake } = setup()
    await service.install()
    expect(service.getStatus().state).toBe("idle")
    expect(fake?.install).not.toHaveBeenCalled()
  })

  it("ao abrir, só procura com a opção ligada", async () => {
    const { service, fake, changes } = setup()
    service.setAutoCheck(false)
    expect(changes.at(-1)?.autoCheck).toBe(false)
    await service.checkOnStartup()
    expect(fake?.check).not.toHaveBeenCalled()

    service.setAutoCheck(true)
    await service.checkOnStartup()
    expect(fake?.check).toHaveBeenCalledTimes(1)
  })
})
