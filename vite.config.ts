import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// A interface (React) para a versão em Tauri: a mesma do Electron (src/renderer), servida pelo Vite no
// "npm run dev:tauri" e gerada em out/web no build. O Tauri abre o endereço fixo 1420 (tauri.conf.json).
export default defineConfig({
  root: resolve("src/renderer"),
  base: "./",
  resolve: {
    alias: {
      "@": resolve("src/renderer"),
      "@shared": resolve("src/shared"),
    },
  },
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // O Rust recompila sozinho (pelo Tauri); o Vite não precisa olhar a pasta dele.
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    outDir: resolve("out/web"),
    emptyOutDir: true,
  },
})
