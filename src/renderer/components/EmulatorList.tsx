import { CircleCheck, TriangleAlert } from "lucide-react"
import type { EmulatorId, EmulatorInfo, RetroArchCore } from "@shared/types"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/useI18n"

interface EmulatorListProps {
  emulators: EmulatorInfo[]
  cores: RetroArchCore[]
  onPickPath: (id: EmulatorId) => void
}

/**
 * Os emuladores que o app sabe usar: onde está o executável de cada um (encontrado sozinho ou
 * escolhido pelo usuário). No RetroArch, também os cores instalados.
 */
export function EmulatorList({ emulators, cores, onPickPath }: EmulatorListProps) {
  const { t } = useI18n()
  return (
    <ul aria-label={t.emulators.title} className="divide-y rounded-xl border bg-card">
      {emulators.map((emulator) => (
        <li key={emulator.id} aria-label={emulator.name} className="flex items-center gap-4 px-4 py-3">
          {emulator.found ? (
            <CircleCheck aria-label={t.emulators.found} className="size-5 shrink-0 text-charging" />
          ) : (
            <TriangleAlert aria-label={t.emulators.notFound} className="size-5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-medium">{emulator.name}</span>
              <span className="text-muted-foreground"> · {emulator.platforms ?? t.emulators.manyConsoles}</span>
            </p>
            <p className="truncate text-xs text-muted-foreground" title={emulator.path ?? undefined}>
              {emulator.found ? emulator.path : emulator.path ? t.emulators.missing(emulator.path) : t.emulators.notFound}
            </p>
            {emulator.id === "retroarch" && emulator.found && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {cores.length === 0
                  ? t.emulators.noCores
                  : t.emulators.cores(cores.length, cores.map((core) => core.name).join(", "))}
              </p>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={() => onPickPath(emulator.id)}>
            {emulator.found ? t.emulators.change : t.emulators.choose}
          </Button>
        </li>
      ))}
    </ul>
  )
}
