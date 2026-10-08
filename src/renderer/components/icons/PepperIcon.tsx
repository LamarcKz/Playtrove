import type { SVGProps } from "react"

/**
 * Pimenta, no mesmo traço dos ícones do lucide (que não tem pimenta). Marca a dificuldade dos jogos
 * (escolha do usuário em 2026-09-24). Com `fill="currentColor"`, fica cheia; o cabinho continua traço.
 */
export function PepperIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M14.5 7.5C12.8 8.1 11.7 9.6 10.5 12C9 15 7 18.5 3.5 20.5C6 20.5 9 19.7 12 18.5C17 16.5 21 10.5 19.5 6.5C18 5.8 16 6.6 14.5 7.5Z" />
      <path d="M18.3 6.1C18.1 4.5 18.8 3.2 20.5 2.5" fill="none" />
    </svg>
  )
}
