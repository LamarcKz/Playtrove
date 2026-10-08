import { useEffect, useId, useState, type ReactNode } from "react"
import { Bug } from "lucide-react"
import { isLanguage, LANGUAGES } from "@shared/i18n"
import type { Game, StatusRules } from "@shared/types"
import { AchievementsSettings } from "@/components/AchievementsSettings"
import { AppLogo } from "@/components/AppLogo"
import { MetadataSettings } from "@/components/MetadataSettings"
import { StatusSettings } from "@/components/StatusSettings"
import { UpdateSettings } from "@/components/UpdateSettings"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useI18n } from "@/hooks/useI18n"

interface SettingsPageProps {
  games: Game[]
  /** Regras automáticas de status (null enquanto a biblioteca carrega). */
  rules: StatusRules | null
}

/**
 * Tela "Configurações": Geral (o idioma), Status (as colunas do Kanban e as regras automáticas),
 * Metadados (as chaves do IGDB e do SteamGridDB), Conquistas (a conta do RetroAchievements) e Sobre.
 */
export function SettingsPage({ games, rules }: SettingsPageProps) {
  const { t } = useI18n()
  const version = useAppVersion()

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-2xl space-y-10">
        <SettingsSection title={t.settings.general}>
          <LanguageSetting />
        </SettingsSection>

        <SettingsSection title={t.settings.statuses}>
          {rules && <StatusSettings games={games} rules={rules} />}
        </SettingsSection>

        <SettingsSection title={t.settings.metadata}>
          <MetadataSettings games={games} />
        </SettingsSection>

        <SettingsSection title={t.settings.achievements}>
          <AchievementsSettings />
        </SettingsSection>

        <SettingsSection title={t.settings.about}>
          <div className="space-y-4 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-4">
              <AppLogo className="size-12" />
              <div className="flex-1">
                <p className="font-medium">Playtrove</p>
                {version && <p className="text-sm text-muted-foreground">{t.settings.version(version)}</p>}
              </div>
              <Button variant="outline" onClick={() => window.api.app.reportBug()}>
                <Bug />
                {t.settings.reportBug}
              </Button>
            </div>
            <UpdateSettings />
          </div>
        </SettingsSection>
      </div>
    </div>
  )
}

/**
 * O idioma do app (escolha do usuário em 2026-09-27: aqui, em Geral). Cada idioma aparece com o nome
 * na própria língua, e a troca vale na hora, sem reabrir o app.
 */
function LanguageSetting() {
  const { t, language, setLanguage } = useI18n()
  const labelId = useId()

  // flex + gap (e não space-y): o Select do Radix põe um <select> escondido depois do botão.
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium">
        {t.settings.language}
      </span>
      <Select value={language} onValueChange={(value) => isLanguage(value) && void setLanguage(value)}>
        <SelectTrigger aria-labelledby={labelId} className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LANGUAGES.map((option) => (
            <SelectItem key={option.id} value={option.id} lang={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{t.settings.languageHint}</p>
    </div>
  )
}

/** Uma seção das Configurações, com o título em letras pequenas. */
function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

/** Pergunta a versão do app ao processo principal (canal IPC "app:version"). */
function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    window.api.app.getVersion().then(setVersion)
  }, [])

  return version
}
