// Compila o app dos testes (tests/app): o build de desenvolvimento do Tauri com a interface embutida, numa
// pasta à parte (src-tauri/target/testes), para não atrapalhar o do npm run dev:tauri. Quem roda é o
// npm run test:app, antes do Playwright.
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const result = spawnSync("npx tauri build --debug --no-bundle", {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, CARGO_TARGET_DIR: resolve("src-tauri", "target", "testes") },
})
process.exit(result.status ?? 1)
