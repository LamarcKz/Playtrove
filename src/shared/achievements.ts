/**
 * Conquistas (pedidos do usuário em 2026-09-24): as do RetroAchievements e os troféus dos jogos de
 * PS3, que o próprio RPCS3 guarda. As duas aparecem do mesmo jeito, como troféus do PS3 (bronze,
 * prata, ouro e platina); as do RetroAchievements também têm a raridade no estilo da PlayStation.
 * Os tipos que o main e a interface trocam.
 */

/** De onde vêm as conquistas de um jogo: o RetroAchievements (pela internet) ou o RPCS3 (troféus do PS3). */
export type AchievementSource = "retroachievements" | "rpcs3"

/** Raridade de uma conquista, pela porcentagem de jogadores do RetroAchievements que a desbloquearam. */
export type Rarity = "comum" | "rara" | "muito-rara" | "ultrarrara"

/**
 * As faixas da PlayStation: a primeira cuja porcentagem mínima a conquista alcança. O nome de cada
 * uma fica no dicionário (achievements.rarities).
 */
const RARITIES: { id: Rarity; min: number }[] = [
  { id: "comum", min: 50 },
  { id: "rara", min: 15 },
  { id: "muito-rara", min: 5 },
  { id: "ultrarrara", min: 0 },
]

/** A raridade pela porcentagem (0 a 100) de jogadores que desbloquearam. */
export function rarityOf(percent: number): Rarity {
  return (RARITIES.find((rarity) => percent >= rarity.min) ?? RARITIES[RARITIES.length - 1]).id
}

/** O tipo de um troféu do PS3. */
export type TrophyGrade = "platina" | "ouro" | "prata" | "bronze"

/** Os tipos de troféu, do mais valioso para o mais simples (o nome fica no dicionário: achievements.grades). */
export const TROPHY_GRADES: TrophyGrade[] = ["platina", "ouro", "prata", "bronze"]

/** A partir de quantos pontos uma conquista do RetroAchievements é prata e ouro. */
const GRADE_POINTS = { prata: 10, ouro: 25 }

/**
 * O tipo de uma conquista do RetroAchievements, que não tem bronze, prata e ouro: pelos pontos, que
 * lá dizem a dificuldade (escolha do usuário em 2026-09-24). Bronze até 9, prata de 10 a 24, ouro com
 * 25 ou mais. A platina é ter todas as conquistas do jogo.
 */
export function gradeForPoints(points: number): TrophyGrade {
  return points >= GRADE_POINTS.ouro ? "ouro" : points >= GRADE_POINTS.prata ? "prata" : "bronze"
}

/** O progresso de um jogo nas conquistas, como a biblioteca mostra (lista, grade e colunas). */
export interface AchievementProgress {
  unlocked: number
  total: number
  /** A platina: no RetroAchievements, todas desbloqueadas; no PS3, o troféu de platina. */
  platinum: boolean
  source: AchievementSource
}

/** Uma conquista (ou troféu) de um jogo, com o que o usuário já fez. */
export interface GameAchievement {
  /** Identifica a conquista na tela (o id sozinho se repete entre os jogos de PS3). */
  key: string
  source: AchievementSource
  id: number
  title: string
  description: string
  /** Pontos do RetroAchievements (os troféus do PS3 não têm). */
  points: number | null
  /** A insígnia (colorida se desbloqueada, apagada se não), ou null se ainda não há imagem. */
  badgeUrl: string | null
  /** Porcentagem de jogadores do RetroAchievements que desbloquearam (0 a 100); null nos troféus. */
  percent: number | null
  rarity: Rarity | null
  /** O tipo do troféu (nas conquistas do RetroAchievements, pelos pontos). */
  grade: TrophyGrade
  /** Troféu oculto: o nome e a descrição só aparecem depois de pegar (ou com "Mostrar ocultos"). */
  hidden: boolean
  /** O pacote extra (DLC) do troféu, ou null se for do jogo principal. */
  group: string | null
  /** Quando o usuário desbloqueou (ISO), ou null. */
  earnedAt: string | null
  /** Desbloqueada no modo hardcore do RetroAchievements (sem estados salvos). */
  hardcore: boolean
}

/** Quantos troféus de um tipo o jogo tem e quantos já foram pegos. */
export interface GradeCount {
  unlocked: number
  total: number
}

/** As conquistas de um jogo da biblioteca (o cartão dos detalhes e a janela "Ver todas"). */
export interface GameAchievements {
  gameId: number
  source: AchievementSource
  /** O nome do jogo no RetroAchievements ou no conjunto de troféus. */
  sourceTitle: string
  unlocked: number
  total: number
  /** Pontos do RetroAchievements (null nos troféus do PS3). */
  points: number | null
  totalPoints: number | null
  platinum: boolean
  /**
   * Os troféus de cada tipo. No RetroAchievements, a platina é uma só, que vale quando todas as
   * conquistas foram pegas.
   */
  byGrade: Record<TrophyGrade, GradeCount>
  /** Na ordem do RetroAchievements ou do jogo. */
  achievements: GameAchievement[]
}

/** Uma conquista desbloqueada, com o jogo (a lista de recentes da aba e os avisos). */
export interface UnlockedAchievement extends GameAchievement {
  gameId: number
  gameTitle: string
}

/** Uma linha da lista de jogos da aba Conquistas. */
export interface AchievementGameRow extends AchievementProgress {
  gameId: number
  title: string
  /** Pontos do RetroAchievements (null nos troféus do PS3). */
  points: number | null
  lastUnlockedAt: string | null
  /** Os troféus de cada tipo, como no cartão dos Detalhes. */
  byGrade: Record<TrophyGrade, GradeCount>
}

/** Tudo o que a aba Conquistas mostra (as conquistas do RetroAchievements e os troféus do PS3 juntos). */
export interface AchievementsOverview {
  unlocked: number
  total: number
  /** Pontos do RetroAchievements. */
  points: number
  platinums: number
  games: AchievementGameRow[]
  /** As últimas desbloqueadas, da mais nova para a mais antiga. */
  recent: UnlockedAchievement[]
  /** Desbloqueadas por dia, nos últimos 30 dias (AAAA-MM-DD, do mais antigo para hoje). */
  byDay: { date: string; count: number }[]
  /** Desbloqueadas por mês, nos últimos 12 meses (AAAA-MM). */
  byMonth: { month: string; count: number }[]
}

/** A conta do RetroAchievements e a situação da atualização (Configurações e aba Conquistas). */
export interface AchievementsConfig {
  /** Nome de usuário salvo, ou null sem conta. A chave nunca volta para a interface. */
  username: string | null
  syncing: boolean
  lastSyncAt: string | null
  /** O motivo da última atualização ter falhado (ex.: chave recusada), ou null. */
  lastError: string | null
}
