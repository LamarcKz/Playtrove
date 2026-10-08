import { describe, expect, it } from "vitest"
import { messagesFor } from "@shared/i18n"
import { formatDateTime, formatLastPlayed, formatPlaytime, formatReleaseDate, formatTime, shortCoreName } from "@/lib/format"
import { daysAgo } from "./helpers"

const pt = messagesFor("pt-BR")
const en = messagesFor("en")

describe("formatPlaytime", () => {
  it("minutos em texto curto", () => {
    expect(formatPlaytime(0, pt)).toBe("Nunca jogado")
    expect(formatPlaytime(45, pt)).toBe("45 min")
    expect(formatPlaytime(120, pt)).toBe("2 h")
    expect(formatPlaytime(750, pt)).toBe("12 h 30 min")
  })

  it("em inglês", () => {
    expect(formatPlaytime(0, en)).toBe("Never played")
    expect(formatPlaytime(45, en)).toBe("45m")
    expect(formatPlaytime(120, en)).toBe("2h")
    expect(formatPlaytime(750, en)).toBe("12h 30m")
  })
})

describe("formatLastPlayed", () => {
  it("datas próximas por extenso e antigas como data", () => {
    expect(formatLastPlayed(null, pt)).toBe("Nunca jogado")
    expect(formatLastPlayed(new Date().toISOString(), pt)).toBe("Hoje")
    expect(formatLastPlayed(daysAgo(1), pt)).toBe("Ontem")
    expect(formatLastPlayed(daysAgo(5), pt)).toBe("Há 5 dias")
    expect(formatLastPlayed(daysAgo(30), pt)).toBe("Há 30 dias")
    expect(formatLastPlayed("2026-08-01T15:00:00", pt)).toBe("01/08/2026")
  })

  it("em inglês, com o mês antes do dia", () => {
    expect(formatLastPlayed(null, en)).toBe("Never played")
    expect(formatLastPlayed(new Date().toISOString(), en)).toBe("Today")
    expect(formatLastPlayed(daysAgo(1), en)).toBe("Yesterday")
    expect(formatLastPlayed(daysAgo(5), en)).toBe("5 days ago")
    expect(formatLastPlayed("2026-08-01T15:00:00", en)).toBe("08/01/2026")
  })
})

describe("shortCoreName e quantidade de jogos", () => {
  it("nome curto do core e quantidade de jogos, com o plural de cada idioma", () => {
    expect(shortCoreName("Nintendo - Game Boy Advance (mGBA)")).toBe("mGBA")
    expect(shortCoreName("desmume_libretro")).toBe("desmume_libretro")
    expect([0, 1, 7].map(pt.common.games)).toEqual(["0 jogos", "1 jogo", "7 jogos"])
    expect([0, 1, 7].map(en.common.games)).toEqual(["0 games", "1 game", "7 games"])
  })
})

describe("formatReleaseDate", () => {
  it("data do lançamento no formato de cada idioma", () => {
    expect(formatReleaseDate("2003-10-14", pt.locale)).toBe("14/10/2003")
    expect(formatReleaseDate("2003-10-14", en.locale)).toBe("10/14/2003")
    expect(formatReleaseDate("2004", pt.locale)).toBe("2004")
  })
})

describe("data e hora", () => {
  it("no formato de cada idioma", () => {
    const moment = new Date(2026, 8, 22, 21, 30).toISOString()
    expect(formatDateTime(moment, pt.locale)).toMatch(/^22\/09\/2026,? 21:30$/)
    expect(formatDateTime(moment, en.locale)).toMatch(/^9\/22\/26,? 9:30\sPM$/)
    expect(formatTime(moment, pt.locale)).toBe("21:30")
    expect(formatTime(moment, en.locale)).toMatch(/^9:30\sPM$/)
  })
})
