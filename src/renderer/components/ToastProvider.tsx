import { useCallback, useRef, useState, type ReactNode } from "react"
import { CircleCheck, Info, TriangleAlert, X } from "lucide-react"
import { useI18n } from "@/hooks/useI18n"
import { ToastContext, type ToastMessage } from "@/hooks/useToast"
import { cn } from "@/lib/utils"

/** Quanto tempo cada aviso fica na tela. */
const TOAST_DURATION_MS = 6000
/** Quantos avisos aparecem ao mesmo tempo; os mais antigos saem antes da hora. */
const MAX_TOASTS = 3

const ICONS = { info: Info, success: CircleCheck, error: TriangleAlert }

/**
 * Mostra os avisos rápidos (useToast) empilhados no canto de baixo, à direita. Somem sozinhos. O
 * `pinned` fica no alto da pilha enquanto quiser (o aviso de versão nova).
 */
export function ToastProvider({ children, pinned }: { children: ReactNode; pinned?: ReactNode }) {
  const { t } = useI18n()
  const [toasts, setToasts] = useState<(ToastMessage & { id: number })[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])

  const show = useCallback(
    (toast: ToastMessage) => {
      const id = nextId.current++
      setToasts((current) => [...current, { ...toast, id }].slice(-MAX_TOASTS))
      setTimeout(() => dismiss(id), TOAST_DURATION_MS)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 flex-col gap-2">
        {pinned}
        {toasts.map((toast) => {
          const kind = toast.kind ?? "info"
          const Icon = ICONS[kind]
          return (
            <div
              key={toast.id}
              role={kind === "error" ? "alert" : "status"}
              className="pointer-events-auto flex animate-in gap-3 rounded-xl border bg-popover p-3.5 text-popover-foreground shadow-xl shadow-black/30 duration-200 fade-in-0 slide-in-from-bottom-4"
            >
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  kind === "error" && "text-destructive",
                  kind === "success" && "text-charging",
                  kind === "info" && "text-muted-foreground"
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{toast.title}</p>
                {toast.description && <p className="mt-0.5 text-xs break-words text-muted-foreground">{toast.description}</p>}
              </div>
              <button
                type="button"
                aria-label={t.toast.close}
                onClick={() => dismiss(toast.id)}
                className="-m-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
