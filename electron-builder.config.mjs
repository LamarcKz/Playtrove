// Como o app vira o instalador e a versão portátil (electron-builder). Quem usa é o scripts/dist.mjs
// (npm run dist).

/** @type {import("electron-builder").Configuration} */
export default {
  // O mesmo id do app.setAppUserModelId(), em src/main/index.ts.
  appId: "io.github.lamarckz.playtrove",
  productName: "Playtrove",
  copyright: "Copyright © 2026 LamarcKz",
  directories: { output: "dist", buildResources: "build" },
  // Só o que o app usa para rodar: o build (out/) e as dependências do processo main. Do better-sqlite3
  // vai só o binário do Windows (os dos outros sistemas e o código-fonte do SQLite ficam de fora).
  files: [
    "out/**/*",
    "!**/*.map",
    "!node_modules/better-sqlite3/{deps,src}/**",
    "!node_modules/better-sqlite3/prebuilds/{darwin-*,linux*,win32-arm64.node}",
  ],
  asarUnpack: ["**/*.node"],
  // O better-sqlite3 já vem compilado (N-API): nada de recompilar (esta máquina nem tem o Visual Studio).
  npmRebuild: false,
  // Dos arquivos de idioma do Chromium, só os dos idiomas do app (o resto só ocupa espaço).
  electronLanguages: ["en-US", "pt-BR"],
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "build/icon.ico",
  },
  // Instalador de um clique, só para o usuário (sem pedir administrador), com atalho no menu Iniciar e
  // na Área de Trabalho. Desinstalar não apaga a biblioteca.
  nsis: {
    artifactName: "${productName}-Setup-${version}.${ext}",
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    installerLanguages: ["en_US", "pt_BR"],
    multiLanguageInstaller: true,
  },
  // As versões novas vêm das releases do GitHub: o instalador leva o endereço, e o latest.yml gerado
  // aqui vai junto na release (o app lê ele para saber se há versão nova).
  publish: { provider: "github", owner: "LamarcKz", repo: "Playtrove" },
}
