// Gera em dist/ o instalador e a versão portátil do app. Rode com `npm run dist`, que compila antes.
import { Arch, build, Platform } from "electron-builder"
import baseConfig from "../electron-builder.config.mjs"

// O electron-builder mexe na configuração que recebe: cada rodada ganha uma cópia nova.
const config = () => structuredClone(baseConfig)

// 1. O instalador (Playtrove-Setup-X.Y.Z.exe) e o latest.yml, que o app lê para saber se há versão nova.
await build({ targets: Platform.WINDOWS.createTarget("nsis", Arch.x64), config: config(), publish: "never" })

// 2. A versão portátil: o mesmo app num .zip, com o portable.txt ao lado do .exe (é ele que faz os
// dados ficarem na pasta "data", ali do lado).
const portable = config()
await build({
  targets: Platform.WINDOWS.createTarget("zip", Arch.x64),
  config: {
    ...portable,
    extraFiles: [{ from: "build/portable.txt", to: "portable.txt" }],
    win: { ...portable.win, artifactName: "${productName}-${version}-portable.${ext}" },
  },
  publish: "never",
})
