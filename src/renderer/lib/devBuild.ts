import type { DevMark } from "@shared/types"

/**
 * Rodando o código em desenvolvimento, e não o app instalado: o main põe ?dev=library (npm run dev,
 * com a cópia da biblioteca) ou ?dev=tests (testes automáticos, numa pasta temporária) no endereço da
 * janela (ver createMainWindow). A barra do topo mostra a marca DEV.
 */
const mark = new URLSearchParams(window.location.search).get("dev")
export const devMark: DevMark | null = mark === "library" || mark === "tests" ? mark : null
