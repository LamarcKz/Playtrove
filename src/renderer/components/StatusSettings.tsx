import { useState, type FormEvent } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import type { Game, Status, StatusRules } from "@shared/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useI18n } from "@/hooks/useI18n"
import { useStatuses } from "@/hooks/useStatuses"
import { errorMessage } from "@/lib/errors"

interface StatusSettingsProps {
  games: Game[]
  rules: StatusRules
}

/**
 * Configurações → Status: os status da biblioteca (as colunas do Kanban, nesta ordem) e as duas
 * regras automáticas. Dá para renomear, mudar a ordem, criar e apagar. Os status não têm cor.
 */
export function StatusSettings({ games, rules }: StatusSettingsProps) {
  const { t } = useI18n()
  const statuses = useStatuses()
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  /** Roda uma ação no banco e mostra o erro, se der errado. Devolve se deu certo. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action()
      setError(null)
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    }
  }

  function move(index: number, offset: number) {
    const ids = statuses.map((status) => status.id)
    const [id] = ids.splice(index, 1)
    ids.splice(index + offset, 0, id)
    void run(() => window.api.statuses.reorder(ids))
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card">
        <p className="border-b px-4 py-3 text-sm text-muted-foreground">{t.statuses.intro}</p>
        <ul aria-label={t.statuses.list} className="divide-y">
          {statuses.map((status, index) => (
            <li key={status.id} className="px-4 py-2">
              <StatusRow
                status={status}
                gameCount={games.filter((game) => game.statusId === status.id).length}
                isFirst={index === 0}
                isLast={index === statuses.length - 1}
                canDelete={statuses.length > 1}
                onRename={(name) => run(() => window.api.statuses.rename(status.id, name))}
                onMoveUp={() => move(index, -1)}
                onMoveDown={() => move(index, 1)}
                onDelete={() => setDeletingId(status.id)}
              />
              {deletingId === status.id && (
                <DeleteStatus
                  status={status}
                  others={statuses.filter((other) => other.id !== status.id)}
                  gameCount={games.filter((game) => game.statusId === status.id).length}
                  onConfirm={async (moveToId) => {
                    if (await run(() => window.api.statuses.remove(status.id, moveToId))) setDeletingId(null)
                  }}
                  onCancel={() => setDeletingId(null)}
                />
              )}
            </li>
          ))}
        </ul>
        <NewStatus onCreate={(name) => run(() => window.api.statuses.create(name))} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-medium">{t.statuses.rules}</h3>
        <RuleSelect
          label={t.statuses.newGameRule}
          value={rules.newGameStatusId}
          statuses={statuses}
          onChange={(id) => run(() => window.api.statuses.setRules({ ...rules, newGameStatusId: id }))}
        />
        <RuleSelect
          label={t.statuses.firstPlayRule}
          value={rules.firstPlayStatusId}
          statuses={statuses}
          onChange={(id) => run(() => window.api.statuses.setRules({ ...rules, firstPlayStatusId: id }))}
        />
      </div>
    </div>
  )
}

interface StatusRowProps {
  status: Status
  gameCount: number
  isFirst: boolean
  isLast: boolean
  canDelete: boolean
  onRename: (name: string) => Promise<boolean>
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}

/** Uma linha: o nome (editável), quantos jogos tem e os botões de subir, descer e apagar. */
function StatusRow({ status, gameCount, isFirst, isLast, canDelete, onRename, onMoveUp, onMoveDown, onDelete }: StatusRowProps) {
  const { t } = useI18n()
  const [name, setName] = useState(status.name)
  const [lastSaved, setLastSaved] = useState(status.name)

  // O nome mudou no banco (ex.: salvo agora): acompanha, sem apagar o que está sendo digitado.
  if (status.name !== lastSaved) {
    setLastSaved(status.name)
    setName(status.name)
  }

  async function save() {
    if (name.trim() === status.name) return setName(status.name)
    if (!(await onRename(name))) setName(status.name)
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={t.statuses.nameOf(status.name)}
        value={name}
        maxLength={40}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
          if (event.key === "Escape") {
            setName(status.name)
            event.currentTarget.blur()
          }
        }}
        className="h-8 max-w-72 flex-1"
      />
      <span className="w-20 text-xs text-muted-foreground tabular-nums">
        {t.common.games(gameCount)}
      </span>
      <div className="ml-auto flex gap-0.5">
        <Button variant="ghost" size="icon-sm" aria-label={t.statuses.moveUp(status.name)} disabled={isFirst} onClick={onMoveUp}>
          <ArrowUp />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t.statuses.moveDown(status.name)} disabled={isLast} onClick={onMoveDown}>
          <ArrowDown />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t.statuses.deleteOf(status.name)}
          disabled={!canDelete}
          onClick={onDelete}
          className="hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}

interface DeleteStatusProps {
  status: Status
  others: Status[]
  gameCount: number
  onConfirm: (moveToId: number) => void
  onCancel: () => void
}

/** Confirmação para apagar um status, escolhendo para onde vão os jogos dele. */
function DeleteStatus({ status, others, gameCount, onConfirm, onCancel }: DeleteStatusProps) {
  const { t } = useI18n()
  const [moveToId, setMoveToId] = useState(others[0].id)

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm">
      <span>{t.statuses.confirmDelete(status.name)}</span>
      {gameCount > 0 && (
        <>
          <span className="text-muted-foreground">{t.statuses.moveGames(gameCount)}</span>
          <Select value={String(moveToId)} onValueChange={(value) => setMoveToId(Number(value))}>
            <SelectTrigger size="sm" aria-label={t.statuses.receiver}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {others.map((other) => (
                <SelectItem key={other.id} value={String(other.id)}>
                  {other.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
      <div className="ml-auto flex gap-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onConfirm(moveToId)}>
          {t.common.delete}
        </Button>
      </div>
    </div>
  )
}

/** Campo para criar um status novo (vai para o fim da lista). */
function NewStatus({ onCreate }: { onCreate: (name: string) => Promise<boolean> }) {
  const { t } = useI18n()
  const [name, setName] = useState("")

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (name.trim() && (await onCreate(name))) setName("")
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex gap-2 border-t px-4 py-3">
      <Input
        aria-label={t.statuses.newName}
        placeholder={t.statuses.newPlaceholder}
        value={name}
        maxLength={40}
        onChange={(event) => setName(event.target.value)}
        className="h-8 max-w-72 flex-1"
      />
      <Button type="submit" variant="secondary" size="sm" disabled={!name.trim()} className="h-8">
        <Plus />
        {t.common.add}
      </Button>
    </form>
  )
}

interface RuleSelectProps {
  label: string
  value: number
  statuses: Status[]
  onChange: (statusId: number) => void
}

/** Uma regra automática: o texto e o status escolhido. */
function RuleSelect({ label, value, statuses, onChange }: RuleSelectProps) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
        <SelectTrigger aria-label={label} className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statuses.map((status) => (
            <SelectItem key={status.id} value={String(status.id)}>
              {status.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
