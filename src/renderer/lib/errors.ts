/** Mensagem de um erro para mostrar ao usuário, sem o prefixo técnico que o Electron põe nos erros de IPC. */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
}
