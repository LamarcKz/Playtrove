import { expect, test, type Page } from "@playwright/test"
import { chooseView, launchApp, removeDataDir } from "./helpers"

/** Os status padrão em inglês, na ordem do Kanban. */
const ENGLISH_STATUSES = [
  "Plan to play",
  "On hold",
  "Abandoned",
  "Playing",
  "Going for 100%",
  "Going for platinum",
  "Beaten",
  "100%",
  "Platinum",
]

/** Os nomes das páginas no menu lateral (o nome acessível de cada botão). */
function sidebarNames(page: Page): Promise<(string | null)[]> {
  return page.locator("nav button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))
}

/** As colunas do Kanban, na ordem. */
function kanbanColumns(page: Page): Promise<(string | null)[]> {
  return page.locator("main section[aria-label]").evaluateAll((sections) => sections.map((section) => section.getAttribute("aria-label")))
}

test("Windows em inglês: o app abre em inglês, com os status padrão traduzidos", async () => {
  const { app, page, dataDir } = await launchApp({ systemLanguage: "en-US" })
  try {
    expect(await sidebarNames(page)).toEqual(["Library", "Statistics", "Achievements", "Emulators", "Settings"])
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en")
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible()
    await expect(page.locator("main dt").filter({ hasText: /^My rating$/ })).toBeVisible()
    await expect(page.locator("main dt").filter({ hasText: /^Playtime$/ })).toBeVisible()

    await chooseView(page, "Kanban")
    expect(await kanbanColumns(page)).toEqual(ENGLISH_STATUSES)

    // A Lista: as colunas e o tempo jogado no formato do inglês.
    await page.getByRole("radio", { name: "List" }).click()
    await expect(page.locator("main").getByText("Name", { exact: true })).toBeVisible()
    await expect(page.locator("main").getByText("12h 30m")).toBeVisible()
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("trocar o idioma em Configurações → Geral vale na hora e fica salvo", async () => {
  const { app, page, dataDir } = await launchApp()
  let reopened: Awaited<ReturnType<typeof launchApp>> | null = null
  try {
    await page.getByRole("button", { name: "Configurações", exact: true }).click()
    const general = page.locator('section[aria-label="Geral"]')
    await expect(general.getByRole("combobox", { name: "Idioma" })).toHaveText("Português (Brasil)")
    await general.getByRole("combobox", { name: "Idioma" }).click()
    await page.getByRole("option", { name: "English" }).click()

    // Na hora, sem reabrir: o menu, as seções e os status.
    await expect(page.locator('section[aria-label="General"]').getByRole("combobox", { name: "Language" })).toHaveText("English")
    expect(await sidebarNames(page)).toEqual(["Library", "Statistics", "Achievements", "Emulators", "Settings"])
    await expect(page.locator("header h1")).toHaveText("Settings")
    const statuses = page.locator('section[aria-label="Statuses"] ul input')
    await expect(statuses.first()).toHaveValue("Plan to play")

    // Um erro do processo principal também sai em inglês.
    await page.getByLabel("Name of the new status").fill("Jogando")
    await page.getByRole("button", { name: "Add", exact: true }).click()
    await expect(page.getByRole("alert")).toHaveText('There\'s already a status called "Jogando".')

    await app.close()
    // Reaberto (com o Windows ainda em português), continua em inglês: vale a escolha salva.
    reopened = await launchApp({ dataDir })
    expect(await sidebarNames(reopened.page)).toEqual(["Library", "Statistics", "Achievements", "Emulators", "Settings"])

    // E dá para voltar ao português.
    await reopened.page.getByRole("button", { name: "Settings", exact: true }).click()
    await reopened.page.getByRole("combobox", { name: "Language" }).click()
    await reopened.page.getByRole("option", { name: "Português (Brasil)" }).click()
    await expect(reopened.page.locator("header h1")).toHaveText("Configurações")
    await expect(reopened.page.locator('section[aria-label="Status"] ul input').first()).toHaveValue("Planejo jogar")
  } finally {
    await (reopened?.app ?? app).close()
    removeDataDir(dataDir)
  }
})

test("em inglês, nenhuma tela tem texto em português", async () => {
  const { app, page, dataDir } = await launchApp({ systemLanguage: "en-US" })
  try {
    // Os jogos de exemplo têm nomes em português (são dados, não textos do app), e o português
    // aparece com o próprio nome na escolha do idioma.
    const titles = await page.evaluate(async () => (await window.api.library.get()).games.map((game) => game.title))
    const leftovers = async (where: string) => {
      const text = await page.evaluate(() => document.body.innerText)
      const clean = [...titles, "Português (Brasil)"].reduce((result, title) => result.split(title).join(" "), text)
      const portuguese = clean
        .split("\n")
        .filter((line) => /[ãõçáéíóúâêô]|\b(de|do|da|não|jogo|jogos|para|com|você|nenhum|nenhuma|mais)\b/i.test(line))
      return portuguese.map((line) => `${where}: ${line}`)
    }
    const found: string[] = []

    found.push(...(await leftovers("Library (Details)")))
    for (const view of ["Grid", "List", "Kanban"]) {
      await page.getByRole("radio", { name: view }).click()
      await page.locator("main button[aria-pressed]").first().click()
      found.push(...(await leftovers(`Library (${view})`)))
    }
    await page.getByRole("button", { name: "Filters", exact: true }).click()
    found.push(...(await leftovers("Filters")))
    await page.getByRole("button", { name: "Filters", exact: true }).click()

    await page.getByRole("radio", { name: "Details" }).click()
    await page.getByRole("button", { name: "More", exact: true }).click()
    found.push(...(await leftovers("More menu")))
    await page.getByRole("menuitem", { name: /Rate game/ }).click()
    found.push(...(await leftovers("Rating dialog")))
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "More", exact: true }).click()
    await page.getByRole("menuitem", { name: /Write review/ }).click()
    found.push(...(await leftovers("Review dialog")))
    await page.keyboard.press("Escape")

    for (const tab of ["Statistics", "Achievements", "Emulators", "Settings"]) {
      await page.getByRole("button", { name: tab, exact: true }).click()
      await page.waitForTimeout(300)
      found.push(...(await leftovers(tab)))
    }
    // As caixas "Como conseguir a chave" dos serviços, abertas.
    for (const summary of await page.locator("details summary").all()) await summary.click()
    found.push(...(await leftovers("Settings (steps)")))

    expect(found).toEqual([])
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})
