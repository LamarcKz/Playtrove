import { useI18n } from "@/hooks/useI18n"

export function AnikiHelp() {
  const { t } = useI18n()
  return <div className="fs-help"><h2>{t.fullscreen.help}</h2><dl>{t.fullscreen.anikiHelpRows.map(([keys, action]) => <div key={keys}><dt>{keys}</dt><dd>{action}</dd></div>)}</dl></div>
}
