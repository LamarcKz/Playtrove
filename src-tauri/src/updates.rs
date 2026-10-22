//! A atualização do app pelas releases do GitHub (o aviso de versão nova e Configurações → Sobre), como em
//! src/main/updateService.ts. Quem procura e instala é o atualizador do Tauri: cada versão vem assinada, e
//! o app só instala o que tiver a assinatura da chave do projeto (a pública fica no tauri.conf.json). Na
//! versão portátil, o botão só abre a página de download.

use std::sync::{Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::data_folder::is_portable;
use crate::links::external_link;
use crate::settings::{get_setting, set_setting};
use crate::state::AppState;
use crate::test_hooks::open_in_browser;
use crate::test_mode::test_mode;

/// O aviso de que a situação da atualização mudou.
const UPDATES_STATUS_EVENT: &str = "updates:status";

/// Quanto esperar, depois de o app abrir, para procurar versão nova (para não atrasar a abertura).
const STARTUP_CHECK_DELAY: Duration = Duration::from_secs(5);

/// A opção "procurar ao abrir" (Configurações → Sobre), guardada no banco: "0" quando desligada.
const AUTO_CHECK_SETTING: &str = "updatesAutoCheck";

/// unsupported: rodando pelo npm run dev:tauri, sem atualização; idle: ainda não procurou; checking;
/// latest: esta já é a versão mais nova; available: há uma versão nova; downloading; ready: baixada, o app
/// fecha para instalar e abre de novo; error: não deu para procurar ou baixar (ex.: sem internet).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateState {
    Unsupported,
    Idle,
    Checking,
    Latest,
    Available,
    Downloading,
    Ready,
    Error,
}

/// O que a tela mostra (o mesmo UpdateStatus de src/shared/types.ts).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub state: UpdateState,
    /// A versão nova, quando há uma.
    pub version: Option<String>,
    /// Quanto do download já foi, de 0 a 100.
    pub percent: u8,
    /// Versão portátil: não se atualiza sozinha; o aviso leva à página de download.
    pub portable: bool,
    /// Procurar versão nova sempre que o app abrir.
    pub auto_check: bool,
}

/// Quem procura, baixa e instala as versões novas (o atualizador do Tauri, ou um de mentira nos testes).
pub trait Updater: Send + Sync {
    /// A versão nova, ou None se esta já é a mais nova.
    fn check(&self) -> Result<Option<String>, String>;
    /// Baixa a versão encontrada, avisando o andamento (0 a 100).
    fn download(&self, on_progress: &(dyn Fn(f64) + Sync)) -> Result<(), String>;
    /// Fecha o app, instala a versão baixada e abre de novo.
    fn install(&self);
}

pub struct UpdateOptions {
    /// None quando o app não se atualiza (rodando pelo npm run dev:tauri).
    pub updater: Option<Box<dyn Updater>>,
    /// Versão portátil: não instala nada; o botão abre a página de download.
    pub portable: bool,
    pub get_auto_check: Box<dyn Fn() -> bool + Send + Sync>,
    pub set_auto_check: Box<dyn Fn(bool) + Send + Sync>,
    pub open_download_page: Box<dyn Fn() + Send + Sync>,
    pub on_change: Box<dyn Fn(UpdateStatus) + Send + Sync>,
}

/// Onde a atualização está: a situação, a versão nova e o andamento do download.
struct Progress {
    state: UpdateState,
    version: Option<String>,
    percent: u8,
}

/// A atualização do app: procura uma versão nova (ao abrir, se a opção estiver ligada, ou quando o usuário
/// pede) e, quando ele clica em "Atualizar", baixa, instala e abre o app de novo.
pub struct UpdateService {
    options: UpdateOptions,
    progress: Mutex<Progress>,
}

impl UpdateService {
    pub fn new(options: UpdateOptions) -> UpdateService {
        let state = if options.updater.is_some() { UpdateState::Idle } else { UpdateState::Unsupported };
        UpdateService { options, progress: Mutex::new(Progress { state, version: None, percent: 0 }) }
    }

    pub fn status(&self) -> UpdateStatus {
        self.status_of(&self.progress.lock().unwrap_or_else(PoisonError::into_inner))
    }

    fn status_of(&self, progress: &Progress) -> UpdateStatus {
        UpdateStatus {
            state: progress.state,
            version: progress.version.clone(),
            percent: progress.percent,
            portable: self.options.portable,
            auto_check: (self.options.get_auto_check)(),
        }
    }

    /// Muda a situação e avisa a tela. `change` devolve false quando não há nada para mudar (nem avisar).
    fn update(&self, change: impl FnOnce(&mut Progress) -> bool) -> bool {
        let status = {
            let mut progress = self.progress.lock().unwrap_or_else(PoisonError::into_inner);
            if !change(&mut progress) {
                return false;
            }
            self.status_of(&progress)
        };
        (self.options.on_change)(status);
        true
    }

    /// Procura uma versão nova (se já estiver procurando ou baixando, não faz nada).
    pub fn check(&self) {
        let Some(updater) = &self.options.updater else { return };
        let started = self.update(|progress| {
            let busy = matches!(progress.state, UpdateState::Checking | UpdateState::Downloading | UpdateState::Ready);
            if !busy {
                progress.state = UpdateState::Checking;
            }
            !busy
        });
        if !started {
            return;
        }
        let result = updater.check();
        self.update(|progress| {
            match result {
                Ok(Some(version)) => (progress.state, progress.version) = (UpdateState::Available, Some(version)),
                Ok(None) => (progress.state, progress.version) = (UpdateState::Latest, None),
                Err(error) => {
                    eprintln!("[atualização] não deu para procurar: {error}");
                    progress.state = UpdateState::Error;
                }
            }
            true
        });
    }

    /// Ao abrir o app: procura, se a opção estiver ligada.
    pub fn check_on_startup(&self) {
        if (self.options.get_auto_check)() {
            self.check();
        }
    }

    pub fn set_auto_check(&self, enabled: bool) {
        (self.options.set_auto_check)(enabled);
        (self.options.on_change)(self.status());
    }

    /// Instala a versão encontrada: baixa, fecha, instala e abre de novo. Na portátil, abre a página de
    /// download.
    pub fn install(&self) {
        let Some(updater) = &self.options.updater else { return };
        if self.options.portable {
            if self.status().state == UpdateState::Available {
                (self.options.open_download_page)();
            }
            return;
        }
        let started = self.update(|progress| {
            let available = progress.state == UpdateState::Available;
            if available {
                (progress.state, progress.percent) = (UpdateState::Downloading, 0);
            }
            available
        });
        if !started {
            return;
        }
        // Só avisa quando o número inteiro muda (os pedaços do download chegam aos milhares).
        let result = updater.download(&|percent| {
            let percent = percent.round().clamp(0.0, 100.0) as u8;
            self.update(|progress| {
                let changed = progress.percent != percent;
                progress.percent = percent;
                changed
            });
        });
        if let Err(error) = result {
            eprintln!("[atualização] não deu para baixar: {error}");
            self.update(|progress| {
                progress.state = UpdateState::Error;
                true
            });
            return;
        }
        self.update(|progress| {
            (progress.state, progress.percent) = (UpdateState::Ready, 100);
            true
        });
        updater.install();
    }
}

/// Liga a atualização do app e, 5 segundos depois de abrir, procura uma versão nova (se a opção estiver
/// ligada). Quem procura: o atualizador do Tauri no app de verdade (instalado ou portátil); um de mentira
/// nos testes (PLAYTROVE_FAKE_UPDATE, nunca a internet); e ninguém no npm run dev:tauri.
pub fn start(app: &AppHandle) {
    let updater: Option<Box<dyn Updater>> = match &test_mode().fake_update {
        Some(version) => Some(Box::new(FakeUpdater { version: version.clone() })),
        None if cfg!(debug_assertions) => None,
        None => Some(Box::new(TauriUpdater { app: app.clone(), found: Mutex::new(None), downloaded: Mutex::new(None) })),
    };
    let (get_handle, set_handle, open_handle, emit_handle) = (app.clone(), app.clone(), app.clone(), app.clone());
    app.manage(UpdateService::new(UpdateOptions {
        updater,
        portable: is_portable(),
        get_auto_check: Box::new(move || {
            let state = get_handle.state::<AppState>();
            get_setting(&state.db(), AUTO_CHECK_SETTING).ok().flatten().as_deref() != Some("0")
        }),
        set_auto_check: Box::new(move |enabled| {
            let state = set_handle.state::<AppState>();
            let _ = set_setting(&state.db(), AUTO_CHECK_SETTING, if enabled { None } else { Some("0") });
        }),
        open_download_page: Box::new(move || {
            if let Some(url) = external_link("releases") {
                open_in_browser(&open_handle, url);
            }
        }),
        on_change: Box::new(move |status| {
            let _ = emit_handle.emit(UPDATES_STATUS_EVENT, status);
        }),
    }));

    let handle = app.clone();
    let delay = if test_mode().fake_update.is_some() { Duration::ZERO } else { STARTUP_CHECK_DELAY };
    thread::spawn(move || {
        thread::sleep(delay);
        handle.state::<UpdateService>().check_on_startup();
    });
}

/// Espera uma tarefa do atualizador do Tauri (que é assíncrona) numa linha de execução à parte: quem chama
/// pode já estar dentro de uma tarefa assíncrona (um comando), onde esperar direto não pode.
fn wait<T: Send>(task: impl FnOnce() -> T + Send) -> T {
    thread::scope(|scope| scope.spawn(task).join()).unwrap_or_else(|panic| std::panic::resume_unwind(panic))
}

/// O atualizador do Tauri: lê o latest.json da última release, baixa o instalador, confere a assinatura e
/// instala sem perguntar nada (só com a barra de progresso), abrindo o app de novo no fim.
struct TauriUpdater {
    app: AppHandle,
    /// A versão encontrada pela última procura.
    found: Mutex<Option<Update>>,
    /// O instalador baixado (e com a assinatura conferida).
    downloaded: Mutex<Option<Vec<u8>>>,
}

impl Updater for TauriUpdater {
    fn check(&self) -> Result<Option<String>, String> {
        // Antes de fechar para instalar: registra o tempo dos jogos abertos (como ao fechar o app).
        let app = self.app.clone();
        let updater = self
            .app
            .updater_builder()
            .on_before_exit(move || crate::commands::finish_open_games(&app))
            .build()
            .map_err(|error| error.to_string())?;
        let update = wait(|| tauri::async_runtime::block_on(updater.check())).map_err(|error| error.to_string())?;
        let version = update.as_ref().map(|update| update.version.clone());
        *self.found.lock().unwrap_or_else(PoisonError::into_inner) = update;
        Ok(version)
    }

    fn download(&self, on_progress: &(dyn Fn(f64) + Sync)) -> Result<(), String> {
        let update = self.found.lock().unwrap_or_else(PoisonError::into_inner).clone().ok_or("nenhuma versão encontrada")?;
        let bytes = wait(|| {
            let mut received = 0;
            tauri::async_runtime::block_on(update.download(
                |chunk, total| {
                    received += chunk;
                    if let Some(total) = total.filter(|total| *total > 0) {
                        on_progress(received as f64 * 100.0 / total as f64);
                    }
                },
                || on_progress(100.0),
            ))
        })
        .map_err(|error| error.to_string())?;
        *self.downloaded.lock().unwrap_or_else(PoisonError::into_inner) = Some(bytes);
        Ok(())
    }

    fn install(&self) {
        let update = self.found.lock().unwrap_or_else(PoisonError::into_inner).clone();
        let bytes = self.downloaded.lock().unwrap_or_else(PoisonError::into_inner).take();
        if let (Some(update), Some(bytes)) = (update, bytes)
            && let Err(error) = update.install(bytes)
        {
            // Se der certo, o app fecha aqui mesmo (o instalador abre ele de novo).
            eprintln!("[atualização] não deu para instalar: {error}");
        }
    }
}

/// Nos testes: sempre há a versão dada, o download termina na hora e instalar não fecha nada.
struct FakeUpdater {
    version: String,
}

impl Updater for FakeUpdater {
    fn check(&self) -> Result<Option<String>, String> {
        Ok(Some(self.version.clone()))
    }

    fn download(&self, on_progress: &(dyn Fn(f64) + Sync)) -> Result<(), String> {
        on_progress(50.0);
        on_progress(100.0);
        Ok(())
    }

    fn install(&self) {}
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;

    /// O que a procura de mentira responde (recebe quantas vezes já procurou).
    type FakeCheck = Box<dyn Fn(usize) -> Result<Option<String>, String> + Send + Sync>;

    /// Um atualizador de mentira que conta as chamadas: acha a 0.6.0 e baixa na hora.
    #[derive(Default)]
    struct Calls {
        checks: AtomicUsize,
        installs: AtomicUsize,
    }

    struct Fake {
        calls: Arc<Calls>,
        check: FakeCheck,
        download_fails: bool,
    }

    impl Updater for Fake {
        fn check(&self) -> Result<Option<String>, String> {
            let call = self.calls.checks.fetch_add(1, Ordering::SeqCst);
            (self.check)(call)
        }

        fn download(&self, on_progress: &(dyn Fn(f64) + Sync)) -> Result<(), String> {
            if self.download_fails {
                return Err("caiu a internet".to_string());
            }
            on_progress(33.4);
            on_progress(33.6);
            on_progress(100.0);
            Ok(())
        }

        fn install(&self) {
            self.calls.installs.fetch_add(1, Ordering::SeqCst);
        }
    }

    struct Setup {
        service: UpdateService,
        calls: Arc<Calls>,
        changes: Arc<Mutex<Vec<UpdateStatus>>>,
        opened: Arc<AtomicUsize>,
    }

    impl Setup {
        fn states(&self) -> Vec<UpdateState> {
            self.changes.lock().unwrap().iter().map(|status| status.state).collect()
        }
    }

    fn found(version: &str) -> FakeCheck {
        let version = version.to_string();
        Box::new(move |_| Ok(Some(version.clone())))
    }

    fn setup_with(check: Option<FakeCheck>, download_fails: bool, portable: bool) -> Setup {
        let calls = Arc::new(Calls::default());
        let changes = Arc::new(Mutex::new(Vec::new()));
        let opened = Arc::new(AtomicUsize::new(0));
        let auto_check = Arc::new(AtomicBool::new(true));
        let updater = check.map(|check| Box::new(Fake { calls: Arc::clone(&calls), check, download_fails }) as Box<dyn Updater>);
        let (get, set, recorded, open) = (Arc::clone(&auto_check), auto_check, Arc::clone(&changes), Arc::clone(&opened));
        let service = UpdateService::new(UpdateOptions {
            updater,
            portable,
            get_auto_check: Box::new(move || get.load(Ordering::SeqCst)),
            set_auto_check: Box::new(move |enabled| set.store(enabled, Ordering::SeqCst)),
            open_download_page: Box::new(move || {
                open.fetch_add(1, Ordering::SeqCst);
            }),
            on_change: Box::new(move |status| recorded.lock().unwrap().push(status)),
        });
        Setup { service, calls, changes, opened }
    }

    fn setup() -> Setup {
        setup_with(Some(found("0.6.0")), false, false)
    }

    #[test]
    fn rodando_pelo_codigo_fonte_nao_procura_nada() {
        let setup = setup_with(None, false, false);
        setup.service.check();
        setup.service.install();
        assert_eq!(setup.service.status().state, UpdateState::Unsupported);
        assert!(setup.changes.lock().unwrap().is_empty());
    }

    #[test]
    fn acha_a_versao_nova() {
        let setup = setup();
        setup.service.check();
        assert_eq!(setup.states(), [UpdateState::Checking, UpdateState::Available]);
        assert_eq!(
            setup.service.status(),
            UpdateStatus {
                state: UpdateState::Available,
                version: Some("0.6.0".to_string()),
                percent: 0,
                portable: false,
                auto_check: true
            }
        );
    }

    #[test]
    fn ja_na_versao_mais_nova() {
        let setup = setup_with(Some(Box::new(|_| Ok(None))), false, false);
        setup.service.check();
        assert_eq!((setup.service.status().state, setup.service.status().version), (UpdateState::Latest, None));
    }

    #[test]
    fn sem_internet_da_erro_e_da_para_tentar_de_novo() {
        let check = Box::new(|call| if call == 0 { Err("sem internet".to_string()) } else { Ok(Some("0.6.0".to_string())) });
        let setup = setup_with(Some(check), false, false);
        setup.service.check();
        assert_eq!(setup.service.status().state, UpdateState::Error);
        setup.service.check();
        assert_eq!(setup.service.status().version.as_deref(), Some("0.6.0"));
    }

    #[test]
    fn nao_procura_duas_vezes_ao_mesmo_tempo() {
        let setup = Arc::new(setup_with(
            Some(Box::new(|_| {
                thread::sleep(Duration::from_millis(100));
                Ok(Some("0.6.0".to_string()))
            })),
            false,
            false,
        ));
        let other = Arc::clone(&setup);
        let first = thread::spawn(move || other.service.check());
        thread::sleep(Duration::from_millis(20));
        setup.service.check();
        first.join().unwrap();
        assert_eq!(setup.calls.checks.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn atualizar_baixa_avisando_o_andamento_e_instala() {
        let setup = setup();
        setup.service.check();
        setup.service.install();
        let changes: Vec<(UpdateState, u8)> =
            setup.changes.lock().unwrap().iter().skip(2).map(|status| (status.state, status.percent)).collect();
        assert_eq!(
            changes,
            [
                (UpdateState::Downloading, 0),
                (UpdateState::Downloading, 33),
                (UpdateState::Downloading, 34),
                (UpdateState::Downloading, 100),
                (UpdateState::Ready, 100)
            ]
        );
        assert_eq!(setup.calls.installs.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn se_o_download_falhar_nao_instala_nada() {
        let setup = setup_with(Some(found("0.6.0")), true, false);
        setup.service.check();
        setup.service.install();
        assert_eq!(setup.service.status().state, UpdateState::Error);
        assert_eq!(setup.calls.installs.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn na_versao_portatil_o_botao_abre_a_pagina_de_download() {
        let setup = setup_with(Some(found("0.6.0")), false, true);
        setup.service.check();
        setup.service.install();
        assert_eq!(setup.opened.load(Ordering::SeqCst), 1);
        assert_eq!((setup.service.status().state, setup.service.status().portable), (UpdateState::Available, true));
        assert_eq!(setup.calls.installs.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn sem_versao_nova_encontrada_atualizar_nao_faz_nada() {
        let setup = setup();
        setup.service.install();
        assert_eq!(setup.service.status().state, UpdateState::Idle);
        assert_eq!(setup.calls.installs.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn ao_abrir_so_procura_com_a_opcao_ligada() {
        let setup = setup();
        setup.service.set_auto_check(false);
        assert!(!setup.changes.lock().unwrap().last().unwrap().auto_check);
        setup.service.check_on_startup();
        assert_eq!(setup.calls.checks.load(Ordering::SeqCst), 0);

        setup.service.set_auto_check(true);
        setup.service.check_on_startup();
        assert_eq!(setup.calls.checks.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_tela_recebe_os_nomes_de_sempre() {
        let json = serde_json::to_value(setup().service.status()).unwrap();
        assert_eq!(json["state"], "idle");
        assert_eq!(json["autoCheck"], true);
    }
}
