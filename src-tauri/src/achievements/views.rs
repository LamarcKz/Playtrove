//! O que as telas mostram, juntando as conquistas do RetroAchievements e os troféus do PS3 (escolha do
//! usuário em 2026-09-24: tudo junto na aba Conquistas). Cada jogo tem uma fonte só.

use std::collections::HashMap;

use chrono::{DateTime, Datelike, Days, Local, Months, NaiveDate, Utc};
use rusqlite::Connection;

use super::store::{BadgeUrl, get_ra_game_achievements, ra_overview_parts, ra_progress_by_game};
use super::trophy_store::{TrophyIconUrl, get_game_trophies, trophy_overview_parts, trophy_progress_by_game};
use super::types::{
    AchievementProgress, AchievementsOverview, DayCount, GameAchievements, MonthCount, Rarity, RarityCounts, UnlockedAchievement,
};
use crate::library::compare_titles;

/// Quantas conquistas recentes a aba mostra.
const RECENT_LIMIT: usize = 12;

/// O progresso de cada jogo da biblioteca, venha do RetroAchievements ou do RPCS3.
pub fn progress_by_game(db: &Connection) -> rusqlite::Result<HashMap<i64, AchievementProgress>> {
    let mut progress = trophy_progress_by_game(db)?;
    progress.extend(ra_progress_by_game(db)?);
    Ok(progress)
}

/// As conquistas (ou os troféus) de um jogo, ou None se ele não tiver.
pub fn get_game_achievements(
    db: &Connection,
    game_id: i64,
    badge: BadgeUrl,
    trophy_icon: TrophyIconUrl,
) -> rusqlite::Result<Option<GameAchievements>> {
    match get_ra_game_achievements(db, game_id, badge)? {
        Some(achievements) => Ok(Some(achievements)),
        None => get_game_trophies(db, game_id, trophy_icon),
    }
}

/// Tudo o que a aba Conquistas mostra.
pub fn get_overview(
    db: &Connection,
    badge: BadgeUrl,
    trophy_icon: TrophyIconUrl,
    now: DateTime<Local>,
) -> rusqlite::Result<AchievementsOverview> {
    let (mut games, mut unlocked) = ra_overview_parts(db, badge)?;
    let (trophy_games, trophies_unlocked) = trophy_overview_parts(db, trophy_icon)?;
    games.extend(trophy_games);
    unlocked.extend(trophies_unlocked);
    // Os com desbloqueio mais recente primeiro; os que nunca tiveram nenhum por último, pelo nome.
    games.sort_by(|a, b| {
        b.last_unlocked_at
            .as_deref()
            .unwrap_or("")
            .cmp(a.last_unlocked_at.as_deref().unwrap_or(""))
            .then_with(|| compare_titles(&a.title, &b.title))
    });
    unlocked.sort_by(|a, b| b.achievement.earned_at.cmp(&a.achievement.earned_at));
    let mut by_rarity = RarityCounts::default();
    for item in &unlocked {
        match item.achievement.rarity.unwrap_or(Rarity::Common) {
            Rarity::Common => by_rarity.common += 1,
            Rarity::Rare => by_rarity.rare += 1,
            Rarity::VeryRare => by_rarity.very_rare += 1,
            Rarity::UltraRare => by_rarity.ultra_rare += 1,
        }
    }
    let mut rarest: Vec<UnlockedAchievement> =
        unlocked.iter().filter(|item| item.achievement.percent.is_some()).cloned().collect();
    rarest.sort_by(|a, b| a.achievement.percent.partial_cmp(&b.achievement.percent).unwrap_or(std::cmp::Ordering::Equal));
    rarest.truncate(RECENT_LIMIT);

    Ok(AchievementsOverview {
        unlocked: unlocked.len() as i64,
        total: games.iter().map(|game| game.progress.total).sum(),
        points: games.iter().map(|game| game.points.unwrap_or(0)).sum(),
        platinums: games.iter().filter(|game| game.progress.platinum).count() as i64,
        by_day: count_by_day(&unlocked, now),
        by_month: count_by_month(&unlocked, now),
        by_rarity,
        rarest,
        recent: unlocked.into_iter().take(RECENT_LIMIT).collect(),
        games,
    })
}

/// O dia (no horário do computador) em que a conquista foi desbloqueada.
fn local_date(item: &UnlockedAchievement) -> Option<NaiveDate> {
    let earned_at = DateTime::parse_from_rfc3339(item.achievement.earned_at.as_deref()?).ok()?;
    Some(earned_at.with_timezone(&Utc).with_timezone(&Local).date_naive())
}

/// Desbloqueadas por dia nos últimos 30 dias (hoje incluído), do mais antigo para o mais novo.
fn count_by_day(unlocked: &[UnlockedAchievement], now: DateTime<Local>) -> Vec<DayCount> {
    let mut counts: HashMap<NaiveDate, i64> = HashMap::new();
    for date in unlocked.iter().filter_map(local_date) {
        *counts.entry(date).or_default() += 1;
    }
    let first = now.date_naive() - Days::new(29);
    (0..30)
        .map(|index| {
            let date = first + Days::new(index);
            DayCount { date: date.format("%Y-%m-%d").to_string(), count: counts.get(&date).copied().unwrap_or(0) }
        })
        .collect()
}

/// Desbloqueadas por mês nos últimos 12 meses (o atual incluído).
fn count_by_month(unlocked: &[UnlockedAchievement], now: DateTime<Local>) -> Vec<MonthCount> {
    let mut counts: HashMap<(i32, u32), i64> = HashMap::new();
    for date in unlocked.iter().filter_map(local_date) {
        *counts.entry((date.year(), date.month())).or_default() += 1;
    }
    let this_month = now.date_naive().with_day(1).unwrap_or(now.date_naive());
    (0..12)
        .map(|index| {
            let month = this_month.checked_sub_months(Months::new(11 - index)).unwrap_or(this_month);
            MonthCount {
                month: month.format("%Y-%m").to_string(),
                count: counts.get(&(month.year(), month.month())).copied().unwrap_or(0),
            }
        })
        .collect()
}
