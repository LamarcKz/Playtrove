import { Crown, Flame, Gamepad2, Ghost, Rocket, Shield, Skull, Sparkles, Star, Swords, Trophy, Zap, type LucideIcon } from "lucide-react"
import type { ProfileAvatar } from "@shared/fullscreen"
import { anikiAvatarImage } from "@shared/anikiAppearance"
import { useAnikiAppearance } from "./AnikiAppearanceContext"
import { AnikiImage } from "./AnikiImage"

const icons: Record<ProfileAvatar, LucideIcon> = { gamepad: Gamepad2, trophy: Trophy, star: Star, crown: Crown, ghost: Ghost, swords: Swords, rocket: Rocket, flame: Flame, skull: Skull, sparkles: Sparkles, shield: Shield, zap: Zap }

/** Avatar do pacote instalado, com o ícone próprio como alternativa caso a mídia não carregue. */
export function AnikiAvatar({ avatar, size, anikiAvatarIndex }: { avatar: ProfileAvatar; size: number; anikiAvatarIndex?: number | null }) {
  const appearance = useAnikiAppearance()
  const Icon = icons[avatar]
  const path = anikiAvatarImage(anikiAvatarIndex === undefined ? appearance.anikiAvatarIndex : anikiAvatarIndex)
  const fallback = <Icon style={{ width: size * .52, height: size * .52 }} />
  return <span className={`aniki-avatar aniki-avatar-${avatar}`} style={{ width: size, height: size }} aria-hidden="true">{path ? <AnikiImage path={path} className="aniki-avatar-image" fallback={fallback} /> : fallback}</span>
}
