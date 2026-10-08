import { defineConfig } from "@playwright/test"

// Testes do app de verdade (abrem a janela do Electron): tests/app/*.spec.ts.
// Usam o build de produção em out/, então rode "npm run build" antes (o "npm test" já faz isso).
export default defineConfig({
  testDir: "tests/app",
  timeout: 60_000,
  // O robô de testes do GitHub (CI) é mais lento que um computador comum: lá, cada conferência espera mais.
  expect: { timeout: process.env["CI"] ? 15_000 : 5_000 },
  // Um app por vez: cada teste abre a janela do Electron.
  workers: 1,
  reporter: [["list"]],
})
