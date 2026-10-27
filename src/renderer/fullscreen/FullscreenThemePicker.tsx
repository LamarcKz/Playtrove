import { useState } from "react"
import { FULLSCREEN_THEMES, type FullscreenTheme } from "@shared/fullscreen"
import { useI18n } from "@/hooks/useI18n"
import { useFullscreenConfig } from "@/hooks/useFullscreen"
import { useAnikiPack } from "@/hooks/useAnikiPack"

/**
 * O tema da tela cheia, como no Playnite: Playtrove ou Aniki ReMake. Escolher o Aniki pela primeira vez
 * pede confirmação e baixa o pacote oficial do autor; até terminar, continua o tema atual.
 */
export function FullscreenThemePicker() {
  const { t } = useI18n()
  const { config, save } = useFullscreenConfig()
  const pack = useAnikiPack()
  const [confirming, setConfirming] = useState(false)
  if (!config || !pack.status) return null
  const status = pack.status
  const choose = (theme: FullscreenTheme) => {
    if (theme === "aniki" && !status.installed) setConfirming(true)
    else void save({ theme })
  }
  const percent = status.total > 0 ? Math.min(100, Math.floor((status.received * 100) / status.total)) : 0
  const megabytes = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 0 }).format(status.size / 1_000_000)
  return (
    <div className="fs-theme">
      <div className="fs-choice" role="radiogroup" aria-label={t.fullscreen.theme}><span>{t.fullscreen.theme}</span>
        {FULLSCREEN_THEMES.map((theme) => <label key={theme}><input type="radio" name="fullscreen-theme" checked={config.theme === theme} disabled={status.installing} onChange={() => choose(theme)} />{t.fullscreen.themeNames[theme]}</label>)}
      </div>
      {confirming && !status.installing && !status.installed && <div className="fs-theme-confirm" role="group" aria-label={t.fullscreen.themeNames.aniki}>
        <p>{t.fullscreen.anikiDownloadText(status.version, megabytes)}</p>
        <div className="fs-dialog-actions">
          <button type="button" data-fs-default onClick={() => { setConfirming(false); void pack.install() }}>{t.fullscreen.anikiDownload}</button>
          <button type="button" onClick={() => setConfirming(false)}>{t.common.cancel}</button>
        </div>
      </div>}
      {status.installing && <div className="fs-theme-progress">
        <progress max={100} value={percent} aria-label={t.fullscreen.anikiDownloading(percent)} />
        <span>{status.phase === "extract" ? t.fullscreen.anikiExtracting : t.fullscreen.anikiDownloading(percent)}</span>
        <button type="button" onClick={pack.cancel}>{t.fullscreen.anikiCancel}</button>
      </div>}
      {status.installed && !status.installing && <button type="button" className="fs-theme-remove" onClick={() => void pack.remove()}>{t.fullscreen.anikiRemove}</button>}
      <small>{t.fullscreen.anikiCredit}</small>
      {pack.error && <p role="alert" className="fs-error">{pack.error}</p>}
    </div>
  )
}
