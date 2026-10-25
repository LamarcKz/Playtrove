import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { ROOT, launchApp, removeDataDir } from "./helpers"

test("preferências musicais acessíveis nos dois idiomas e sem erros na tela", async ({}, info) => {
  const capture = process.env["PLAYTROVE_CAPTURE_MUSIC"] === "1"
  const session = await launchApp({ env: capture ? { PLAYTROVE_HIDE_DEV_MARK: "1" } : {} })
  const errors: string[] = []
  session.page.on("pageerror", (error) => errors.push(error.message))
  try {
    await session.page.getByRole("button", { name: "Configurações", exact: true }).click()
    for (const language of ["pt-BR", "en"] as const) {
      if (language === "en") {
        await session.page.getByRole("combobox", { name: "Idioma", exact: true }).click()
        await session.page.getByRole("option", { name: "English", exact: true }).click()
      }
      const group = session.page.getByRole("group", { name: language === "en" ? "Theme music" : "Música tema", exact: true })
      await expect(group).toBeVisible()
      await expect(group.getByRole("checkbox")).toHaveCount(1)
      await expect(group.getByRole("slider")).toHaveValue("20")
      const acquisition = session.page.getByRole("group", { name: language === "en" ? "Game soundtracks" : "Músicas dos jogos", exact: true })
      await expect(acquisition.getByRole("checkbox")).toBeChecked()
      const box = await group.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(1280)
      expect(errors).toEqual([])
      const path = capture ? join(ROOT, "docs", "screenshots", language, "music.png") : info.outputPath(`music-${language}.png`)
      await session.page.screenshot({ path })
    }
  } finally {
    await session.app.close()
    removeDataDir(session.dataDir)
  }
})
