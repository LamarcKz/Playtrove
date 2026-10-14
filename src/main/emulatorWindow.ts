import { spawn } from "node:child_process"
import { join } from "node:path"
import type { Starter } from "./launcher"

/** De quanto em quanto tempo o script procura a janela, e por quanto tempo no máximo. */
const POLL_MS = 200
const TIMEOUT_MS = 10_000

// Números do Windows: o comando "maximizar" do ShowWindow e, no GetWindowLong, o estilo da janela e o
// pedaço dele que diz se ela tem o botão de maximizar.
const SW_MAXIMIZE = 3
const GWL_STYLE = -16
const WS_MAXIMIZEBOX = 0x10000

/**
 * O script do PowerShell: espera a janela principal do processo `pid` aparecer (procura a cada POLL_MS,
 * por até TIMEOUT_MS) e maximiza ela com o ShowWindow da user32.dll. A janela principal é a visível que
 * não pertence a outra janela (o MainWindowHandle do .NET). Só mexe numa janela que tem o botão de
 * maximizar: um emulador em tela cheia fica como está. Se o processo fechar antes, desiste.
 */
export function maximizeScript(pid: number): string {
  return `
Add-Type -Namespace Playtrove -Name User32 -MemberDefinition '
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
'
$clock = [Diagnostics.Stopwatch]::StartNew()
while ($clock.ElapsedMilliseconds -lt ${TIMEOUT_MS}) {
  $process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
  if (-not $process) { exit }
  $window = $process.MainWindowHandle
  if ($window -ne [IntPtr]::Zero) {
    if ([Playtrove.User32]::GetWindowLong($window, ${GWL_STYLE}) -band ${WS_MAXIMIZEBOX}) {
      [void][Playtrove.User32]::ShowWindow($window, ${SW_MAXIMIZE})
    }
    exit
  }
  Start-Sleep -Milliseconds ${POLL_MS}
}
`.trim()
}

/** O PowerShell do Windows, pelo caminho completo (e não um powershell.exe qualquer do PATH). */
function powershellPath(): string {
  return join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}

/**
 * Maximiza a janela de um programa que acabou de abrir (ex.: o RetroArch) assim que ela aparecer.
 * Quem procura e maximiza é um PowerShell escondido, que termina sozinho; o app não espera por ele.
 */
export function maximizeWindow(pid: number, start: Starter = spawn): void {
  if (!Number.isInteger(pid) || pid <= 0) return
  const args = ["-NoProfile", "-NonInteractive", "-Command", maximizeScript(pid)]
  const child = start(powershellPath(), args, { stdio: "ignore", windowsHide: true })
  // Sem o PowerShell, a janela só fica do tamanho que o emulador escolheu: nada de erro na tela.
  child.once("error", () => undefined)
  child.unref()
}
