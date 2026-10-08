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
    <section aria-label={name} className="rounded-xl border bg-card">
      <div className="flex items-start gap-3 p-4">
        {configured ? (
          <CircleCheck aria-label={t.services.configured} className="mt-0.5 size-5 shrink-0 text-charging" />
        ) : (
          <CircleDashed aria-label={t.services.notConfigured} className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
          {configured && !editing && <p className="mt-1 truncate text-xs text-muted-foreground">{savedText}</p>}
        </div>
        {configured && !editing && (
          <div className="flex shrink-0 gap-1">
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
        <form aria-label={t.services.keysOf(name)} onSubmit={save} className="space-y-3 border-t px-4 py-4">
          <div className="flex flex-wrap gap-3">
            {fields.map((field) => (
              <label key={field.id} className="flex min-w-48 flex-1 flex-col gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground">{field.label}</span>
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
          <div className="flex justify-end gap-2">
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
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
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
