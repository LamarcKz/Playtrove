import type { FullscreenTheme } from "@shared/fullscreen"
import { PlaytroveShell } from "./PlaytroveShell"
import { HorizonteShell } from "./horizonte/HorizonteShell"
import { MosaicoShell } from "./mosaico/MosaicoShell"
import { PainelShell } from "./painel/PainelShell"
import { useFullscreenSession, type FullscreenShellProps, type FullscreenThemeProps } from "./useFullscreenSession"

const THEMES: Record<FullscreenTheme, (props: FullscreenThemeProps) => React.JSX.Element> = { playtrove: PlaytroveShell, horizonte: HorizonteShell, mosaico: MosaicoShell, painel: PainelShell }

/** A tela cheia: a sessão (seleção, busca, filtros, painéis) é uma só, e o tema escolhido desenha a tela com ela. */
export function FullscreenShell(props: FullscreenShellProps) {
  const session = useFullscreenSession(props)
  const Theme = THEMES[session.theme]
  return <Theme session={session} onOpenEmulators={props.onOpenEmulators} />
}
