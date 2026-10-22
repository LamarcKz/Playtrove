//! O serviço das conquistas: atualiza as do RetroAchievements logo depois de abrir o app, a cada 5
//! minutos e 20 s depois de fechar um jogo, e relê os troféus do RPCS3 a cada minuto e logo depois de
//! fechar um jogo, sempre em linhas de execução à parte. Avisa a interface quando começa e termina de
//! atualizar e quando aparece uma conquista nova.

use std::path::Path;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};

use super::badges::badge_url;
use super::client::{RaAccount, RaClient, RaEndpoints};
use super::store::{get_ra_account, get_ra_status, get_ra_username, set_ra_error, set_ra_last_sync, unlocked_by_ids};
use super::sync::{SyncServices, sync_achievements};
use super::trophy_files::{find_trophy_dir, read_text_file};
use super::trophy_icons::{copy_trophy_icon_resized, trophy_icon_url};
use super::trophy_store::unlocked_trophies;
use super::trophy_sync::{TrophySyncServices, sync_trophies};
use super::types::{AchievementsConfig, UnlockedAchievement};
use crate::commands::notify_library_changed;
use crate::dates::iso;
use crate::discs::read_ps3_trophy_sets;
use crate::emulators::{EmulatorId, get_emulator_paths};
use crate::i18n::Language;
use crate::images::ImagesDir;
use crate::metadata::http::{Fetch, HttpClient};
use crate::secrets::Secrets;
use crate::state::AppState;
use crate::test_mode::test_mode;

/// De quanto em quanto tempo o app procura conquistas novas com ele aberto (escolha do usuário em 2026-09-24).
const INTERVAL: Duration = Duration::from_secs(5 * 60);
/// Espera depois de abrir o app e depois de fechar um jogo (o RetroAchievements registra na hora).
const START_DELAY: Duration = Duration::from_secs(15);
const AFTER_GAME_DELAY: Duration = Duration::from_secs(20);
/// Os troféus do RPCS3 são arquivos do computador: dá para ler a cada minuto sem pesar.
const TROPHY_INTERVAL: Duration = Duration::from_secs(60);
const TROPHY_DELAY: Duration = Duration::from_secs(3);

const STATUS_EVENT: &str = "achievements:status";
const UNLOCKED_EVENT: &str = "achievements:unlocked";

#[derive(Default)]
struct SyncState {
    running: bool,
    /// Pediram outra atualização no meio desta (e se ela é completa): roda logo depois.
    again: Option<bool>,
}

pub struct AchievementsService {
    app: AppHandle,
    fetch: Arc<dyn Fetch>,
    endpoints: RaEndpoints,
    state: Mutex<SyncState>,
    finished: Condvar,
    /// Uma leitura dos troféus de cada vez.
    trophies: Mutex<()>,
}

impl AchievementsService {
    pub fn new(app: AppHandle) -> AchievementsService {
        // Os testes do app trocam o RetroAchievements pelo servidor de mentira (nunca no app de verdade).
        let endpoints = test_mode().metadata_server.as_deref().map_or_else(RaEndpoints::real, RaEndpoints::test);
        AchievementsService {
            app,
            fetch: Arc::new(HttpClient::new()),
            endpoints,
            state: Mutex::default(),
            finished: Condvar::new(),
            trophies: Mutex::new(()),
        }
    }

    /// Um cliente da API com a conta dada (para conferir uma conta nova antes de salvar).
    pub fn client(&self, account: RaAccount, language: Language) -> RaClient {
        RaClient::new(Arc::clone(&self.fetch), self.endpoints.clone(), account, language)
    }

    pub fn config(&self) -> AchievementsConfig {
        let state = self.app.state::<AppState>();
        let db = state.db();
        let (last_sync_at, last_error) = get_ra_status(&db);
        let syncing = self.state.lock().unwrap_or_else(PoisonError::into_inner).running;
        AchievementsConfig { username: get_ra_username(&db), syncing, last_sync_at, last_error }
    }

    fn images_dir(&self) -> std::path::PathBuf {
        self.app.state::<ImagesDir>().0.clone()
    }

    /// Lê os troféus do RPCS3 agora (ex.: depois de achar jogos novos numa pasta de ROMs), se ele estiver
    /// configurado na aba Emuladores.
    pub fn read_trophies(&self) {
        let _reading = self.trophies.lock().unwrap_or_else(PoisonError::into_inner);
        let state = self.app.state::<AppState>();
        let images_dir = self.images_dir();
        let result = (|| -> rusqlite::Result<(bool, Vec<UnlockedAchievement>)> {
            let db = state.db();
            let Some(rpcs3) = get_emulator_paths(&db)?.remove(&EmulatorId::Rpcs3) else { return Ok((false, Vec::new())) };
            let services = TrophySyncServices {
                trophy_dir: find_trophy_dir(Path::new(&rpcs3), &read_text_file),
                images_dir: images_dir.clone(),
                copy_icon: &copy_trophy_icon_resized,
                read_game_sets: &|rom| read_ps3_trophy_sets(Path::new(rom)),
            };
            let result = sync_trophies(&db, &services, Utc::now())?;
            let icon = |set: &str, id: i64| trophy_icon_url(&images_dir, set, id);
            Ok((result.changed, unlocked_trophies(&db, &result.newly_unlocked, &icon)?))
        })();
        match result {
            Ok((changed, unlocked)) => {
                if changed {
                    notify_library_changed(&self.app);
                }
                if !unlocked.is_empty() {
                    let _ = self.app.emit(UNLOCKED_EVENT, unlocked);
                }
            }
            Err(error) => eprintln!("[troféus] não deu para ler os troféus do RPCS3: {error}"),
        }
    }

    /// O botão "Atualizar": relê os troféus do RPCS3 e atualiza todos os jogos do RetroAchievements.
    pub fn refresh(&self) {
        self.read_trophies();
        self.sync(true);
    }

    /// Atualiza agora (com `full`, todos os jogos do RetroAchievements) e espera terminar. Se já estiver
    /// atualizando, pede outra rodada logo depois e espera a atual.
    pub fn sync(&self, full: bool) {
        {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            if state.running {
                state.again = Some(state.again.unwrap_or(false) || full);
                let _waited = self.finished.wait_while(state, |state| state.running).unwrap_or_else(PoisonError::into_inner);
                return;
            }
            state.running = true;
        }
        let mut full = full;
        loop {
            self.run(full);
            let next = {
                let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
                let next = state.again.take();
                if next.is_none() {
                    state.running = false;
                }
                next
            };
            let _ = self.app.emit(STATUS_EVENT, self.config());
            match next {
                Some(again) => full = again,
                None => break,
            }
        }
        self.finished.notify_all();
    }

    fn run(&self, full: bool) {
        let state = self.app.state::<AppState>();
        let language = state.language();
        let (account, last_sync_at) = {
            let db = state.db();
            (get_ra_account(&db, &self.app.state::<Secrets>()), get_ra_status(&db).0)
        };
        let Some(account) = account else { return };
        let _ = self.app.emit(STATUS_EVENT, self.config());
        let now = Utc::now();
        let images_dir = self.images_dir();
        let client = self.client(account, language);
        let services = SyncServices { client: &client, fetch: &*self.fetch, endpoints: &self.endpoints, images_dir: &images_dir };
        match sync_achievements(state.database(), &services, full, last_sync_at.as_deref(), now) {
            Ok(result) => {
                let db = state.db();
                let _ = set_ra_last_sync(&db, &iso(now));
                if result.updated_games > 0 {
                    notify_library_changed(&self.app);
                }
                let badge = |name: Option<&str>, earned: bool| badge_url(&images_dir, name, earned);
                let unlocked = unlocked_by_ids(&db, &result.newly_earned, &badge).unwrap_or_default();
                if !unlocked.is_empty() {
                    let _ = self.app.emit(UNLOCKED_EVENT, unlocked);
                }
            }
            Err(error) => {
                let _ = set_ra_error(&state.db(), &error.to_string());
                eprintln!("[conquistas] não deu para atualizar: {error}");
            }
        }
    }

    /// Começa a atualizar sozinho: logo depois de abrir, a cada 5 minutos (e a cada minuto, os troféus).
    pub fn start(&self) {
        let app = self.app.clone();
        thread::spawn(move || {
            thread::sleep(START_DELAY);
            loop {
                app.state::<AchievementsService>().sync(false);
                thread::sleep(INTERVAL);
            }
        });
        let app = self.app.clone();
        thread::spawn(move || {
            thread::sleep(TROPHY_DELAY);
            loop {
                app.state::<AchievementsService>().read_trophies();
                thread::sleep(TROPHY_INTERVAL);
            }
        });
    }

    /// Um jogo fechou: relê os troféus e atualiza as conquistas daqui a pouco.
    pub fn after_game_closed(&self) {
        let app = self.app.clone();
        thread::spawn(move || {
            thread::sleep(TROPHY_DELAY);
            app.state::<AchievementsService>().read_trophies();
        });
        let app = self.app.clone();
        thread::spawn(move || {
            thread::sleep(AFTER_GAME_DELAY);
            app.state::<AchievementsService>().sync(false);
        });
    }
}
