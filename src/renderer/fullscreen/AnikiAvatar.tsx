import { Crown, Flame, Gamepad2, Ghost, Rocket, Shield, Skull, Sparkles, Star, Swords, Trophy, Zap, type LucideIcon } from "lucide-react"
import type { ProfileAvatar } from "@shared/fullscreen"

const icons: Record<ProfileAvatar, LucideIcon> = { gamepad: Gamepad2, trophy: Trophy, star: Star, crown: Crown, ghost: Ghost, swords: Swords, rocket: Rocket, flame: Flame, skull: Skull, sparkles: Sparkles, shield: Shield, zap: Zap }

/** Avatar do perfil: arte própria do Playtrove no círculo com a borda dourada do Aniki. */
export function AnikiAvatar({ avatar, size }: { avatar: ProfileAvatar; size: number }) {
  const Icon = icons[avatar]
  return <span className={`aniki-avatar aniki-avatar-${avatar}`} style={{ width: size, height: size }} aria-hidden="true"><Icon style={{ width: size * .52, height: size * .52 }} /></span>
}
