//! A rodada de atualização das conquistas do RetroAchievements: acha no RetroAchievements os jogos da
//! biblioteca que ainda não foram achados, busca o progresso dos que mudaram (ou de todos, com `full`) e
//! baixa as insígnias. O banco só fica preso nas leituras e gravações, nunca enquanto espera a internet.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};

use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;

use super::badges::download_badges;
use super::client::{RaApi, RaEndpoints};
use super::matching::{console_id_for, match_ra_game};
use super::store::{
    games_to_match, load_catalog, load_consoles, matched_ra_games, save_catalog, save_consoles, save_game_progress, set_ra_match,
};
use crate::metadata::http::{Fetch, MetadataError};

pub struct SyncServices<'a> {
    pub client: &'a dyn RaApi,
    pub fetch: &'a dyn Fetch,
    pub endpoints: &'a RaEndpoints,
    pub images_dir: &'a Path,
}

#[derive(Debug, PartialEq)]
pub struct SyncResult {
    /// Jogos atualizados (a biblioteca precisa recarregar se houver algum).
    pub updated_games: usize,
    /// Conquistas desbloqueadas desde a última vez (para o aviso).
    pub newly_earned: Vec<i64>,
}

/// Jogos com dados de mais de um dia que são atualizados a cada rodada (a raridade muda devagar).
const STALE_PER_RUN: usize = 2;

fn lock(db: &Mutex<Connection>) -> MutexGuard<'_, Connection> {
    db.lock().unwrap_or_else(PoisonError::into_inner)
}

fn db_error(error: rusqlite::Error) -> MetadataError {
    MetadataError::Skip(error.to_string())
}

/// Atualiza as conquistas. `full`: todos os jogos (primeira vez, conta nova ou o botão "Atualizar");
/// `since`: a última atualização que deu certo (de onde procurar conquistas novas).
pub fn sync_achievements(
    db: &Mutex<Connection>,
    services: &SyncServices,
    full: bool,
    since: Option<&str>,
    now: DateTime<Utc>,
) -> Result<SyncResult, MetadataError> {
    match_games(db, services.client, full, now)?;

    let matched = matched_ra_games(&lock(db)).map_err(db_error)?;
    let mut to_update: Vec<i64> = Vec::new();
    let mut add = |id: i64| {
        if !to_update.contains(&id) {
            to_update.push(id);
        }
    };
    let since = since.and_then(|since| DateTime::parse_from_rfc3339(since).ok()).map(|since| since.with_timezone(&Utc));
    match since {
        Some(since) if !full => {
            // Os jogos das conquistas desbloqueadas desde a última vez (com uma folga de 10 minutos).
            let minutes = (now - since).num_milliseconds() as f64 / 60_000.0 + 10.0;
            let recent: HashSet<i64> = services.client.recent_game_ids(minutes.min(7.0 * 24.0 * 60.0))?.into_iter().collect();
            for (id, synced_at) in &matched {
                if recent.contains(id) || synced_at.is_none() {
                    add(*id);
                }
            }
            // E alguns dos mais antigos, para a raridade não ficar velha.
            let mut stale: Vec<(&i64, &String)> = matched
                .iter()
                .filter_map(|(id, synced_at)| synced_at.as_ref().map(|synced_at| (id, synced_at)))
                .filter(|(_, synced_at)| {
                    DateTime::parse_from_rfc3339(synced_at).is_ok_and(|date| now - date.with_timezone(&Utc) > Duration::hours(24))
                })
                .collect();
            stale.sort_by(|a, b| a.1.cmp(b.1));
            for (id, _) in stale.into_iter().take(STALE_PER_RUN) {
                add(*id);
            }
        }
        _ => matched.iter().for_each(|(id, _)| add(*id)),
    }

    let mut newly_earned = Vec::new();
    let mut badges = Vec::new();
    for ra_game_id in &to_update {
        let mut progress = services.client.game_progress(*ra_game_id)?;
        progress.id = *ra_game_id;
        newly_earned.extend(save_game_progress(&lock(db), &progress, now).map_err(db_error)?);
        badges.extend(
            progress
                .achievements
                .iter()
                .map(|item| (item.badge_name.clone(), item.earned_at.is_some() || item.earned_hardcore_at.is_some())),
        );
    }
    download_badges(services.fetch, services.endpoints, services.images_dir, &badges);
    Ok(SyncResult { updated_games: to_update.len(), newly_earned })
}

/// Procura no RetroAchievements os jogos da biblioteca que ainda não foram achados.
fn match_games(db: &Mutex<Connection>, client: &dyn RaApi, force: bool, now: DateTime<Utc>) -> Result<(), MetadataError> {
    let games = games_to_match(&lock(db), now, force).map_err(db_error)?;
    if games.is_empty() {
        return Ok(());
    }
    let saved = load_consoles(&lock(db), now);
    let consoles = match saved {
        Some(consoles) => consoles,
        None => {
            let consoles = client.consoles()?;
            save_consoles(&lock(db), &consoles, now).map_err(db_error)?;
            consoles
        }
    };
    let mut by_console: BTreeMap<i64, Vec<_>> = BTreeMap::new();
    for game in games {
        match console_id_for(Some(&game.platform), &consoles) {
            // Console sem conquistas no RetroAchievements (ex.: PS3): marca a tentativa e segue.
            None => set_ra_match(&lock(db), game.id, None, now).map_err(db_error)?,
            Some(console_id) => by_console.entry(console_id).or_default().push(game),
        }
    }
    for (console_id, list) in by_console {
        let saved = load_catalog(&lock(db), console_id, now).map_err(db_error)?;
        let catalog = match saved {
            Some(catalog) => catalog,
            None => {
                let catalog = client.catalog(console_id)?;
                save_catalog(&lock(db), console_id, &catalog, now).map_err(db_error)?;
                catalog
            }
        };
        for game in list {
            set_ra_match(&lock(db), game.id, match_ra_game(&game.title, &catalog).map(|found| found.id), now)
                .map_err(db_error)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use chrono::{Local, TimeZone};

    use super::super::client::{RaAchievement, RaCatalogGame, RaConsole, RaGameProgress};
    use super::super::store::save_ra_account;
    use super::super::types::{AchievementSource, Rarity};
    use super::super::views::{get_game_achievements, get_overview, progress_by_game};
    use super::*;
    use crate::dates::iso;
    use crate::emulators::EmulatorId;
    use crate::i18n::Language;
    use crate::library::{EmulatedGame, add_emulated_game};
    use crate::metadata::http::fake::{FakeFetch, not_found};
    use crate::secrets::Secrets;
    use crate::settings::set_setting;
    use crate::test_support::{memory_database, temp_folder};

    /// Um RetroAchievements de mentira: o catálogo, o progresso de cada jogo e as recentes.
    struct FakeClient {
        progress: HashMap<i64, RaGameProgress>,
        recent: Vec<i64>,
        progress_calls: Mutex<Vec<i64>>,
    }

    impl RaApi for FakeClient {
        fn validate(&self) -> Result<(), MetadataError> {
            Ok(())
        }
        fn consoles(&self) -> Result<Vec<RaConsole>, MetadataError> {
            Ok(vec![RaConsole { id: 21, name: "PlayStation 2".into() }])
        }
        fn catalog(&self, _: i64) -> Result<Vec<RaCatalogGame>, MetadataError> {
            Ok(vec![
                RaCatalogGame { id: 77, title: "Salto Estelar".into(), num_achievements: 3 },
                RaCatalogGame { id: 88, title: "Pista Real 4".into(), num_achievements: 2 },
            ])
        }
        fn game_progress(&self, id: i64) -> Result<RaGameProgress, MetadataError> {
            self.progress_calls.lock().unwrap().push(id);
            Ok(self.progress[&id].clone())
        }
        fn recent_game_ids(&self, _: f64) -> Result<Vec<i64>, MetadataError> {
            Ok(self.recent.clone())
        }
    }

    fn achievement(id: i64, num_awarded: i64, earned_at: Option<&str>) -> RaAchievement {
        RaAchievement {
            id,
            title: format!("Conquista {id}"),
            description: "Descrição".into(),
            points: 10,
            badge_name: Some((9000 + id).to_string()),
            display_order: id,
            num_awarded,
            earned_at: earned_at.map(str::to_string),
            earned_hardcore_at: None,
        }
    }

    fn progress() -> HashMap<i64, RaGameProgress> {
        HashMap::from([
            (
                77,
                RaGameProgress {
                    id: 77,
                    title: "Salto Estelar".into(),
                    num_distinct_players: 100,
                    achievements: vec![
                        achievement(1, 90, Some("2026-09-20T10:00:00.000Z")),
                        achievement(2, 30, None),
                        achievement(3, 2, None),
                    ],
                },
            ),
            (
                88,
                RaGameProgress {
                    id: 88,
                    title: "Pista Real 4".into(),
                    num_distinct_players: 50,
                    achievements: vec![
                        achievement(4, 40, Some("2026-08-01T10:00:00.000Z")),
                        achievement(5, 10, Some("2026-08-02T10:00:00.000Z")),
                    ],
                },
            ),
        ])
    }

    struct Setup {
        db: Mutex<Connection>,
        salto: i64,
        pista: i64,
        manobras: i64,
    }

    fn setup() -> Setup {
        let db = memory_database();
        let add = |title: &str, platform: &str| {
            let rom = format!(r"D:\Jogos\{title}.iso");
            let game =
                EmulatedGame { title, rom_path: &rom, platform, library: "PCSX2", emulator: EmulatorId::Pcsx2, core: None };
            add_emulated_game(&db, Language::PtBr, &game).unwrap().unwrap()
        };
        let (salto, pista, manobras) = (
            add("Salto Estelar", "PlayStation 2"),
            add("Pista Real 4", "PlayStation 2"),
            add("Manobras Radicais 3", "PlayStation 3"),
        );
        Setup { db: Mutex::new(db), salto, pista, manobras }
    }

    fn client(progress: HashMap<i64, RaGameProgress>, recent: Vec<i64>) -> FakeClient {
        FakeClient { progress, recent, progress_calls: Mutex::new(Vec::new()) }
    }

    /// As insígnias não são baixadas nos testes (o servidor de mentira responde 404).
    fn sync(setup: &Setup, client: &FakeClient, full: bool, since: Option<&str>, now: DateTime<Utc>) -> SyncResult {
        let fetch = Arc::new(FakeFetch::new(|_, _| not_found()));
        let endpoints = RaEndpoints::test("https://servidor");
        let images = temp_folder("conquistas-insignias");
        let services = SyncServices { client, fetch: &*fetch, endpoints: &endpoints, images_dir: &images };
        sync_achievements(&setup.db, &services, full, since, now).unwrap()
    }

    fn local(month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
        Local.with_ymd_and_hms(2026, month, day, hour, minute, 0).unwrap().with_timezone(&Utc)
    }

    fn progress_of(setup: &Setup, game_id: i64) -> Option<(i64, i64, bool)> {
        progress_by_game(&lock(&setup.db))
            .unwrap()
            .remove(&game_id)
            .map(|progress| (progress.unlocked, progress.total, progress.platinum))
    }

    #[test]
    fn primeira_vez_acha_os_jogos_guarda_o_progresso_e_nao_avisa_nada_antigo() {
        let setup = setup();
        let result = sync(&setup, &client(progress(), vec![]), true, None, local(9, 24, 12, 0));
        assert_eq!(result, SyncResult { updated_games: 2, newly_earned: vec![] });
        assert_eq!(progress_of(&setup, setup.salto), Some((1, 3, false)));
        assert_eq!(progress_of(&setup, setup.pista), Some((2, 2, true)));
        // O PS3 não tem conquistas: fica sem.
        assert_eq!(progress_of(&setup, setup.manobras), None);

        let salto = get_game_achievements(&lock(&setup.db), setup.salto, &|_, _| None, &|_, _| None).unwrap().unwrap();
        let rarity: Vec<(Option<f64>, Option<Rarity>)> =
            salto.achievements.iter().map(|item| (item.percent, item.rarity)).collect();
        assert_eq!(
            rarity,
            [(Some(90.0), Some(Rarity::Common)), (Some(30.0), Some(Rarity::Rare)), (Some(2.0), Some(Rarity::UltraRare))]
        );
        assert_eq!(
            (salto.unlocked, salto.total, salto.points, salto.total_points, salto.platinum),
            (1, 3, Some(10), Some(30), false)
        );
        assert_eq!(salto.source, AchievementSource::Retroachievements);
    }

    #[test]
    fn depois_so_os_jogos_com_conquistas_novas_e_as_novas_viram_aviso() {
        let setup = setup();
        sync(&setup, &client(progress(), vec![]), true, None, local(9, 24, 12, 0));
        let mut changed = progress();
        changed.get_mut(&77).unwrap().achievements[1].earned_at = Some("2026-09-24T12:03:00.000Z".into());
        let fake = client(changed, vec![77]);
        let result = sync(&setup, &fake, false, Some(&iso(local(9, 24, 12, 0))), local(9, 24, 12, 5));
        assert_eq!(*fake.progress_calls.lock().unwrap(), [77]);
        assert_eq!(result, SyncResult { updated_games: 1, newly_earned: vec![2] });
        assert_eq!(progress_of(&setup, setup.salto), Some((2, 3, false)));
    }

    #[test]
    fn tirar_a_conta_esconde_as_conquistas_da_biblioteca_e_da_aba() {
        let setup = setup();
        set_setting(&lock(&setup.db), "raUsername", Some("jogador")).unwrap();
        sync(&setup, &client(progress(), vec![]), true, None, local(9, 24, 12, 0));
        assert_eq!(progress_by_game(&lock(&setup.db)).unwrap().len(), 2);

        save_ra_account(&lock(&setup.db), &Secrets::new(&temp_folder("conquistas-conta")), Language::PtBr, None).unwrap();
        assert!(progress_by_game(&lock(&setup.db)).unwrap().is_empty());
        assert!(get_overview(&lock(&setup.db), &|_, _| None, &|_, _| None, Local::now()).unwrap().games.is_empty());
        assert_eq!(get_game_achievements(&lock(&setup.db), setup.salto, &|_, _| None, &|_, _| None).unwrap(), None);
    }

    #[test]
    fn jogos_atualizados_ha_mais_de_um_dia_entram_na_rodada() {
        let setup = setup();
        sync(&setup, &client(progress(), vec![]), true, None, local(9, 20, 12, 0));
        let fake = client(progress(), vec![]);
        sync(&setup, &fake, false, Some(&iso(local(9, 24, 11, 55))), local(9, 24, 12, 0));
        let mut calls = fake.progress_calls.lock().unwrap().clone();
        calls.sort();
        assert_eq!(calls, [77, 88]);
    }

    #[test]
    fn a_aba_totais_platinas_recentes_e_contagem_por_dia_e_por_mes() {
        let setup = setup();
        let now = local(9, 24, 12, 0);
        {
            let db = lock(&setup.db);
            db.execute("UPDATE games SET ra_game_id = 77 WHERE id = ?1", [setup.salto]).unwrap();
            db.execute("UPDATE games SET ra_game_id = 88 WHERE id = ?1", [setup.pista]).unwrap();
            for progress in progress().values() {
                save_game_progress(&db, progress, now).unwrap();
            }
        }
        let overview = get_overview(&lock(&setup.db), &|_, _| None, &|_, _| None, now.with_timezone(&Local)).unwrap();
        assert_eq!((overview.unlocked, overview.total, overview.points, overview.platinums), (3, 5, 30, 1));
        let titles: Vec<&str> = overview.games.iter().map(|game| game.title.as_str()).collect();
        assert_eq!(titles, ["Salto Estelar", "Pista Real 4"]);
        // Os tipos saem dos pontos (10 pontos = prata), e a platina vale quando todas foram pegas.
        let pista = &overview.games[1].by_grade;
        assert_eq!(
            (pista.platina.unlocked, pista.platina.total, pista.prata.unlocked, pista.prata.total, pista.ouro.total),
            (1, 1, 2, 2, 0)
        );
        assert_eq!((overview.games[0].by_grade.platina.unlocked, overview.games[0].by_grade.platina.total), (0, 1));
        let recent: Vec<i64> = overview.recent.iter().map(|item| item.achievement.id).collect();
        assert_eq!(recent, [1, 5, 4]);
        assert_eq!(overview.by_day.len(), 30);
        assert_eq!(overview.by_day.iter().map(|day| day.count).sum::<i64>(), 1);
        let months = &overview.by_month;
        assert_eq!(
            (months[11].month.as_str(), months[11].count, months[10].month.as_str(), months[10].count),
            ("2026-09", 1, "2026-08", 2)
        );
    }
}
