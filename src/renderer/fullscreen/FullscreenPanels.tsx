import { ArrowLeft, Download, FolderOpen, Gamepad2, Star } from "lucide-react"
import { FullscreenPreferences } from "./FullscreenPreferences"
import { FullscreenKeyboard } from "./FullscreenKeyboard"
import { FullscreenAchievements } from "./FullscreenAchievements"
import { FullscreenThemePicker } from "./FullscreenThemePicker"
import { FullscreenTrophyOverview } from "./FullscreenTrophyOverview"
import { PlaytroveMenu, PowerConfirm } from "./PlaytroveMenu"
import { PlaytroveFilters } from "./PlaytroveFilters"
import { PlaytroveHelp, PlaytroveNotices } from "./PlaytroveInfoPanels"
import type { FullscreenSession } from "./useFullscreenSession"

/**
 * Os painéis da tela cheia (menu, busca, filtros, avisos, ajuda, configurações, tema, troféus e as opções do jogo),
 * o aviso no canto e a tela de jogo em execução. São os mesmos nos quatro temas; o CSS de cada tema dá o estilo.
 */
export function FullscreenPanels({ session }: { session: FullscreenSession }) {
  const { t, panel, game, statuses, editing, mutate, error, notices, config, busy, launching } = session
  return <>
    {panel && <div className="fs-modal-shade"><section ref={session.scope} role="dialog" aria-modal="true" aria-label={{ preferences: t.fullscreen.preferences, search: t.fullscreen.search, review: t.fullscreen.review, achievements: t.fields.achievements, trophies: t.fields.achievements, options: t.fullscreen.options, menu: t.fullscreen.mainMenu, theme: t.fullscreen.theme, power: session.powerAction ? t.fullscreen.powerActions[session.powerAction] : t.fullscreen.power, filters: t.filters.title, help: t.fullscreen.help, notices: t.fullscreen.notices }[panel]} className={`fs-modal fs-modal-${panel}`}>
      {panel === "search" ? <FullscreenKeyboard title={t.fullscreen.search} initial={session.query} onCancel={session.closePanel} onApply={session.applySearch} /> : panel === "review" && game ? <FullscreenKeyboard title={t.fullscreen.review} initial={game.review ?? ""} multiline onCancel={session.cancelReview} onApply={session.saveReview} /> : <>
        <button type="button" className="fs-back" onClick={session.back}><ArrowLeft />{t.fullscreen.back}</button>
        {panel === "menu" && <PlaytroveMenu canRandom={session.games.length > 0} updating={session.updating} onDesktop={() => { session.closePanel(); session.onExit() }} onTheme={() => session.openFromMenu("theme")} onSettings={() => session.openFromMenu("preferences")} onUpdate={() => void session.updateLibrary()} onRandom={session.randomGame} onHelp={() => session.openFromMenu("help")} onMinimize={() => { session.closePanel(); void window.api.windowControls.minimize() }} onExit={() => void window.api.windowControls.close()} onPower={session.askPower} />}
        {panel === "power" && session.powerAction && <PowerConfirm action={session.powerAction} onConfirm={() => void session.confirmPower()} onCancel={session.back} />}
        {panel === "filters" && <PlaytroveFilters games={session.games} filters={session.filters} sort={session.sort} onFilters={session.setFilters} onSort={session.setSort} />}
        {panel === "help" && <PlaytroveHelp swapConfirm={config?.swapConfirm ?? false} />}
        {panel === "notices" && <PlaytroveNotices notices={notices.notices} onClear={notices.clear} />}
        {panel === "preferences" && <><h2>{t.fullscreen.preferences}</h2><FullscreenPreferences /></>}
        {panel === "theme" && <><h2>{t.fullscreen.theme}</h2><FullscreenThemePicker /></>}
        {panel === "trophies" && <FullscreenTrophyOverview games={session.games} onOpen={(id) => { session.closePanel(); session.openDetails(id) }} />}
        {panel === "achievements" && game && <FullscreenAchievements game={game} />}
        {panel === "options" && game && <><h2>{game.title}</h2><div className="fs-options">
          <button type="button" aria-pressed={game.favorite} disabled={editing} onClick={session.favorite}><Star />{t.fullscreen.favorite}</button>
          <h3>{t.fields.status}</h3><div className="fs-status-options">{statuses.map((item) => <button type="button" key={item.id} disabled={editing} aria-pressed={game.statusId === item.id} onClick={() => void mutate(() => window.api.games.setStatus(game.id, item.id))}>{item.name}</button>)}</div>
          {(["rating", "difficulty"] as const).map((field) => <div key={field} className="fs-score"><h3>{t.fields[field]}</h3><button type="button" disabled={editing} aria-label={t.fields[field] + " −"} onClick={() => void mutate(() => window.api.games.setEvaluation(game.id, { [field]: Math.max(1, (game[field] ?? 2) - 1) }))}>{"−"}</button><output>{game[field] !== null ? (game[field]! / 2).toLocaleString(t.locale) + " / 5" : "—"}</output><button type="button" disabled={editing} aria-label={t.fields[field] + " +"} onClick={() => void mutate(() => window.api.games.setEvaluation(game.id, { [field]: Math.min(10, (game[field] ?? 0) + 1) }))}>{"+"}</button><button type="button" disabled={editing} aria-label={t.fields[field] + ": " + t.common.clear} onClick={() => void mutate(() => window.api.games.setEvaluation(game.id, { [field]: null }))}>{t.common.clear}</button></div>)}
          <button type="button" onClick={session.openReview}>{t.fullscreen.editReview}</button>
          <button type="button" disabled={editing} onClick={() => void mutate(async () => { await window.api.metadata.download([game.id]); notices.push(t.fullscreen.metadataQueued(game.title)) })}><Download />{t.actions.downloadMetadata}</button>
          <button type="button" disabled={editing || !game.romPath} onClick={() => void mutate(() => window.api.games.showRom(game.id))}><FolderOpen />{t.actions.showRom}</button>
        </div></>}
      </>}
      {error && <p role="alert" className="fs-error">{error}</p>}
    </section></div>}
    {!panel && error && <p role="alert" className="fs-error fs-toast">{error}</p>}
    {notices.latest && panel !== "notices" && <div className="fs-notice-banner" aria-live="polite"><strong>{notices.latest.title}</strong>{notices.latest.description && <span>{notices.latest.description}</span>}</div>}
    {busy && <div className="fs-running" role="status"><Gamepad2 /><p>{launching ? t.fullscreen.launching : t.fullscreen.running}</p></div>}
  </>
}
