/** O formulário de bug do repositório (.github/ISSUE_TEMPLATE/bug_report.yml). */
const NEW_ISSUE_URL = "https://github.com/LamarcKz/Playtrove/issues/new"

/**
 * O endereço do formulário de bug no GitHub, com a versão do app e a do Windows já preenchidas (o
 * GitHub preenche os campos do formulário pelo id: `version` e `windows`). A pessoa ainda revê tudo
 * antes de enviar.
 */
export function bugReportUrl(info: { appVersion: string; portable: boolean; windows: string }): string {
  const url = new URL(NEW_ISSUE_URL)
  url.searchParams.set("template", "bug_report.yml")
  url.searchParams.set("version", info.portable ? `${info.appVersion} (portable)` : info.appVersion)
  url.searchParams.set("windows", info.windows)
  return url.toString()
}
