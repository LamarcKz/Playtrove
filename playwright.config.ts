import { defineConfig } from "@playwright/test"

// Testes do app de verdade (abrem a janela do app, a versão DEV): tests/app/*.spec.ts.
// Usam o app dos testes, compilado pelo "npm run test:app" (scripts/build-test-app.mjs) antes do Playwright.
export default defineConfig({
  testDir: "tests/app",
  timeout: 60_000,
  // O robô de testes do GitHub (CI) é mais lento que um computador comum: lá, cada conferência espera mais.
  expect: { timeout: process.env["CI"] ? 15_000 : 5_000 },
  // Um app por vez: cada teste abre a janela do app.
  workers: 1,
  reporter: [["list"]],
})
