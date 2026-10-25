import { describe, expect, it, vi } from "vitest"
import type { Game, MusicReview } from "@shared/types"
import { MusicReviewsLoader, missingMusicCount } from "@/lib/musicReviewsLoader"

const game = { id: 1, themeMusicMode: "auto", themeMusicUrl: null } as Game
const review = { gameId: 1, state: "needsChoice" } as MusicReview

describe("leitura das escolhas antes do contador", () => {
  it("getReviews retido mantém contagem desconhecida até carregar needsChoice", async () => {
    let resolve!: (reviews: MusicReview[]) => void
    const loader = new MusicReviewsLoader(() => new Promise((done) => { resolve = done }))
    expect(missingMusicCount([game], loader.getSnapshot())).toBeNull()
    const pending = loader.refresh()
    expect(loader.getSnapshot().loading).toBe(true)
    expect(missingMusicCount([game], loader.getSnapshot())).toBeNull()
    resolve([review])
    await pending
    expect(loader.getSnapshot().reviews).toEqual([review])
    expect(missingMusicCount([game], loader.getSnapshot())).toBe(0)
  })
  it("falha não transforma escolhas desconhecidas em downloads e permite tentar de novo", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce([review])
    const loader = new MusicReviewsLoader(read)
    await loader.refresh()
    expect(loader.getSnapshot().loading).toBe(false)
    expect(loader.getSnapshot().error).not.toBeNull()
    expect(missingMusicCount([game], loader.getSnapshot())).toBeNull()
    await loader.refresh()
    expect(loader.getSnapshot().error).toBeNull()
    expect(missingMusicCount([game], loader.getSnapshot())).toBe(0)
  })
  it("uma atualização falha não publica a lista anterior como atual nem aceita resposta antiga", async () => {
    let resolve!: (reviews: MusicReview[]) => void
    const read = vi.fn().mockResolvedValueOnce([review]).mockReturnValueOnce(new Promise((done) => { resolve = done })).mockRejectedValueOnce(new Error("failed"))
    const loader = new MusicReviewsLoader(read)
    await loader.refresh()
    const old = loader.refresh()
    expect(missingMusicCount([game], loader.getSnapshot())).toBeNull()
    await loader.refresh()
    resolve([])
    await old
    expect(loader.getSnapshot().error).not.toBeNull()
    expect(missingMusicCount([game], loader.getSnapshot())).toBeNull()
  })
})
