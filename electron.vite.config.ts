import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"

// Configuração dos 3 "pedaços" do app: main (Node), preload (ponte) e renderer (React).
export default defineConfig({
  main: {},
  preload: {
    build: {
      // O preload roda em sandbox: tudo o que ele usa precisa ficar dentro do próprio arquivo gerado.
      externalizeDeps: false,
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve("src/renderer"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
})
