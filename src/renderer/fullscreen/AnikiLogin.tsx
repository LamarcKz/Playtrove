import type { FullscreenConfig } from "@shared/fullscreen"
import { useI18n } from "@/hooks/useI18n"
import { AnikiAvatar } from "./AnikiAvatar"
import { AnikiGlyph } from "./AnikiGlyph"

/** A tela de boas-vindas do Aniki (o "login"): o perfil e o convite para continuar. */
export function AnikiLogin({ config, onContinue }: { config: FullscreenConfig; onContinue: () => void }) {
  const { t } = useI18n()
  return <div className="aniki-login" data-testid="aniki-login">
    <div className="aniki-login-card">
      <AnikiAvatar avatar={config.profileAvatar} size={180} />
      <div><small>{t.fullscreen.welcomeBack}</small><strong>{config.profileName || t.fullscreen.defaultProfileName}</strong><small>{t.fullscreen.readyToPlay}</small></div>
    </div>
    <button type="button" data-fs-default className="aniki-login-continue" onClick={onContinue}>{t.fullscreen.pressToContinue}<AnikiGlyph button="cross" /></button>
  </div>
}
