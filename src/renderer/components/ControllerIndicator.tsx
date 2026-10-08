import {
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Bluetooth,
  Gamepad2,
  Usb,
  type LucideIcon,
} from "lucide-react"
import type { Messages } from "@shared/i18n"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useControllers, type ConnectedController } from "@/hooks/useControllers"
import { useI18n } from "@/hooks/useI18n"
import type { BatteryReading } from "@/lib/dualsense"
import { cn } from "@/lib/utils"

/** Até quanto a bateria é considerada fraca (fica vermelha). */
const LOW_BATTERY = 15

/**
 * Controles conectados, na barra do topo: por onde cada um está conectado (USB ou Bluetooth) e a
 * bateria. Sem controle conectado, não aparece nada.
 */
export function ControllerIndicator() {
  const controllers = useControllers()
  if (controllers.length === 0) return null

  return (
    <div className="app-no-drag flex items-center gap-1 px-2">
      {controllers.map((controller) => (
        <ControllerStatus key={controller.key} controller={controller} />
      ))}
    </div>
  )
}

/** Um controle: ícone, conexão, bateria e, no tooltip, tudo por extenso. */
function ControllerStatus({ controller }: { controller: ConnectedController }) {
  const { t } = useI18n()
  const { connection, battery } = controller
  const description = describe(controller, t)
  const ConnectionIcon = connection === "usb" ? Usb : Bluetooth
  const BatteryIcon = battery ? getBatteryIcon(battery) : null
  const charging = battery?.state === "charging"
  const low = battery?.state === "discharging" && battery.percent !== null && battery.percent <= LOW_BATTERY
  const label = battery ? batteryLabel(battery, t) : null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="img"
          tabIndex={0}
          aria-label={description}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium outline-none hover:bg-foreground/10 focus-visible:bg-foreground/10"
        >
          <Gamepad2 className="size-4" />
          <ConnectionIcon className="size-3.5 text-muted-foreground" />
          {BatteryIcon && (
            <BatteryIcon className={cn("size-4", charging && "text-charging", low && "text-destructive")} />
          )}
          {label && (
            <span className={cn("tabular-nums", charging && "text-charging", low && "text-destructive")}>{label}</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  )
}

/**
 * O que fica escrito ao lado do ícone. Enquanto carrega, "Carregando 95%"; quando a carga termina,
 * "Cheia" (sem número, porque o controle diz "completa" já em 95%); o resto é só a carga.
 */
function batteryLabel({ percent, state }: BatteryReading, t: Messages): string | null {
  if (state === "full") return t.controller.full
  if (percent === null) return null
  return state === "charging" ? t.controller.charging(percent) : `${percent}%`
}

/** Ícone de bateria que combina com a carga (ou com o carregamento). */
function getBatteryIcon({ percent, state }: BatteryReading): LucideIcon {
  if (state === "charging") return BatteryCharging
  if (state === "full") return BatteryFull
  if (percent === null) return Battery
  if (percent <= LOW_BATTERY) return BatteryWarning
  if (percent < 40) return BatteryLow
  if (percent < 70) return BatteryMedium
  return BatteryFull
}

/** Texto do tooltip, ex.: "DualSense conectado por Bluetooth · bateria em 75%". */
function describe({ name, connection, battery }: ConnectedController, t: Messages): string {
  const { controller } = t
  const connected = controller.connected(name, connection)
  if (!battery) return `${connected} · ${controller.readingBattery}`

  const status = {
    // No cabo e descarregando = o cabo só troca dados, sem alimentar o controle.
    discharging:
      connection === "usb" ? controller.batteryNotCharging(battery.percent) : controller.battery(battery.percent),
    charging: controller.chargingStatus(battery.percent),
    full: controller.fullStatus(battery.percent),
    unknown: controller.unknownBattery,
  }[battery.state]
  return `${connected} · ${status}`
}
