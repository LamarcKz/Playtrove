// Compila o plugin do Playnite (bridge/PlaytroveBridge) para out/bridge/PlaytroveBridge. O Tauri leva
// essa pasta como recurso do app, e o Playtrove copia o plugin para o Playnite do tema Aniki. Precisa
// do .NET SDK (ver "Como compilar" no README).
import { spawnSync } from "node:child_process"
import { readdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"

const output = resolve("out", "bridge", "PlaytroveBridge")
rmSync(output, { recursive: true, force: true })
const result = spawnSync(`dotnet build "${resolve("bridge", "PlaytroveBridge")}" -c Release -o "${output}" --nologo -v quiet`, {
  stdio: "inherit",
  env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" },
  shell: true,
})
if (result.status !== 0) {
  console.error("Não foi possível compilar o plugin do Playnite. O .NET SDK está instalado?")
  process.exit(result.status ?? 1)
}
// Só o plugin e a ficha dele: o SDK do Playnite quem entrega é o próprio Playnite.
const files = readdirSync(output).sort()
const expected = ["PlaytroveBridge.dll", "extension.yaml"]
if (files.join() !== expected.join()) {
  console.error(`O plugin saiu com arquivos a mais ou a menos: ${files.join(", ")}`)
  process.exit(1)
}
