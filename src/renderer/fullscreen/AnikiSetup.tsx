import { useEffect, useState, type ReactNode } from "react"
import { Check } from "lucide-react"
import { ANIKI_COLOR_PRESETS } from "@shared/anikiColors"
import { DETAILS_LAYOUTS, FULLSCREEN_EFFECTS, FULLSCREEN_INTERFACES, FULLSCREEN_TRAILERS, PROFILE_AVATARS, type FullscreenConfig } from "@shared/fullscreen"
import { useI18n } from "@/hooks/useI18n"
import { AnikiAvatar } from "./AnikiAvatar"

/** As 11 etapas do assistente inicial do Aniki, adaptadas ao Playtrove. */
export const SETUP_STEPS = ["welcome", "profile", "startup", "interface", "color", "details", "experience", "trailers", "services", "features", "summary"] as const
export type SetupDraft = Pick<FullscreenConfig, "profileName" | "profileAvatar" | "startDestination" | "loginScreen" | "interface" | "colorPreset" | "detailsLayout" | "effects" | "trailers">
/** As escolhas do assistente quando a pessoa restaura os padrões. */
export const SETUP_DEFAULTS: SetupDraft = { profileName: "", profileAvatar: "gamepad", startDestination: "hub", loginScreen: false, interface: "standard", colorPreset: "default", detailsLayout: "signature", effects: "balanced", trailers: "details" }
/** As cores que o Aniki oferece no assistente (as outras ficam nas configurações). */
const SETUP_COLORS = ["default", "orbis-blue", "scarlet-red", "hunter-green", "midnight-pink", "sapphire-prestige"] as const

interface Props {
  step: number
  draft: SetupDraft
  onDraft: (patch: Partial<SetupDraft>) => void
  onStep: (step: number) => void
  onApply: () => void
  onEditName: () => void
}

export function AnikiSetup({ step, draft, onDraft, onStep, onApply, onEditName }: Props) {
  const { t } = useI18n()
  const words = t.fullscreen.setup
  const id = SETUP_STEPS[step]
  const option = (key: string, pressed: boolean, label: string, description: string, change: () => void, first = false) =>
    <button type="button" key={key} className="aniki-setup-option" aria-pressed={pressed} data-fs-default={first ? "" : undefined} onClick={change}>
      <span><strong>{label}</strong><small>{description}</small></span>{pressed && <Check />}
    </button>
  const preview = (title: string, text: string) => <div className="aniki-setup-preview" data-aniki-color={id === "color" ? draft.colorPreset : undefined}>
    <span className="aniki-setup-preview-bar" /><strong>{title}</strong><p>{text}</p>
  </div>
  let body: ReactNode = null
  if (id === "welcome") body = <div className="aniki-setup-welcome">
    <h2>{words.welcomeTitle}</h2><p>{words.welcomeText}</p>
    <div className="aniki-setup-actions"><button type="button" data-fs-default className="aniki-setup-primary" onClick={() => onStep(1)}>{words.start}</button><button type="button" onClick={() => { onDraft(SETUP_DEFAULTS); onStep(SETUP_STEPS.length - 1) }}>{words.restore}</button></div>
    <small>{words.restoreHint}</small>
  </div>
  if (id === "profile") body = <div className="aniki-setup-columns">
    <div className="aniki-setup-profile"><AnikiAvatar avatar={draft.profileAvatar} size={160} /><button type="button" data-fs-default className="aniki-setup-name" onClick={onEditName}><small>{t.fullscreen.profileName}</small><strong>{draft.profileName || t.fullscreen.defaultProfileName}</strong></button><small>{words.nameHint}</small></div>
    <div className="aniki-setup-avatars" role="group" aria-label={t.fullscreen.avatar}>{PROFILE_AVATARS.map((avatar) => <button type="button" key={avatar} aria-label={t.fullscreen.avatars[avatar]} aria-pressed={draft.profileAvatar === avatar} onClick={() => onDraft({ profileAvatar: avatar })}><AnikiAvatar avatar={avatar} size={72} /></button>)}</div>
  </div>
  if (id === "startup") body = <div className="aniki-setup-columns">
    {preview(draft.startDestination === "hub" ? t.fullscreen.hub : t.fullscreen.library, words.startupDescriptions[draft.startDestination])}
    <div className="aniki-setup-options">
      <h3>{t.fullscreen.startIn}</h3>
      {(["hub", "library"] as const).map((value, index) => option(value, draft.startDestination === value, value === "hub" ? t.fullscreen.hub : t.fullscreen.library, words.startupDescriptions[value], () => onDraft({ startDestination: value }), index === 0))}
      <h3>{t.fullscreen.loginScreen}</h3>
      <div className="aniki-setup-pair">{[true, false].map((value) => option(String(value), draft.loginScreen === value, value ? t.fullscreen.on : t.fullscreen.off, value ? words.loginOn : words.loginOff, () => onDraft({ loginScreen: value })))}</div>
    </div>
  </div>
  if (id === "interface") body = <div className="aniki-setup-columns">
    {preview(t.fullscreen.interfaceNames[draft.interface], words.interfaceDescriptions[draft.interface])}
    <div className="aniki-setup-options">{FULLSCREEN_INTERFACES.map((value, index) => option(value, draft.interface === value, t.fullscreen.interfaceNames[value], words.interfaceDescriptions[value], () => onDraft({ interface: value }), index === 0))}</div>
  </div>
  if (id === "color") body = <div className="aniki-setup-columns">
    {preview(ANIKI_COLOR_PRESETS.find((preset) => preset.id === draft.colorPreset)?.name ?? "", words.colorText)}
    <div className="aniki-setup-options">{SETUP_COLORS.map((value, index) => option(value, draft.colorPreset === value, ANIKI_COLOR_PRESETS.find((preset) => preset.id === value)!.name, words.colorDescriptions[value], () => onDraft({ colorPreset: value }), index === 0))}<small>{words.moreColors}</small></div>
  </div>
  if (id === "details") body = <div className="aniki-setup-columns">
    {preview(t.fullscreen.detailsLayouts[draft.detailsLayout], words.detailsDescriptions[draft.detailsLayout])}
    <div className="aniki-setup-options">{DETAILS_LAYOUTS.map((value, index) => option(value, draft.detailsLayout === value, t.fullscreen.detailsLayouts[value], words.detailsDescriptions[value], () => onDraft({ detailsLayout: value }), index === 0))}</div>
  </div>
  if (id === "experience") body = <div className="aniki-setup-columns">
    {preview(t.fullscreen.effectsNames[draft.effects], words.effectsDescriptions[draft.effects])}
    <div className="aniki-setup-options">{FULLSCREEN_EFFECTS.map((value, index) => option(value, draft.effects === value, t.fullscreen.effectsNames[value] + (value === "balanced" ? ` · ${words.recommended}` : ""), words.effectsDescriptions[value], () => onDraft({ effects: value }), index === 0))}<small>{words.effectsHint}</small></div>
  </div>
  if (id === "trailers") body = <div className="aniki-setup-columns">
    {preview(t.fullscreen.trailerNames[draft.trailers], words.trailerDescriptions[draft.trailers])}
    <div className="aniki-setup-options">{FULLSCREEN_TRAILERS.map((value, index) => option(value, draft.trailers === value, t.fullscreen.trailerNames[value], words.trailerDescriptions[value], () => onDraft({ trailers: value }), index === 0))}</div>
  </div>
  if (id === "services") body = <SetupServices />
  if (id === "features") body = <div className="aniki-setup-cards">{(["controller", "hub", "trophies", "style"] as const).map((key) => <article key={key} tabIndex={0}><h3>{words.featureTitles[key]}</h3><p>{words.featureTexts[key]}</p></article>)}</div>
  if (id === "summary") body = <div className="aniki-setup-columns">
    <div className="aniki-setup-welcome"><h2>{words.doneTitle}</h2><p>{words.doneText}</p></div>
    <dl className="aniki-setup-summary">
      {([
        [words.summary.profile, draft.profileName || t.fullscreen.defaultProfileName],
        [words.summary.startup, draft.startDestination === "hub" ? t.fullscreen.hub : t.fullscreen.library],
        [t.fullscreen.loginScreen, draft.loginScreen ? t.fullscreen.on : t.fullscreen.off],
        [words.summary.interface, t.fullscreen.interfaceNames[draft.interface]],
        [words.summary.color, ANIKI_COLOR_PRESETS.find((preset) => preset.id === draft.colorPreset)?.name ?? ""],
        [words.summary.details, t.fullscreen.detailsLayouts[draft.detailsLayout]],
        [words.summary.experience, t.fullscreen.effectsNames[draft.effects]],
        [t.fullscreen.trailers, t.fullscreen.trailerNames[draft.trailers]],
      ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  </div>
  const last = step === SETUP_STEPS.length - 1
  return <div className="aniki-setup" data-testid="aniki-setup">
    <header className="aniki-setup-header"><span>{words.title}</span><progress max={SETUP_STEPS.length} value={step + 1} /><span>{words.step(step + 1, SETUP_STEPS.length)}</span></header>
    {id !== "welcome" && id !== "summary" && <div className="aniki-setup-heading"><h2>{words.titles[id]}</h2><p>{words.subtitles[id]}</p></div>}
    <div className="aniki-setup-body">{body}</div>
    {id !== "welcome" && <footer className="aniki-setup-footer">
      <button type="button" onClick={() => onStep(step - 1)}>{words.back}</button>
      <button type="button" className="aniki-setup-primary" data-fs-default={id === "services" || id === "features" || last ? "" : undefined} onClick={() => last ? onApply() : onStep(step + 1)}>{last ? words.apply : words.next}</button>
    </footer>}
  </div>
}

/** A etapa das integrações: no Aniki, os addons; no Playtrove, os serviços que o próprio app usa. */
function SetupServices() {
  const { t } = useI18n()
  const words = t.fullscreen.setup
  const [state, setState] = useState<{ igdb: boolean; steamGridDb: boolean; retroAchievements: boolean } | null>(null)
  useEffect(() => {
    let live = true
    void Promise.all([window.api.metadata.getConfig(), window.api.achievements.getConfig()]).then(([metadata, achievements]) => {
      if (live) setState({ igdb: metadata.igdb, steamGridDb: metadata.steamGridDb, retroAchievements: achievements.username !== null })
    }).catch(() => {})
    return () => { live = false }
  }, [])
  return <div className="aniki-setup-cards">
    {(["igdb", "steamGridDb", "retroAchievements"] as const).map((key) => <article key={key} tabIndex={0}>
      <h3>{words.serviceNames[key]}</h3><p>{words.serviceTexts[key]}</p>
      <strong className="aniki-setup-status">{state === null ? t.common.loading : state[key] ? words.configured : words.notConfigured}</strong>
    </article>)}
    <p className="aniki-setup-note">{words.servicesHint}</p>
  </div>
}
