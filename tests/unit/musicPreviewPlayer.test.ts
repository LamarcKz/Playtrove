import { describe, expect, it, vi } from "vitest"
import { MusicPreviewPlayer } from "@/lib/musicPreviewPlayer"

function setup() {
  const audio = { src: "", volume: 0, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn() }
  const request = vi.fn()
  const cancel = vi.fn().mockResolvedValue("operation")
  const owner = new MusicPreviewPlayer(audio, { preview: request, cancelPreview: cancel }, vi.fn())
  return { audio, request, cancel, owner }
}

describe("prévia sob demanda", () => {
  it("confirmação usa a autorização do backend e fechar durante o handshake impede envio", async () => {
    const { owner, cancel } = setup()
    let release!: (operation: string) => void
    cancel.mockReturnValueOnce(new Promise<string>((resolve) => { release = resolve }))
    const pending = owner.prepareChoice()
    await Promise.resolve()
    owner.dispose()
    release("revoked")
    expect(await pending).toBeUndefined()
    const ready = setup()
    expect(await ready.owner.prepareChoice()).toBe("operation")
    ready.owner.dispose()
  })
  it("fechar uma confirmação sem escuta cancela a transferência pendente", async () => {
    const { owner, cancel } = setup()
    expect(await owner.prepareChoice()).toBe("operation")
    owner.dispose()
    expect(cancel).toHaveBeenCalledTimes(2)
  })
  it("fechar confirmação após parar a escuta também cancela", async () => {
    const { owner, request, cancel } = setup()
    request.mockResolvedValue({ url: "preview", token: "token" })
    await owner.listen(1, "generation", "candidate", 20)
    await owner.stop()
    await owner.prepareChoice()
    owner.dispose()
    expect(cancel).toHaveBeenCalledTimes(4)
  })
  it("não toca resposta de download depois de fechar", async () => {
    const { owner, request, audio, cancel } = setup()
    let resolve!: (value: { url: string; token: string }) => void
    request.mockReturnValue(new Promise((done) => { resolve = done }))
    const pending = owner.listen(1, "generation", "candidate", 27)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    owner.dispose()
    resolve({ url: "preview", token: "token" })
    await pending
    expect(audio.play).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()
  })
  it("troca rápida ignora áudio antigo e usa volume mesmo sem preferência de reprodução", async () => {
    const { owner, request, audio } = setup()
    let resolve!: (value: { url: string; token: string }) => void
    request.mockReturnValueOnce(new Promise((done) => { resolve = done })).mockResolvedValueOnce({ url: "new", token: "new" })
    const old = owner.listen(1, "generation", "old", 27)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await owner.listen(1, "generation", "new", 27)
    resolve({ url: "old", token: "old" })
    await old
    expect(audio.src).toBe("new")
    expect(audio.volume).toBe(0.27)
    expect(audio.play).toHaveBeenCalledTimes(1)
    owner.dispose()
  })
  it("pausar cancela download e foco suspenso não retoma sozinho", async () => {
    const { owner, request, audio, cancel } = setup()
    request.mockResolvedValue({ url: "preview", token: "token" })
    await owner.listen(1, "generation", "candidate", 20)
    owner.stop()
    expect(audio.pause).toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()
    expect(audio.play).toHaveBeenCalledTimes(1)
    owner.dispose()
  })
  it("respeita volume alterado enquanto a prévia ainda está baixando", async () => {
    const { owner, request, audio } = setup()
    let resolve!: (value: { url: string; token: string }) => void
    request.mockReturnValue(new Promise((done) => { resolve = done }))
    const pending = owner.listen(1, "generation", "candidate", 20)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    owner.setVolume(61)
    resolve({ url: "preview", token: "token" })
    await pending
    expect(audio.volume).toBe(0.61)
    owner.dispose()
  })
  it("confirmar prévia pronta para o áudio sem apagar o cache antes da escolha", async () => {
    const { owner, request, audio, cancel } = setup()
    request.mockResolvedValue({ url: "preview", token: "token" })
    await owner.listen(1, "generation", "candidate", 20)
    const cancellations = cancel.mock.calls.length
    expect(await owner.prepareChoice()).toBe("operation")
    expect(request).toHaveBeenCalledWith(1, "generation", "candidate", "operation")
    expect(audio.pause).toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(cancellations)
    owner.dispose()
    expect(cancel).toHaveBeenCalledTimes(cancellations + 1)
  })
})
