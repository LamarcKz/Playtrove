import { FULLSCREEN_THEMES } from "@shared/fullscreen"
import { useI18n } from "@/hooks/useI18n"
import { useFullscreenConfig } from "@/hooks/useFullscreen"

/** A escolha do tema da tela cheia, com um desenho pequeno de cada um; troca na hora, até com a tela cheia aberta. */
export function FullscreenThemePicker() {
  const { t } = useI18n()
  const { config, save, pending } = useFullscreenConfig()
  if (!config) return null
  return <div className="fs-theme-picker" role="radiogroup" aria-label={t.fullscreen.theme} aria-busy={pending}>
    {FULLSCREEN_THEMES.map((theme) => <button type="button" role="radio" key={theme} aria-checked={config.theme === theme} data-fs-default={config.theme === theme ? "" : undefined} onClick={() => void save({ theme })}>
      <span className="fs-theme-preview" data-preview={theme} aria-hidden="true"><i /><i /><i /><i /></span>
      <strong>{t.fullscreen.themeNames[theme]}</strong>
      <small>{t.fullscreen.themeDescriptions[theme]}</small>
    </button>)}
  </div>
}
