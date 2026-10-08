import "./styles/globals.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"

// Ponto de entrada do React: desenha o <App /> dentro da <div id="root"> do index.html.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
