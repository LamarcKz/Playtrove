import { describe, expect, it } from "vitest"
import { bugReportUrl } from "../../src/main/bugReport"

describe("formulário de bug", () => {
  it("abre o formulário do GitHub com a versão do app e a do Windows preenchidas", () => {
    const url = new URL(bugReportUrl({ appVersion: "0.5.0", portable: false, windows: "Windows 11 Pro (10.0.26200)" }))
    expect(url.origin + url.pathname).toBe("https://github.com/LamarcKz/Playtrove/issues/new")
    expect(url.searchParams.get("template")).toBe("bug_report.yml")
    expect(url.searchParams.get("version")).toBe("0.5.0")
    expect(url.searchParams.get("windows")).toBe("Windows 11 Pro (10.0.26200)")
  })

  it("na versão portátil, a versão diz que é a portátil", () => {
    const url = new URL(bugReportUrl({ appVersion: "0.5.0", portable: true, windows: "Windows 10 Home (10.0.19045)" }))
    expect(url.searchParams.get("version")).toBe("0.5.0 (portable)")
  })
})
