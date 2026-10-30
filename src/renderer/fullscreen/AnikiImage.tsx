import { useState, type ReactNode } from "react"
import type { TrophyGrade } from "@shared/achievements"
import { TrophyIcon } from "@/components/AchievementParts"
import { anikiAsset } from "@/lib/anikiAssets"
import type { AchievementLevel } from "@/lib/collectorLevel"

interface Props { path: string; className?: string; fallback?: ReactNode }

/** Imagem decorativa do pacote; a alternativa permanece legível se o arquivo faltar. */
export function AnikiImage(props: Props) {
  return <PackageImage key={props.path} {...props} />
}

function PackageImage({ path, className, fallback = null }: Props) {
  const [failed, setFailed] = useState(false)
  return failed ? fallback : <img src={anikiAsset(path)} alt="" aria-hidden="true" draggable={false} className={className} onError={() => setFailed(true)} />
}

const trophyFiles: Record<TrophyGrade, string> = { platina: "Plat", ouro: "Or", prata: "Argent", bronze: "Bronze" }

export function AnikiTrophyIcon({ grade, className = "" }: { grade: TrophyGrade; className?: string }) {
  return <AnikiImage path={`Images/${trophyFiles[grade]}.png`} className={`aniki-trophy-icon ${className}`} fallback={<TrophyIcon grade={grade} className={className} />} />
}

/** As imagens de patente do Aniki agrupam os cinco graus em três medalhas por metal. */
export function AnikiRankImage({ rank }: { rank: AchievementLevel["rank"] }) {
  if (!rank) return null
  const metals = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Plat", master: "Plat" }
  const file = rank.tier === "master" ? "Plat" : `${metals[rank.tier]}${Math.floor((5 - rank.step) / 2) + 1}`
  return <AnikiImage path={`Images/UserLevel/${file}.png`} className="aniki-rank-image" />
}

const platformNames: Record<string, string> = {
  PlayStation: "Sony Playstation", "PlayStation 2": "Sony Playstation 2", "PlayStation 3": "Sony Playstation 3",
  PSP: "Sony PlayStation Portable", "Game Boy": "Nintendo Game Boy", "Game Boy Color": "Nintendo Game Boy Color",
  "Game Boy Advance": "Nintendo Game Boy Advance", "Nintendo DS": "Nintendo DS", "Nintendo 3DS": "Nintendo 3DS",
  GameCube: "Nintendo GameCube", Wii: "Nintendo Wii",
}

export function AnikiPlatformImage({ platform }: { platform: string }) {
  return <AnikiImage path={`Icons/Source/${platformNames[platform] ?? platform}.png`} className="aniki-platform-image" />
}
