import { spawn, type ChildProcess } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { maximizeWindow } from "../../src/main/emulatorWindow"
import type { Starter } from "../../src/main/launcher"
import { makeTempDir, removeTempDirs } from "./helpers"

afterEach(() => removeTempDirs())

const POWERSHELL = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")

/**
 * Um "emulador" de teste: um PowerShell que, depois de meio segundo (como um emulador carregando o
 * jogo), mostra uma janela vazia e invisível (opacidade 0). Quando o arquivo `done` aparece, ela fecha e
 * escreve como estava: "Maximized" ou "Normal". Com `maximizeBox` false, ela não tem o botão de
 * maximizar, como a de um emulador em tela cheia.
 */
function testWindow(done: string, maximizeBox: boolean) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 500
$form = New-Object Windows.Forms.Form
$form.Text = 'Playtrove Dev (teste)'
$form.Opacity = 0
$form.MaximizeBox = $${maximizeBox}
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 100
$timer.add_Tick({
  if (Test-Path '${done.replace(/'/g, "''")}') { $global:state = [string]$form.WindowState; $form.Close() }
})
$form.add_Shown({ $timer.Start() })
[Windows.Forms.Application]::Run($form)
[Console]::Out.Write($global:state)
`
  const child = spawn(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script])
  let output = ""
  let errors = ""
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk))
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (errors += chunk))
  const closed = new Promise<string>((resolve) => child.once("exit", () => resolve(output.trim() || errors.trim())))
  return { child, closed }
}

const exited = (child: ChildProcess) => new Promise((resolve) => child.once("exit", resolve))

/** Abre a janela de teste, roda o maximizeWindow() de verdade nela e diz como ela terminou. */
async function maximizeTestWindow(maximizeBox: boolean): Promise<string> {
  const done = join(makeTempDir(), "done")
  const window = testWindow(done, maximizeBox)
  await new Promise((resolve) => window.child.once("spawn", resolve))

  const started: ChildProcess[] = []
  const start: Starter = (command, args, options) => {
    const child = spawn(command, args, options)
    started.push(child)
    return child
  }
  maximizeWindow(window.child.pid ?? 0, start)
  expect(started).toHaveLength(1)
  await exited(started[0])
  writeFileSync(done, "")
  return window.closed
}

// O PowerShell e as janelas são de verdade, mas no lugar do emulador fica a janela de teste.
describe.runIf(process.platform === "win32")("maximizar a janela de um programa (Windows de verdade)", () => {
  it("espera a janela aparecer e maximiza", async () => {
    expect(await maximizeTestWindow(true)).toBe("Maximized")
  }, 60_000)

  it("janela sem o botão de maximizar (como a de um emulador em tela cheia) fica como está", async () => {
    expect(await maximizeTestWindow(false)).toBe("Normal")
  }, 60_000)
})

it("número de processo inválido: nada é aberto", () => {
  const start = (() => {
    throw new Error("não deveria abrir nada")
  }) as Starter
  maximizeWindow(0, start)
  maximizeWindow(1.5, start)
})
