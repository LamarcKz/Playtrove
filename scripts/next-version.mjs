// Diz qual deve ser a próxima versão, olhando os commits desde a última (padrão Conventional Commits):
// - algum "feat:" (novidade): sobe o número do meio (0.1.0 → 0.2.0). Só lançar com o OK do usuário;
// - só "fix:" (correções): sobe o último número (0.2.0 → 0.2.1). Pode sair sem esperar o usuário;
// - só outros tipos (docs, chore, refactor...): nada muda para quem usa o app, não precisa de versão.
// O primeiro número (1.0.0) só muda quando o usuário decidir que o app está completo.
// Também monta um rascunho das notas da versão. Uso: npm run versao
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

/**
 * Decide a próxima versão a partir da última tag (ex.: "v0.2.0") e da primeira linha de cada commit
 * feito depois dela. `next` é null quando não precisa de versão nova.
 */
export function nextVersion(lastTag, subjects) {
  const [major, minor, patch] = lastTag.replace(/^v/, "").split(".").map(Number)
  const features = []
  const fixes = []
  const others = []
  for (const subject of subjects) {
    // Ex.: "feat: adiciona o modo Kanban" → tipo "feat", texto "adiciona o modo Kanban".
    // O "!" depois do tipo ("feat!:") marca uma mudança que quebra algo; antes da 1.0.0 conta como novidade.
    const match = /^(\w+)(\([^)]*\))?(!)?:\s*(.+)$/.exec(subject)
    const type = match?.[1]
    const text = match ? match[4].charAt(0).toUpperCase() + match[4].slice(1) : subject
    if (type === "feat" || match?.[3]) features.push(text)
    else if (type === "fix") fixes.push(text)
    else others.push(subject)
  }

  let next = null
  let kind = null
  if (features.length > 0) {
    next = `${major}.${minor + 1}.0`
    kind = "novidades"
  } else if (fixes.length > 0) {
    next = `${major}.${minor}.${patch + 1}`
    kind = "correções"
  }
  return { current: `${major}.${minor}.${patch}`, next, kind, features, fixes, others }
}

/** Roda o comando: lê a última tag e os commits no Git e escreve o resultado no terminal. */
function main() {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()

  let lastTag
  try {
    lastTag = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*")
  } catch {
    console.error("Nenhuma versão lançada ainda (nenhuma tag vX.Y.Z).")
    process.exit(1)
  }
  // Primeira linha de cada commit desde a última versão, sem os de "Merge pull request".
  const subjects = git("log", `${lastTag}..HEAD`, "--no-merges", "--format=%s").split("\n").filter(Boolean)
  const result = nextVersion(lastTag, subjects)

  console.log(`Última versão: ${result.current} (tag ${lastTag})`)
  console.log(
    `Desde então: ${result.features.length} novidade(s), ${result.fixes.length} correção(ões) e ${result.others.length} outra(s) mudança(s) (texto, organização).\n`
  )

  if (result.kind === "novidades") {
    console.log(`→ Próxima versão: ${result.next}`)
    console.log("  Tem novidades: sobe o número do meio. Só lançar com o OK do usuário.\n")
  } else if (result.kind === "correções") {
    console.log(`→ Próxima versão: ${result.next}`)
    console.log("  Só correções: sobe o último número. Pode ser lançada sem esperar o usuário, depois dos testes.\n")
  } else {
    console.log(`→ Nenhuma novidade nem correção desde a ${lastTag}: não precisa de versão nova.`)
    return
  }

  console.log("Rascunho das notas (revisar e escrever para quem visita o projeto antes de publicar):\n")
  if (result.features.length > 0) console.log(["## Novidades", ...result.features.map((text) => `- ${text}`), ""].join("\n"))
  if (result.fixes.length > 0) console.log(["## Correções", ...result.fixes.map((text) => `- ${text}`), ""].join("\n"))
}

// Só roda o comando quando este arquivo é chamado direto (npm run versao), e não quando é importado nos testes.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main()
