import { cn } from "@/lib/utils"

interface AppLogoProps {
  className?: string
}

/**
 * Logo do app, o mesmo desenho do ícone (build/icon.ico e docs/logo.svg): um baú de tesouro com a
 * fechadura de play, no quadrado com a cor principal.
 */
export function AppLogo({ className }: AppLogoProps) {
  return (
    <svg viewBox="0 0 128 128" aria-hidden="true" className={cn("size-8 shrink-0 text-primary-foreground", className)}>
      <rect width="128" height="128" rx="30" className="fill-primary" />
      <g transform="translate(22 22) scale(3.5)">
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11V9a9 5 0 0 1 18 0v2" />
          <path d="M3 11h18v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
          <path d="M6.5 5.1V20M17.5 5.1V20" />
        </g>
        <circle cx="12" cy="11" r="3.2" fill="currentColor" />
        <path d="M11 9.5v3l2.6-1.5z" className="fill-primary" />
      </g>
    </svg>
  )
}
