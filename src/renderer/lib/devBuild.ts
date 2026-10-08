/**
 * Rodando pelo npm run dev, com a cópia da biblioteca: o main põe ?dev=1 no endereço da janela (ver
 * createMainWindow). A barra do topo mostra a marca DEV, para não confundir com o app instalado.
 */
export const isDevBuild = new URLSearchParams(window.location.search).get("dev") === "1"
