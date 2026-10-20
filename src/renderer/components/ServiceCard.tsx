import { useState, type FormEvent } from "react"
import { CircleCheck, CircleDashed, ExternalLink, LoaderCircle } from "lucide-react"
import type { ExternalLink as LinkTarget } from "@shared/ipc"
import { RichText } from "@/components/RichText"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/hooks/useI18n"
import { errorMessage } from "@/lib/errors"

export interface KeyField {
  id: string
  label: string
  /** Chave secreta: o campo esconde o que é digitado. */
  secret: boolean
}

interface ServiceCardProps<T> {
  name: string
  description: string
  configured: boolean
  /** O que está salvo, para o usuário conferir (as chaves secretas nunca voltam para a tela). */
  savedText: string
  fields: KeyField[]
  /** O passo a passo para conseguir as chaves (o que está entre ** aparece em negrito). */
  steps: string[]
  link: { label: string; target: LinkTarget }
  /** Confere e salva (o main faz um pedido de teste antes). Rejeita com a mensagem se estiver errado. */
  onSave: (values: Record<string, string>) => Promise<T>
  onRemove: () => Promise<T>
  onChange: (config: T) => void
}

/** Um serviço com chave (metadados, conquistas): se está configurado, os campos e como conseguir a chave. */
export function ServiceCard<T>({
  name,
  description,
  configured,
  savedText,
  fields,
  steps,
  link,
  onSave,
  onRemove,
  onChange,
}: ServiceCardProps<T>) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(!configured)
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const complete = fields.every((field) => values[field.id]?.trim())

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      onChange(await onSave(values))
      setValues({})
      setError(null)
      setEditing(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    onChange(await onRemove())
    setEditing(true)
  }

  function cancel() {
    setValues({})
    setError(null)
    setEditing(false)
  }

  return (
    <section aria-label={name} className="@container/service min-w-0 rounded-xl border bg-card">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-4 @[28rem]/service:grid-cols-[auto_minmax(0,1fr)_auto]">
        {configured ? (
          <CircleCheck aria-label={t.services.configured} className="mt-0.5 size-5 shrink-0 text-charging" />
        ) : (
          <CircleDashed aria-label={t.services.notConfigured} className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium [overflow-wrap:anywhere]">{name}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
          {configured && !editing && <p className="mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{savedText}</p>}
        </div>
        {configured && !editing && (
          <div className="col-start-2 flex flex-wrap gap-2 @[28rem]/service:col-start-3 @[28rem]/service:row-start-1">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {t.common.change}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void remove()} className="hover:text-destructive">
              {t.common.remove}
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <form aria-label={t.services.keysOf(name)} onSubmit={save} className="flex min-w-0 flex-col gap-4 border-t p-4">
          <div className="flex flex-wrap gap-3">
            {fields.map((field) => (
              <label key={field.id} className="flex min-w-0 flex-1 basis-48 flex-col gap-2">
                <span className="text-sm font-medium">{field.label}</span>
                <Input
                  aria-label={field.label}
                  type={field.secret ? "password" : "text"}
                  autoComplete="off"
                  spellCheck={false}
                  value={values[field.id] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                />
              </label>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {configured && (
              <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                {t.common.cancel}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={saving || !complete}>
              {saving && <LoaderCircle className="animate-spin" />}
              {saving ? t.services.checking : t.common.save}
            </Button>
          </div>
          <details className="rounded-lg bg-secondary/40 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">
              {fields.length > 1 ? t.services.howToGetKeys : t.services.howToGetKey}
            </summary>
            <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 leading-relaxed text-muted-foreground [overflow-wrap:anywhere] [&_strong]:font-medium [&_strong]:text-foreground">
              {steps.map((step, index) => (
                <li key={index}>
                  <RichText text={step} />
                </li>
              ))}
            </ol>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3 mb-1"
              onClick={() => window.api.app.openLink(link.target)}
            >
              <ExternalLink />
              {link.label}
            </Button>
          </details>
        </form>
      )}
    </section>
  )
}
