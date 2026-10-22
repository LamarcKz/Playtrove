/** Mensagem de um erro para mostrar ao usuário: o Rust já manda a mensagem pronta, no idioma do app. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
