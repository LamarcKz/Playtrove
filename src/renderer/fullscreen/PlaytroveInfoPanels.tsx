import type { FullscreenNotice } from "@/hooks/useFullscreenNotices"
import { useI18n } from "@/hooks/useI18n"

/** A ajuda do tema Playtrove (o HelpMenu do Playnite): o que cada botão do controle e cada tecla faz. */
export function PlaytroveHelp({ swapConfirm }: { swapConfirm: boolean }) {
  const { t } = useI18n()
  return <div className="fs-help">
    <h2>{t.fullscreen.help}</h2>
    <dl>{t.fullscreen.helpRows(swapConfirm).map(([keys, action]) => <div key={keys}><dt>{keys}</dt><dd>{action}</dd></div>)}</dl>
  </div>
}

/** Os avisos da sessão (o NotificationsMenu do Playnite), os mais novos primeiro. */
export function PlaytroveNotices({ notices, onClear }: { notices: FullscreenNotice[]; onClear: () => void }) {
  const { t } = useI18n()
  return <div className="fs-notices">
    <div className="fs-filters-head">
      <h2>{t.fullscreen.notices}</h2>
      <button type="button" disabled={notices.length === 0} onClick={onClear}>{t.common.clear}</button>
    </div>
    {notices.length === 0 ? <p>{t.fullscreen.noNotices}</p> : <ul>{notices.map((notice) => <li key={notice.id} tabIndex={0}><strong>{notice.title}</strong>{notice.description && <span>{notice.description}</span>}</li>)}</ul>}
  </div>
}
