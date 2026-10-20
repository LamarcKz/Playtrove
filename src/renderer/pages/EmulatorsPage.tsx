import { useState, type ReactNode } from "react"
import { LoaderCircle, RefreshCw } from "lucide-react"
import type { Messages } from "@shared/i18n"
import type { Game, RomFolder, ScanResult } from "@shared/types"
import { EmulatorList } from "@/components/EmulatorList"
import { ContentPage } from "@/components/ContentPage"
import { RomFolderList } from "@/components/RomFolderList"
import { Button } from "@/components/ui/button"
import { useEmulators } from "@/hooks/useEmulators"
import { useI18n } from "@/hooks/useI18n"
import { useToast, type ToastMessage } from "@/hooks/useToast"
import { errorMessage } from "@/lib/errors"
import { listTitles } from "@/lib/format"

interface EmulatorsPageProps {
  /** Os jogos da biblioteca, para contar quantos vieram de cada pasta. */
  games: Game[]
}

/**
 * Tela "Emuladores": onde está cada emulador (o app procura sozinho) e as pastas de ROMs. Procurar
 * jogos numa pasta coloca na biblioteca os arquivos que ainda não estão nela.
 */
export function EmulatorsPage({ games }: EmulatorsPageProps) {
  const { t } = useI18n()
  const { emulators, cores, folders, detect, pickPath, addFolder, removeFolder, scan } = useEmulators()
  const [detecting, setDetecting] = useState(false)
  const [scanning, setScanning] = useState<number | "all" | null>(null)
  const toast = useToast()

  async function runScan(id?: number) {
    setScanning(id ?? "all")
    try {
      for (const message of describeScan(await scan(id), t)) toast(message)
    } catch (error) {
      toast({ kind: "error", title: t.romFolders.scanError, description: errorMessage(error) })
    } finally {
      setScanning(null)
    }
  }

  async function handleAdd(folder: Omit<RomFolder, "id">): Promise<boolean> {
    try {
      const created = await addFolder(folder)
      await runScan(created.id)
      return true
    } catch (error) {
      toast({ kind: "error", title: t.romFolders.addError, description: errorMessage(error) })
      return false
    }
  }

  async function handleDetect() {
    setDetecting(true)
    try {
      await detect()
    } finally {
      setDetecting(false)
    }
  }

  if (!emulators) return null

  return (
    <ContentPage>
      <div className="grid items-start gap-6 @[70rem]/content:grid-cols-2">
        <PageSection
          title={t.emulators.title}
          description={t.emulators.description}
          action={
            <Button variant="ghost" size="sm" disabled={detecting} onClick={() => void handleDetect()}>
              {detecting ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              {t.emulators.detectAgain}
            </Button>
          }
        >
          <EmulatorList emulators={emulators} cores={cores} onPickPath={(id) => void pickPath(id)} />
        </PageSection>

        <PageSection
          title={t.romFolders.title}
          description={t.romFolders.description}
          action={
            folders.length > 0 && (
              <Button variant="ghost" size="sm" disabled={scanning !== null} onClick={() => void runScan()}>
                {scanning === "all" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                {t.romFolders.scanAll}
              </Button>
            )
          }
        >
          <RomFolderList
            folders={folders}
            emulators={emulators}
            cores={cores}
            games={games}
            scanning={scanning}
            onAdd={handleAdd}
            onRemove={(id) => void removeFolder(id)}
            onScan={(id) => void runScan(id)}
          />
        </PageSection>
      </div>
    </ContentPage>
  )
}

interface PageSectionProps {
  title: string
  description: string
  /** Botão opcional na direita do título. */
  action?: ReactNode
  children: ReactNode
}

/** Uma seção da tela, com título e ação que se acomodam à largura disponível. */
function PageSection({ title, description, action, children }: PageSectionProps) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-4">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      {children}
    </section>
  )
}

/** Os avisos que resumem uma procura de jogos: o que entrou e os problemas. */
function describeScan(result: ScanResult, t: Messages): ToastMessage[] {
  const messages: ToastMessage[] = []
  const { added, alreadyInLibrary, errors } = result

  if (added.length > 0) {
    messages.push({
      kind: "success",
      title: t.romFolders.newGames(added.length),
      description: `${listTitles(added, t)}.`,
    })
  } else if (alreadyInLibrary > 0) {
    messages.push({ title: t.romFolders.noNewGames, description: t.romFolders.alreadyInLibrary(alreadyInLibrary) })
  } else if (errors.length === 0) {
    messages.push({ title: t.romFolders.nothingFound, description: t.romFolders.nothingFoundHint })
  }

  if (errors.length > 0) {
    messages.push({ kind: "error", title: t.romFolders.someFailed, description: errors.join(" ") })
  }
  return messages
}
