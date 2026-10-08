import type { Messages } from "@shared/i18n"
import type { MetadataProgress } from "@shared/types"
import type { ToastMessage } from "@/hooks/useToast"
import { listTitles } from "@/lib/format"

/** Os avisos que resumem uma leva de downloads de metadados que acabou. */
export function describeMetadataResult(progress: MetadataProgress, t: Messages): ToastMessage[] {
  const { found, notFound, errors, done } = progress
  const messages: ToastMessage[] = []
  const missing = notFound.length > 0 ? t.metadata.notFoundList(listTitles(notFound, t)) : undefined

  if (found > 0) {
    messages.push({ kind: "success", title: t.metadata.downloadedFor(found), description: missing })
  } else if (notFound.length > 0) {
    messages.push({
      title: notFound.length === 1 ? t.metadata.notFoundOne : t.metadata.notFoundMany(t.common.games(notFound.length)),
      description: t.metadata.checkNames(listTitles(notFound, t)),
    })
  }
  if (errors.length > 0) {
    messages.push({
      kind: "error",
      title: done > errors.length ? t.metadata.someFailed : t.metadata.downloadError,
      description: errors.join(" "),
    })
  }
  return messages
}
