import { Gamepad2 } from "lucide-react"
import type { Game } from "@shared/types"
import { GameCover } from "@/components/GameCover"
import { useI18n } from "@/hooks/useI18n"
import { AnikiIcon } from "./AnikiGlyph"
import { AnikiShortcutBar, type AnikiShortcut } from "./AnikiShortcutBar"

interface Props {
  game: Game | undefined
  games: Game[]
  visible: Game[]
  selectedId: number | null
  query: string
  shortcuts: AnikiShortcut[]
  onSelect: (id: number) => void
  onOpen: (id: number) => void
  onClearSearch: () => void
  onOpenEmulators: () => void
}

/** Biblioteca horizontal do Aniki: logo (ou nome) do jogo sobre a arte, informações, atalhos e a faixa de capas. */
export function AnikiLibrary({ game, games, visible, selectedId, query, shortcuts, onSelect, onOpen, onClearSearch, onOpenEmulators }: Props) {
  const { t } = useI18n()
  return <div className="aniki-library" data-testid="fullscreen-library">
    <div className="aniki-hero">
      <h1 className="aniki-game-title">{game?.title ?? t.library.emptyTitle}</h1>
    </div>
    {game && <div className="aniki-chips">
      {query && <button type="button" className="aniki-chip" onClick={onClearSearch}>{t.fullscreen.clearSearch}</button>}
      {game.favorite && <span className="aniki-chip"><AnikiIcon icon="heartFilled" />{t.fullscreen.favorite}</span>}
      {game.achievements && <span className="aniki-chip"><AnikiIcon icon="trophy" />{game.achievements.unlocked} / {game.achievements.total}</span>}
      {(game.platform ?? game.library) && <span className="aniki-chip aniki-chip-source">{game.platform ?? game.library}</span>}
    </div>}
    <AnikiShortcutBar shortcuts={shortcuts} />
    <div className="aniki-rail">
      {visible.map((item) => <button
        type="button"
        key={item.id}
        data-testid={`fullscreen-game-${item.id}`}
        data-fs-default={item.id === selectedId ? "" : undefined}
        aria-label={item.title}
        aria-current={item.id === selectedId ? "true" : undefined}
        onFocus={() => onSelect(item.id)}
        onMouseEnter={() => onSelect(item.id)}
        onClick={() => onOpen(item.id)}
        className="aniki-cover"
      >
        <GameCover title={item.title} src={item.coverUrl} layout="grid" />
        {item.achievements && item.id === selectedId && <span className="aniki-cover-trophy"><AnikiIcon icon="trophy" /></span>}
      </button>)}
    </div>
    {visible.length === 0 && <div className="aniki-empty"><Gamepad2 /><p>{games.length ? t.library.noResultsTitle : t.library.emptyDescription}</p>{!games.length && <button type="button" onClick={onOpenEmulators}>{t.library.goToEmulators}</button>}</div>}
  </div>
}
