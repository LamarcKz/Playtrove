import "./styles/globals.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { createTauriApi } from "./lib/tauriApi"

// A ponte com o Rust: as funções que a interface chama em window.api.
window.api = createTauriApi()

// Ponto de entrada do React: desenha o <App /> dentro da <div id="root"> do index.html.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
