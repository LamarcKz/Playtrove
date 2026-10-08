import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/hooks/useI18n"

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
}

/** Campo de busca da biblioteca. Só guarda o texto: quem filtra é a página. */
export function SearchBar({ value, onChange }: SearchBarProps) {
  const { t } = useI18n()
  return (
    <div className="relative w-72">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder={t.library.searchPlaceholder}
        aria-label={t.library.searchLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pl-8"
      />
    </div>
  )
}
