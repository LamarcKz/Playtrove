import { describe, expect, it } from "vitest"
import type { Game, MusicReview } from "@shared/types"
import { needsMusicDownload, reviewableMusic } from "@/lib/musicReview"

const game = { id: 1, themeMusicMode: "auto", themeMusicUrl: null, themeMusicCheckedAt: null } as Game
const review = { gameId: 1, state: "needsChoice" } as MusicReview

describe("pendências de música nos metadados", () => {
  it("só música faltante mantém o download disponível, inclusive ausência anterior", () => {
    expect(needsMusicDownload(game, [])).toBe(true)
    expect(needsMusicDownload({ ...game, themeMusicCheckedAt: "2026-01-01" }, [])).toBe(true)
    expect(needsMusicDownload(game, [{ ...review, state: "notFound" }])).toBe(true)
    expect(needsMusicDownload(game, [{ ...review, state: "failed" }])).toBe(true)
  })
  it("aguardando escolha não repete busca nem mistura com pendência de download", () => {
    expect(needsMusicDownload(game, [review])).toBe(false)
    expect(reviewableMusic([review], true)).toEqual([])
    expect(reviewableMusic([review], false)).toEqual([review])
  })
  it("preserva música existente, escolha manual e desativação", () => {
    expect(needsMusicDownload({ ...game, themeMusicUrl: "saved" }, [])).toBe(false)
    expect(needsMusicDownload({ ...game, themeMusicMode: "manual" }, [])).toBe(false)
    expect(needsMusicDownload({ ...game, themeMusicMode: "disabled" }, [])).toBe(false)
  })
})
