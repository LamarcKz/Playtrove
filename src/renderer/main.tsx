import "./styles/globals.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { createTauriApi, isTauri } from "./lib/tauriApi"

// No Tauri não há preload: a ponte com o Rust entra aqui, no mesmo formato do Electron (window.api).
if (isTauri()) window.api = createTauriApi()

// Ponto de entrada do React: desenha o <App /> dentro da <div id="root"> do index.html.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
