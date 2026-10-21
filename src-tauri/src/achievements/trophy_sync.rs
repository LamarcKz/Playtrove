//! A leitura dos troféus que o RPCS3 guardou: só os conjuntos cujos arquivos mudaram desde a última
//! leitura, e depois a ligação dos jogos de PS3 da biblioteca aos conjuntos. Tudo local, sem internet.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use rusqlite::Connection;

use super::trophy_files::{list_trophy_sets, read_trophy_set};
use super::trophy_icons::{copy_trophy_icons, trophy_icons_dir};
use super::trophy_store::{link_trophy_sets, save_trophy_set, trophy_set_stamp};

pub struct TrophySyncServices<'a> {
    /// A pasta de troféus do RPCS3 (find_trophy_dir).
    pub trophy_dir: PathBuf,
    pub images_dir: PathBuf,
    /// Copia a imagem de um troféu (no app, diminuída; nos testes, igual).
    pub copy_icon: &'a dyn Fn(&Path, &Path) -> Result<(), String>,
    /// Os conjuntos de troféus de um jogo, lidos do disco (read_ps3_trophy_sets).
    pub read_game_sets: &'a dyn Fn(&str) -> Vec<String>,
}

#[derive(Debug, PartialEq)]
pub struct TrophySyncResult {
    /// Algo mudou (a biblioteca precisa recarregar).
    pub changed: bool,
    /// Troféus pegos desde a última leitura (para o aviso): o conjunto e o id.
    pub newly_unlocked: Vec<(String, i64)>,
}

pub fn sync_trophies(db: &Connection, services: &TrophySyncServices, now: DateTime<Utc>) -> rusqlite::Result<TrophySyncResult> {
    let mut changed = false;
    let mut newly_unlocked = Vec::new();
    for set in list_trophy_sets(&services.trophy_dir) {
        let icons_dir = trophy_icons_dir(&services.images_dir, &set.id);
        if trophy_set_stamp(db, &set.id)?.as_deref() == Some(set.stamp.as_str()) && icons_dir.exists() {
            continue;
        }
        match read_trophy_set(&set, now) {
            Ok((definition, unlocks)) => {
                for id in save_trophy_set(db, &set.id, &definition, &unlocks, &set.stamp, now)? {
                    newly_unlocked.push((set.id.clone(), id));
                }
                let ids: Vec<i64> = definition.trophies.iter().map(|trophy| trophy.id).collect();
                copy_trophy_icons(&set.dir, &icons_dir, &ids, services.copy_icon);
                changed = true;
            }
            // Arquivo pela metade (o RPCS3 gravando agora) ou estranho: tenta de novo na próxima leitura.
            Err(error) => eprintln!("[troféus] não deu para ler {}: {error}", set.id),
        }
    }
    if link_trophy_sets(db, services.read_game_sets, now)? > 0 {
        changed = true;
    }
    Ok(TrophySyncResult { changed, newly_unlocked })
}

#[cfg(test)]
mod tests {
    use std::time::{Duration as StdDuration, SystemTime};

    use chrono::{Duration, Local, TimeZone};

    use super::super::trophy_files::fake::{SET, build_trop_usr, conf, trophies};
    use super::super::types::{AchievementSource, GradeCount, TrophyGrade};
    use super::super::views::{get_game_achievements, get_overview, progress_by_game};
    use super::*;
    use crate::discs::read_ps3_trophy_sets;
    use crate::emulators::EmulatorId;
    use crate::i18n::Language;
    use crate::library::{EmulatedGame, add_emulated_game};
    use crate::test_support::{create_files, memory_database, temp_folder};

    fn copy(source: &Path, target: &Path) -> Result<(), String> {
        std::fs::copy(source, target).map(|_| ()).map_err(|error| error.to_string())
    }

    fn read_sets(rom: &str) -> Vec<String> {
        read_ps3_trophy_sets(Path::new(rom))
    }

    /// Um RPCS3 de mentira com o conjunto de troféus instalado e um jogo de PS3 na biblioteca.
    struct Setup {
        db: Connection,
        game_id: i64,
        trophy_dir: PathBuf,
        images_dir: PathBuf,
        set_dir: PathBuf,
        version: u64,
    }

    impl Setup {
        fn new(name: &str, rom_path: Option<String>) -> Setup {
            let db = memory_database();
            let trophy_dir = temp_folder(&format!("{name}-trofeus"));
            let set_dir = trophy_dir.join(SET);
            std::fs::create_dir_all(&set_dir).unwrap();
            std::fs::write(set_dir.join("TROPCONF.SFM"), conf()).unwrap();
            for trophy in trophies() {
                std::fs::write(set_dir.join(format!("TROP{:03}.PNG", trophy.id)), format!("imagem {}", trophy.id)).unwrap();
            }
            let games = temp_folder(&format!("{name}-jogos"));
            create_files(
                &games,
                &[(&format!("Manobras/PS3_GAME/TROPDIR/{SET}/TROPHY.TRP"), ""), ("Manobras/PS3_GAME/USRDIR/EBOOT.BIN", "")],
            );
            let rom =
                rom_path.unwrap_or_else(|| games.join(r"Manobras\PS3_GAME\USRDIR\EBOOT.BIN").to_string_lossy().into_owned());
            let game = EmulatedGame {
                title: "Manobras Radicais 3",
                rom_path: &rom,
                platform: "PlayStation 3",
                library: "RPCS3",
                emulator: EmulatorId::Rpcs3,
                core: None,
            };
            let game_id = add_emulated_game(&db, Language::PtBr, &game).unwrap().unwrap();
            Setup { db, game_id, trophy_dir, images_dir: temp_folder(&format!("{name}-imagens")), set_dir, version: 0 }
        }

        fn sync(&self, now: DateTime<Utc>) -> TrophySyncResult {
            self.sync_from(&self.trophy_dir, now)
        }

        fn sync_from(&self, trophy_dir: &Path, now: DateTime<Utc>) -> TrophySyncResult {
            let services = TrophySyncServices {
                trophy_dir: trophy_dir.to_path_buf(),
                images_dir: self.images_dir.clone(),
                copy_icon: &copy,
                read_game_sets: &read_sets,
            };
            sync_trophies(&self.db, &services, now).unwrap()
        }

        /// Grava o que foi pego (mudando a data do arquivo, como quando o RPCS3 grava de novo).
        fn write_unlocks(&mut self, unlocked: &[(i64, DateTime<Utc>)]) {
            let file = self.set_dir.join("TROPUSR.DAT");
            std::fs::write(&file, build_trop_usr(trophies().len(), unlocked)).unwrap();
            self.version += 1;
            let time = SystemTime::now() + StdDuration::from_secs(self.version * 5);
            std::fs::File::options().write(true).open(&file).unwrap().set_modified(time).unwrap();
        }

        fn progress(&self) -> Option<(i64, i64, bool)> {
            progress_by_game(&self.db)
                .unwrap()
                .remove(&self.game_id)
                .map(|progress| (progress.unlocked, progress.total, progress.platinum))
        }
    }

    #[test]
    fn primeira_leitura_liga_o_jogo_pelo_disco_guarda_os_trofeus_e_as_imagens_sem_aviso() {
        let mut setup = Setup::new("trofeus-primeira", None);
        let now = Utc::now();
        setup.write_unlocks(&[(1, now - Duration::days(3)), (2, now - Duration::days(1))]);

        assert_eq!(setup.sync(now), TrophySyncResult { changed: true, newly_unlocked: vec![] });
        assert_eq!(setup.progress(), Some((2, 5, false)));
        let mut icons: Vec<String> = std::fs::read_dir(setup.images_dir.join("trophies").join(SET))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        icons.sort();
        assert_eq!(icons, ["0.png", "1.png", "2.png", "3.png", "4.png"]);

        let icon = |set: &str, id: i64| Some(format!("{set}/{id}"));
        let trophies = get_game_achievements(&setup.db, setup.game_id, &|_, _| None, &icon).unwrap().unwrap();
        assert_eq!(
            (trophies.source, trophies.source_title.as_str(), trophies.unlocked, trophies.total, trophies.points),
            (AchievementSource::Rpcs3, "Manobras Radicais 3", 2, 5, None)
        );
        assert_eq!(trophies.by_grade.platina, GradeCount { unlocked: 0, total: 1 });
        assert_eq!(trophies.by_grade.ouro, GradeCount { unlocked: 0, total: 1 });
        assert_eq!(trophies.by_grade.prata, GradeCount { unlocked: 1, total: 1 });
        assert_eq!(trophies.by_grade.bronze, GradeCount { unlocked: 1, total: 2 });
        let hidden = &trophies.achievements[3];
        assert_eq!(
            (hidden.grade, hidden.hidden, hidden.earned_at.clone(), hidden.badge_url.clone(), hidden.rarity),
            (TrophyGrade::Ouro, true, None, Some(format!("{SET}/3")), None)
        );
        assert_eq!(
            (trophies.achievements[4].group.as_deref(), trophies.achievements[4].key.clone()),
            (Some("Pacote Montanha & Neve"), format!("{SET}-4"))
        );
    }

    #[test]
    fn depois_so_rele_o_que_mudou_e_os_trofeus_novos_viram_aviso() {
        let mut setup = Setup::new("trofeus-depois", None);
        let now = Utc::now();
        setup.write_unlocks(&[(1, now - Duration::days(3)), (2, now - Duration::days(1))]);
        setup.sync(now);
        assert_eq!(setup.sync(now), TrophySyncResult { changed: false, newly_unlocked: vec![] });

        // O jogo principal completo: o RPCS3 dá a platina junto (o pacote extra não conta).
        setup.write_unlocks(&[(0, now), (1, now - Duration::days(3)), (2, now - Duration::days(1)), (3, now)]);
        let result = setup.sync(now);
        assert!(result.changed);
        let mut newly = result.newly_unlocked.clone();
        newly.sort();
        assert_eq!(newly, [(SET.to_string(), 0), (SET.to_string(), 3)]);
        assert_eq!(setup.progress(), Some((4, 5, true)));
    }

    #[test]
    fn jogo_ainda_nao_aberto_no_rpcs3_fica_ligado_pelo_disco_esperando_os_trofeus() {
        let mut setup = Setup::new("trofeus-esperando", None);
        let pending = |db: &Connection| crate::achievements::trophy_store::games_waiting_for_trophies(db).unwrap();
        // O RPCS3 só instala os troféus na primeira vez que o jogo abre: antes, a pasta dele está vazia.
        setup.sync_from(&temp_folder("trofeus-pasta-vazia"), Utc::now());
        assert_eq!(setup.progress(), None);
        assert!(pending(&setup.db).contains(&setup.game_id));

        setup.write_unlocks(&[]);
        setup.sync(Utc::now());
        assert_eq!(setup.progress(), Some((0, 5, false)));
        assert!(pending(&setup.db).is_empty());
    }

    #[test]
    fn sem_o_disco_para_ler_liga_pelo_nome_do_jogo_no_conjunto_instalado() {
        let mut setup = Setup::new("trofeus-nome", Some(r"D:\Jogos\PS3\Manobras Radicais 3 (USA).iso".into()));
        setup.write_unlocks(&[]);
        setup.sync(Utc::now());
        assert_eq!(setup.progress(), Some((0, 5, false)));
    }

    #[test]
    fn a_aba_junta_as_conquistas_do_retroachievements_e_os_trofeus_do_ps3() {
        let mut setup = Setup::new("trofeus-aba", None);
        let local =
            |month: u32, day: u32, hour: u32| Local.with_ymd_and_hms(2026, month, day, hour, 0, 0).unwrap().with_timezone(&Utc);
        let now = local(9, 24, 12);
        setup.write_unlocks(&[(1, local(9, 23, 20)), (2, local(9, 24, 9))]);
        setup.sync(now);
        // Um jogo do RetroAchievements, com uma conquista pega no meio das duas dos troféus.
        let game = EmulatedGame {
            title: "Salto Estelar",
            rom_path: r"D:\Jogos\Salto Estelar.iso",
            platform: "PlayStation 2",
            library: "PCSX2",
            emulator: EmulatorId::Pcsx2,
            core: None,
        };
        let ra_game = add_emulated_game(&setup.db, Language::PtBr, &game).unwrap().unwrap();
        setup.db.execute("UPDATE games SET ra_game_id = 77 WHERE id = ?1", [ra_game]).unwrap();
        let progress = crate::achievements::client::RaGameProgress {
            id: 77,
            title: "Salto Estelar".into(),
            num_distinct_players: 10,
            achievements: vec![
                crate::achievements::client::tests::achievement(
                    1,
                    "Primeiro salto",
                    5,
                    9,
                    Some(crate::dates::iso(local(9, 24, 8))),
                ),
                crate::achievements::client::tests::achievement(2, "Salto final", 10, 1, None),
            ],
        };
        crate::achievements::store::save_game_progress(&setup.db, &progress, now).unwrap();

        let overview = get_overview(&setup.db, &|_, _| None, &|_, _| None, now.with_timezone(&Local)).unwrap();
        assert_eq!((overview.unlocked, overview.total, overview.points, overview.platinums), (3, 7, 5, 0));
        let titles: Vec<(&str, AchievementSource)> =
            overview.games.iter().map(|game| (game.title.as_str(), game.progress.source)).collect();
        assert_eq!(
            titles,
            [("Manobras Radicais 3", AchievementSource::Rpcs3), ("Salto Estelar", AchievementSource::Retroachievements)]
        );
        assert_eq!(overview.games[0].by_grade.bronze, GradeCount { unlocked: 1, total: 2 });
        let recent: Vec<&str> = overview.recent.iter().map(|item| item.achievement.key.as_str()).collect();
        assert_eq!(recent, [format!("{SET}-2").as_str(), "ra-1", format!("{SET}-1").as_str()]);
        let today = overview.by_day.last().unwrap();
        assert_eq!((today.date.as_str(), today.count), ("2026-09-24", 2));
    }
}
