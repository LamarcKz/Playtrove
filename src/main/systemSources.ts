import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { app, shell } from "electron"
import type { DetectionSources } from "./emulators"
import { testMode } from "./testMode"

/** Os testes automáticos desligam a detecção de emuladores, para não depender do que está instalado no PC. */
export const emulatorDetectionEnabled = !testMode.skipEmulatorDetection

/**
 * Os idiomas preferidos do Windows, do principal para os outros (ex.: ["pt-BR", "en-US"]). Os testes
 * automáticos fingem o idioma do Windows (testMode.systemLanguage).
 */
export function systemLanguages(): string[] {
  return testMode.systemLanguage ? [testMode.systemLanguage] : app.getPreferredSystemLanguages()
}

/** Até quantas subpastas do menu Iniciar a detecção olha. */
const MAX_DEPTH = 3

/**
 * De onde a detecção de emuladores lê no Windows de verdade: os atalhos do menu Iniciar e da Área
 * de Trabalho (do usuário e de todos os usuários), lidos pelo Electron.
 */
export function systemDetectionSources(): DetectionSources {
  const env = process.env
  const folders = [
    env["APPDATA"] && join(env["APPDATA"], "Microsoft", "Windows", "Start Menu", "Programs"),
    env["ProgramData"] && join(env["ProgramData"], "Microsoft", "Windows", "Start Menu", "Programs"),
    env["USERPROFILE"] && join(env["USERPROFILE"], "Desktop"),
    env["PUBLIC"] && join(env["PUBLIC"], "Desktop"),
  ].filter((folder): folder is string => Boolean(folder))

  return {
    shortcuts: () => folders.flatMap((folder) => listShortcuts(folder, 0)),
    readShortcut: (path) => {
      try {
        return shell.readShortcutLink(path).target || null
      } catch {
        return null
      }
    },
    exists: existsSync,
    listDir: (path) => {
      try {
        return readdirSync(path, { withFileTypes: true }).map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
      } catch {
        return []
      }
    },
    env,
  }
}

/** Os atalhos (.lnk) de uma pasta e das subpastas dela. */
function listShortcuts(folder: string, depth: number): string[] {
  if (!existsSync(folder)) return []
  try {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) return depth < MAX_DEPTH ? listShortcuts(path, depth + 1) : []
      return entry.name.toLowerCase().endsWith(".lnk") ? [path] : []
    })
  } catch {
    return []
  }
}
