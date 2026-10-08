import { RefreshCw } from "lucide-react"
import type { AchievementsConfig } from "@shared/achievements"
import { ServiceCard } from "@/components/ServiceCard"
import { Button } from "@/components/ui/button"
import { useAchievementsConfig } from "@/hooks/useAchievements"
import { useI18n } from "@/hooks/useI18n"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Configurações → Conquistas: a conta do RetroAchievements (o usuário e a Web API Key, conferidos
 * antes de salvar; a chave fica no cofre do Windows) e a situação da atualização.
 */
export function AchievementsSettings() {
  const { t } = useI18n()
  const [config, setConfig] = useAchievementsConfig()
  if (!config) return null

  const words = t.achievements
  let status = words.neverSynced
  if (config.syncing) status = words.syncing
  else if (config.lastError) status = config.lastError
  else if (config.lastSyncAt) status = words.lastSync(formatDateTime(config.lastSyncAt, t.locale))

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{words.settingsIntro}</p>
      <p className="text-sm text-muted-foreground">{words.settingsTrophies}</p>

      <ServiceCard<AchievementsConfig>
        name="RetroAchievements"
        description={words.serviceDescription}
        configured={config.username !== null}
        savedText={words.savedUser(config.username ?? "")}
        fields={[
          { id: "username", label: words.username, secret: false },
          { id: "apiKey", label: words.apiKey, secret: true },
        ]}
        steps={words.steps}
        link={{ label: words.openSite, target: "retroAchievementsSettings" }}
        onSave={(values) => window.api.achievements.setAccount({ username: values.username, apiKey: values.apiKey })}
        onRemove={() => window.api.achievements.setAccount(null)}
        onChange={setConfig}
      />

      {config.username && (
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm">
          <p className={cn("text-muted-foreground", config.lastError && !config.syncing && "text-destructive")}>{status}</p>
          <Button variant="secondary" size="sm" disabled={config.syncing} onClick={() => void window.api.achievements.sync()}>
            <RefreshCw className={cn(config.syncing && "animate-spin")} />
            {words.syncNow}
          </Button>
        </div>
      )}
    </div>
  )
}
