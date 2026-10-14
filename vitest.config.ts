import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

// Testes rápidos da lógica (sem abrir o app): tests/unit/*.test.ts. Rodam com "npm run test:unit".
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve("src/renderer"),
      "@shared": resolve("src/shared"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // No robô de testes do GitHub (CI), o disco é mais lento: os testes que gravam bancos de verdade
    // (ex.: o conserto do banco danificado) podem passar dos 5 s normais.
    testTimeout: process.env["CI"] ? 30_000 : 5_000,
  },
})
