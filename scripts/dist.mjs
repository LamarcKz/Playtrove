// Gera em dist/ o que vai numa release: o instalador, a versão portátil e os dois arquivos que dizem qual
// é a versão nova. Rode com `npm run dist`.
//
// - Playtrove-Setup-X.Y.Z.exe: o instalador (o do Tauri, só para o usuário, sem pedir administrador).
// - Playtrove-X.Y.Z-portable.zip: o Playtrove.exe com o portable.txt ao lado (os dados ficam na pasta
//   "data", ali do lado).
// - latest.json: o que o app em Tauri lê para se atualizar, com a assinatura do instalador.
// - latest.yml: o que o app em Electron (até a 0.7.x) lê. Ele aponta para o instalador novo, e é assim
//   que quem tem o app antigo passa para o novo pelo próprio aviso de atualização.
//
// A assinatura usa a chave do projeto, que fica fora do repositório: a variável
// TAURI_SIGNING_PRIVATE_KEY ou, sem ela, o arquivo .tauri/playtrove.key na pasta do usuário.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { releaseBuildEnv } from "./release-build-env.mjs"

const REPOSITORY = "https://github.com/LamarcKz/Playtrove"
const { version } = JSON.parse(readFileSync("package.json", "utf8"))
const bundleFolder = join("src-tauri", "target", "release", "bundle", "nsis")
const builtInstaller = join(bundleFolder, `Playtrove_${version}_x64-setup.exe`)
const installerName = `Playtrove-Setup-${version}.exe`
const portableName = `Playtrove-${version}-portable.zip`
const output = "dist"

/** Roda um programa e para tudo se ele falhar. O `npx` só roda pelo terminal (é um .cmd no Windows). */
function run(command, args, env = {}) {
  const viaShell = command === "npx"
  const result = viaShell
    ? spawnSync([command, ...args].join(" "), { stdio: "inherit", shell: true, env: { ...process.env, ...env } })
    : spawnSync(command, args, { stdio: "inherit", env: { ...process.env, ...env } })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// 1. O build de release e o instalador, assinado para a atualização (o .sig ao lado dele).
const signingKey = process.env.TAURI_SIGNING_PRIVATE_KEY ?? join(homedir(), ".tauri", "playtrove.key")
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !existsSync(signingKey)) {
  console.error("Falta a chave que assina as versões (.tauri/playtrove.key na pasta do usuário).")
  process.exit(1)
}
run("npx", ["tauri", "build"], {
  ...releaseBuildEnv(process.env, homedir(), process.cwd()),
  TAURI_SIGNING_PRIVATE_KEY: signingKey,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
})

mkdirSync(output, { recursive: true })
const installer = join(output, installerName)
copyFileSync(builtInstaller, installer)
const signature = readFileSync(`${builtInstaller}.sig`, "utf8").trim()

// 2. A versão portátil: o mesmo .exe, num .zip com o portable.txt (pelo tar do Windows, que faz .zip).
const portableFolder = join(output, "portable")
rmSync(portableFolder, { recursive: true, force: true })
mkdirSync(portableFolder)
copyFileSync(join("src-tauri", "target", "release", "Playtrove.exe"), join(portableFolder, "Playtrove.exe"))
copyFileSync(join("build", "portable.txt"), join(portableFolder, "portable.txt"))
// O plugin do Playnite (tema Aniki) vai ao lado do .exe, como os recursos do instalador.
cpSync(join("out", "bridge", "PlaytroveBridge"), join(portableFolder, "bridge", "PlaytroveBridge"), { recursive: true })
const portable = join(output, portableName)
rmSync(portable, { force: true })
const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
run(tar, ["-a", "-cf", portable, "-C", portableFolder, "Playtrove.exe", "portable.txt", "bridge"])
rmSync(portableFolder, { recursive: true, force: true })

// 3. O latest.json, que o app em Tauri lê na última release.
const releaseDate = new Date().toISOString()
const latestJson = {
  version,
  pub_date: releaseDate,
  platforms: {
    "windows-x86_64": { signature, url: `${REPOSITORY}/releases/download/v${version}/${installerName}` },
  },
}
writeFileSync(join(output, "latest.json"), JSON.stringify(latestJson, null, 2) + "\n")

// 4. O latest.yml, no formato do electron-updater: o app em Electron confere o sha512 antes de instalar.
const sha512 = createHash("sha512").update(readFileSync(installer)).digest("base64")
const size = statSync(installer).size
const latestYml = [
  `version: ${version}`,
  "files:",
  `  - url: ${installerName}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${installerName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  "",
].join("\n")
writeFileSync(join(output, "latest.yml"), latestYml)

console.log(`\nPronto em dist/: ${installerName}, ${portableName}, latest.json e latest.yml.`)
