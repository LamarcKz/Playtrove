import { expect, test } from "@playwright/test"
import { launchApp, removeDataDir } from "./helpers"

// A atualização de verdade vem das releases do GitHub; aqui, o app finge que existe a 9.9.0 (nunca a internet).
const FAKE_UPDATE = { PLAYTROVE_FAKE_UPDATE: "9.9.0" }

test("versão nova: o aviso aparece e Atualizar baixa e instala", async () => {
  const { app, page, dataDir } = await launchApp({ env: FAKE_UPDATE })
  try {
    const notice = page.getByRole("status").filter({ hasText: "Versão 9.9.0 disponível" })
    await expect(notice).toBeVisible()
    await expect(notice).toContainText("O app baixa a versão nova, instala e abre de novo.")
    await notice.getByRole("button", { name: "Atualizar" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Instalando e abrindo de novo…" })).toBeVisible()
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})

test("Agora não esconde o aviso, e em Sobre dá para desligar a procura ao abrir", async () => {
  const { app, page, dataDir } = await launchApp({ env: FAKE_UPDATE })
  let reopened: Awaited<ReturnType<typeof launchApp>> | null = null
  try {
    const notice = page.getByRole("status").filter({ hasText: "Versão 9.9.0 disponível" })
    await notice.getByRole("button", { name: "Agora não" }).click()
    await expect(notice).toBeHidden()

    // Em Configurações → Sobre, a versão encontrada continua lá, com o botão para atualizar.
    await page.getByRole("button", { name: "Configurações", exact: true }).click()
    const about = page.locator('section[aria-label="Sobre"]')
    await expect(about.getByRole("status")).toHaveText("Versão 9.9.0 disponível")
    await expect(about.getByRole("button", { name: "Atualizar" })).toBeVisible()
    const autoCheck = about.getByRole("checkbox", { name: "Procurar versão nova ao abrir o app" })
    await expect(autoCheck).toBeChecked()
    await autoCheck.click()
    await expect(autoCheck).not.toBeChecked()

    // Reaberto, o app não procura sozinho: nada de aviso, até alguém pedir.
    await app.close()
    reopened = await launchApp({ dataDir, env: FAKE_UPDATE })
    await reopened.page.waitForTimeout(1500)
    await expect(reopened.page.getByText("Versão 9.9.0 disponível")).toHaveCount(0)
    await reopened.page.getByRole("button", { name: "Configurações", exact: true }).click()
    const aboutAgain = reopened.page.locator('section[aria-label="Sobre"]')
    await expect(aboutAgain.getByRole("checkbox", { name: "Procurar versão nova ao abrir o app" })).not.toBeChecked()
    await aboutAgain.getByRole("button", { name: "Procurar atualizações" }).click()
    await expect(aboutAgain.getByRole("status")).toHaveText("Versão 9.9.0 disponível")
  } finally {
    await (reopened?.app ?? app).close()
    removeDataDir(dataDir)
  }
})

test("rodando pelo código-fonte, o Sobre avisa que a atualização automática é do app instalado", async () => {
  const { app, page, dataDir } = await launchApp()
  try {
    await page.getByRole("button", { name: "Configurações", exact: true }).click()
    await expect(page.locator('section[aria-label="Sobre"]')).toContainText(
      "Rodando pelo código-fonte: a atualização automática só vale no app instalado."
    )
    await expect(page.getByRole("button", { name: "Procurar atualizações" })).toHaveCount(0)
  } finally {
    await app.close()
    removeDataDir(dataDir)
  }
})
