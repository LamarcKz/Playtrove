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
  },
})
