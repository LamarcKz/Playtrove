import { TROPHY_GRADES, type GradeCount, type TrophyGrade } from "../../shared/achievements"

/**
 * Quantos troféus de cada tipo o jogo tem e quantos já foram pegos. Com `platinumWhenComplete`, a
 * platina é uma só e vale quando todas foram pegas (o RetroAchievements não tem troféu de platina).
 */
export function countGrades(
  items: { grade: TrophyGrade; earned: boolean }[],
  platinumWhenComplete: boolean
): Record<TrophyGrade, GradeCount> {
  const counts = Object.fromEntries(TROPHY_GRADES.map((grade) => [grade, { unlocked: 0, total: 0 }])) as Record<
    TrophyGrade,
    GradeCount
  >
  for (const item of items) {
    counts[item.grade].total++
    if (item.earned) counts[item.grade].unlocked++
  }
  if (platinumWhenComplete && items.length > 0) {
    counts.platina = { unlocked: items.every((item) => item.earned) ? 1 : 0, total: 1 }
  }
  return counts
}
