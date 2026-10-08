import { useState } from "react"
import { FolderOpen, FolderPlus, LoaderCircle, RefreshCw, Trash2 } from "lucide-react"
import { suggestFolderSetup } from "@shared/romFolders"
import type { EmulatorId, EmulatorInfo, Game, RetroArchCore, RomFolder } from "@shared/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useI18n } from "@/hooks/useI18n"
import { shortCoreName } from "@/lib/format"

interface RomFolderListProps {
  folders: RomFolder[]
  emulators: EmulatorInfo[]
  cores: RetroArchCore[]
  games: Game[]
  /** Pasta sendo varrida agora ("all" = todas), para mostrar o carregando. */
  scanning: number | "all" | null
  onAdd: (folder: Omit<RomFolder, "id">) => Promise<boolean>
  onRemove: (id: number) => void
  onScan: (id: number) => void
}

/**
 * As pastas de ROMs: cada uma diz qual emulador (e qual core, no RetroArch) abre os jogos dela e de
 * qual console eles são. No fim, o botão para adicionar uma pasta nova.
 */
export function RomFolderList({ folders, emulators, cores, games, scanning, onAdd, onRemove, onScan }: RomFolderListProps) {
  const { t } = useI18n()
  const [newFolder, setNewFolder] = useState<string | null>(null)

  async function pickFolder() {
    const path = await window.api.romFolders.pick()
    if (path) setNewFolder(path)
  }

  return (
    <div className="rounded-xl border bg-card">
      {folders.length === 0 && !newFolder && (
        <p className="px-4 py-3 text-sm text-muted-foreground">{t.romFolders.empty}</p>
      )}
      <ul aria-label={t.romFolders.title} className="divide-y">
        {folders.map((folder) => {
          const emulator = emulators.find((item) => item.id === folder.emulatorId)
          const core = cores.find((item) => item.id === folder.core)
          const count = games.filter((game) => isInside(game.romPath, folder.path)).length
          return (
            <li key={folder.id} aria-label={folder.path} className="flex items-center gap-3 px-4 py-3">
              <FolderOpen className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={folder.path}>
                  {folder.path}
                </p>
                <p className="text-xs text-muted-foreground">
                  {emulator?.name}
                  {folder.core && ` (${core ? shortCoreName(core.name) : folder.core})`} · {folder.platform} ·{" "}
                  {t.common.games(count)}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={scanning !== null}
                onClick={() => onScan(folder.id)}
                aria-label={t.romFolders.scanFolder(folder.path)}
              >
                {scanning === folder.id || scanning === "all" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                {t.romFolders.scan}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t.romFolders.removeFolder(folder.path)}
                onClick={() => onRemove(folder.id)}
                className="hover:text-destructive"
              >
                <Trash2 />
              </Button>
            </li>
          )
        })}
      </ul>

      {newFolder ? (
        <AddRomFolderForm
          path={newFolder}
          emulators={emulators}
          cores={cores}
          onCancel={() => setNewFolder(null)}
          onAdd={async (folder) => {
            if (await onAdd(folder)) setNewFolder(null)
          }}
        />
      ) : (
        <div className={folders.length > 0 ? "border-t px-4 py-3" : "px-4 pb-3"}>
          <Button variant="secondary" size="sm" onClick={() => void pickFolder()}>
            <FolderPlus />
            {t.romFolders.add}
          </Button>
        </div>
      )}
    </div>
  )
}

interface AddRomFolderFormProps {
  path: string
  emulators: EmulatorInfo[]
  cores: RetroArchCore[]
  onCancel: () => void
  onAdd: (folder: Omit<RomFolder, "id">) => void
}

/** Configuração de uma pasta nova, já preenchida com a sugestão pelo nome da pasta. */
function AddRomFolderForm({ path, emulators, cores, onCancel, onAdd }: AddRomFolderFormProps) {
  const { t } = useI18n()
  const folderName = path.split(/[\\/]/).filter(Boolean).pop() ?? path
  const [suggestion] = useState(() => suggestFolderSetup(folderName, cores))
  const [emulatorId, setEmulatorId] = useState<EmulatorId>(suggestion.emulatorId)
  const [core, setCore] = useState<string | null>(suggestion.core)
  const [platform, setPlatform] = useState(suggestion.platform)

  const needsCore = emulatorId === "retroarch"
  const canAdd = platform.trim() !== "" && (!needsCore || core !== null)

  return (
    <form
      aria-label={t.romFolders.newFolder}
      onSubmit={(event) => {
        event.preventDefault()
        if (canAdd) onAdd({ path, emulatorId, core: needsCore ? core : null, platform })
      }}
      className="space-y-3 border-t bg-secondary/40 px-4 py-4"
    >
      <p className="truncate text-sm">
        <span className="text-muted-foreground">{t.romFolders.folder} </span>
        <span className="font-medium">{path}</span>
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t.romFolders.emulator}>
          <Select value={emulatorId} onValueChange={(value) => setEmulatorId(value as EmulatorId)}>
            <SelectTrigger aria-label={t.romFolders.emulator} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {emulators.map((emulator) => (
                <SelectItem key={emulator.id} value={emulator.id}>
                  {emulator.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {needsCore && (
          <Field label={t.romFolders.core}>
            {cores.length === 0 ? (
              <p className="h-8 text-sm leading-8 text-muted-foreground">{t.romFolders.noCoresInstalled}</p>
            ) : (
              <Select value={core ?? undefined} onValueChange={setCore}>
                <SelectTrigger aria-label={t.romFolders.core} className="w-44">
                  <SelectValue placeholder={t.romFolders.chooseCore} />
                </SelectTrigger>
                <SelectContent>
                  {cores.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {shortCoreName(item.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        )}
        <Field label={t.romFolders.console}>
          <Input
            aria-label={t.romFolders.console}
            value={platform}
            maxLength={60}
            onChange={(event) => setPlatform(event.target.value)}
            className="w-52"
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button type="submit" size="sm" disabled={!canAdd}>
          {t.romFolders.addAndScan}
        </Button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // flex + gap (e não space-y): o Select do Radix põe um <select> escondido depois do botão, e o
  // space-y daria margem ao botão, desalinhando os campos.
  return (
    <div className="flex flex-col gap-1.5">
      <span className="block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

/** O arquivo está dentro da pasta (ou de uma subpasta dela)? */
function isInside(file: string | null, folder: string): boolean {
  if (!file) return false
  const prefix = folder.replace(/[\\/]+$/, "").toLowerCase()
  const path = file.toLowerCase()
  return path.startsWith(prefix) && /[\\/]/.test(path.charAt(prefix.length))
}
