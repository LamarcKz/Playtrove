//! Abre um jogo no emulador dele e conta o tempo até o emulador fechar: os jogos abertos ficam na
//! memória, e o emulador abre separado do app (fechar o app não fecha o jogo).

use std::collections::{HashMap, HashSet};
use std::io;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::Serialize;

use crate::dates::iso;
use crate::emulator_window::maximize_window;
use crate::emulators::{build_launch_command, get_emulator_paths, get_preset};
use crate::errors::{AppError, AppResult};
use crate::game_window::{GameProcessControl, SessionControlError, control_for_child};
use crate::i18n::Language;
use crate::library::get_launch_info;

/// Um programa aberto pelo app (o emulador; os testes usam um de mentira).
pub trait RunningProcess: Send {
    fn id(&self) -> u32;
    /// Espera o programa fechar.
    fn wait(&mut self);
    /// Controle preso à identidade original, independente da espera bloqueante pelo encerramento.
    fn control(&self) -> io::Result<Arc<dyn GameProcessControl>>;
}

/// Quem abre os programas (o Windows; os testes trocam por um de mentira).
pub trait Starter {
    fn start(&self, command: &str, args: &[String], cwd: &Path) -> io::Result<Box<dyn RunningProcess>>;
}

/// Abre os programas de verdade, separados do app: se o app fechar, o jogo continua.
pub struct SystemStarter;

impl Starter for SystemStarter {
    fn start(&self, command: &str, args: &[String], cwd: &Path) -> io::Result<Box<dyn RunningProcess>> {
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: o emulador não depende do app.
        const DETACHED: u32 = 0x0000_0008 | 0x0000_0200;
        let child = Command::new(command)
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(DETACHED)
            .spawn()?;
        Ok(Box::new(child))
    }
}

impl RunningProcess for Child {
    fn id(&self) -> u32 {
        Child::id(self)
    }

    fn wait(&mut self) {
        let _ = Child::wait(self);
    }

    fn control(&self) -> io::Result<Arc<dyn GameProcessControl>> {
        control_for_child(self)
    }
}

/// Uma vez que o jogo foi jogado: quanto tempo e quando terminou.
#[derive(Debug, PartialEq)]
pub struct PlayedSession {
    pub game_id: i64,
    pub seconds: f64,
    pub ended_at: DateTime<Utc>,
}

/// Dados públicos da sessão; o handle que a identifica nunca sai do Rust.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningSession {
    pub game_id: i64,
    pub process_id: u32,
    pub started_at: String,
    pub can_control: bool,
}

struct ProcessSession {
    started_at: DateTime<Utc>,
    process_id: u32,
    control: Option<Arc<dyn GameProcessControl>>,
}

/// Comando validado e independente do guard do banco; não cria processo nem janela ao preparar.
#[derive(Debug)]
pub struct PreparedLaunch {
    game_id: i64,
    language: Language,
    emulator_name: &'static str,
    emulator_path: String,
    rom_path: String,
    command: String,
    args: Vec<String>,
    cwd: PathBuf,
    maximize: bool,
}

impl PreparedLaunch {
    fn validate_files(&self) -> AppResult<()> {
        if !Path::new(&self.emulator_path).exists() {
            return Err(AppError::text(self.language, "errors.emulatorNotFound", &[self.emulator_name]));
        }
        if !Path::new(&self.rom_path).exists() {
            return Err(AppError::text(self.language, "errors.romNotFound", &[&self.rom_path]));
        }
        Ok(())
    }
}

/// Só reserva o ID; nenhum mutex permanece trancado durante o callback que pode criar uma janela.
struct LaunchReservation<'a> {
    launching: &'a Mutex<HashSet<i64>>,
    game_id: i64,
}
impl Drop for LaunchReservation<'_> {
    fn drop(&mut self) {
        self.launching.lock().unwrap_or_else(PoisonError::into_inner).remove(&self.game_id);
    }
}

/// O relógio (os testes passam um de mentira, para "passar o tempo").
pub type Clock = Arc<dyn Fn() -> DateTime<Utc> + Send + Sync>;

/// Os jogos abertos agora: id do jogo → início e identidade original do processo.
pub struct Launcher {
    sessions: Arc<Mutex<HashMap<i64, ProcessSession>>>,
    clock: Clock,
    launching: Mutex<HashSet<i64>>,
}

impl Launcher {
    pub fn new(clock: Clock) -> Launcher {
        Launcher { sessions: Arc::default(), clock, launching: Mutex::default() }
    }

    /// Ids dos jogos abertos agora.
    pub fn running(&self) -> Vec<i64> {
        let mut ids: Vec<i64> = self.sessions.lock().unwrap_or_else(PoisonError::into_inner).keys().copied().collect();
        ids.sort();
        ids
    }

    pub fn running_sessions(&self) -> Vec<RunningSession> {
        let mut sessions: Vec<_> = self
            .sessions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .map(|(&game_id, session)| RunningSession {
                game_id,
                process_id: session.process_id,
                started_at: iso(session.started_at),
                can_control: session.control.as_ref().is_some_and(|control| control.is_running()),
            })
            .collect();
        sessions.sort_by_key(|session| session.game_id);
        sessions
    }

    pub fn resume_game(&self, game_id: i64) -> Result<(), SessionControlError> {
        self.session_control(game_id)?.resume()
    }

    pub fn request_close(&self, game_id: i64) -> Result<(), SessionControlError> {
        self.session_control(game_id)?.request_close()
    }

    pub(crate) fn session_control(&self, game_id: i64) -> Result<Arc<dyn GameProcessControl>, SessionControlError> {
        let sessions = self.sessions.lock().unwrap_or_else(PoisonError::into_inner);
        let session = sessions.get(&game_id).ok_or(SessionControlError::NotRunning)?;
        let control = session.control.clone().ok_or(SessionControlError::ControlUnavailable)?;
        if !control.is_running() {
            return Err(SessionControlError::NotRunning);
        }
        Ok(control)
    }

    /// Abre um jogo no emulador dele e, numa linha de execução à parte, espera o emulador fechar; aí chama
    /// `on_exit` com a sessão (quem chama registra o tempo jogado). Devolve um erro claro quando não dá
    /// para abrir.
    #[allow(dead_code)]
    pub fn launch(
        &self,
        db: &Connection,
        language: Language,
        game_id: i64,
        starter: &dyn Starter,
        on_exit: Box<dyn FnOnce(PlayedSession) + Send>,
    ) -> AppResult<()> {
        let prepared = self.prepare(db, language, game_id)?;
        self.launch_prepared(prepared, starter, || {}, on_exit)
    }

    /// Resolve banco, preset e caminhos antes de qualquer callback de interface. O resultado possui
    /// seus próprios dados e pode ser usado depois que o chamador soltar o guard do banco.
    pub fn prepare(&self, db: &Connection, language: Language, game_id: i64) -> AppResult<PreparedLaunch> {
        let error = |key: &str, values: &[&str]| AppError::text(language, &format!("errors.{key}"), values);
        let launching = self.launching.lock().unwrap_or_else(PoisonError::into_inner);
        if launching.contains(&game_id) || self.sessions.lock().unwrap_or_else(PoisonError::into_inner).contains_key(&game_id) {
            return Err(error("alreadyRunning", &[]));
        }
        drop(launching);
        let game = get_launch_info(db, language, game_id)?;
        let (Some(rom_path), Some(emulator)) = (game.rom_path, game.emulator) else {
            return Err(error("notFromRomFolder", &[]));
        };
        let preset = get_preset(emulator);
        let emulator_path = get_emulator_paths(db)?.remove(&emulator).filter(|path| Path::new(path).exists());
        let Some(emulator_path) = emulator_path else {
            return Err(error("emulatorNotFound", &[preset.name]));
        };
        if !Path::new(&rom_path).exists() {
            return Err(error("romNotFound", &[&rom_path]));
        }

        let (command, args) = build_launch_command(emulator, &emulator_path, &rom_path, game.core.as_deref());
        let cwd = Path::new(&command).parent().unwrap_or(Path::new(".")).to_path_buf();
        Ok(PreparedLaunch {
            game_id,
            language,
            emulator_name: preset.name,
            emulator_path,
            rom_path,
            command,
            args,
            cwd,
            maximize: preset.maximize,
        })
    }

    /// Reserva contra spawns concorrentes, libera todas as travas e só então chama `before_start`.
    /// Erros ou panic do callback liberam a reserva; a sessão só começa após o spawn real.
    #[allow(dead_code)]
    pub fn launch_prepared(
        &self,
        prepared: PreparedLaunch,
        starter: &dyn Starter,
        before_start: impl FnOnce(),
        on_exit: Box<dyn FnOnce(PlayedSession) + Send>,
    ) -> AppResult<()> {
        self.launch_prepared_with_control(prepared, starter, before_start, on_exit).map(|_| ())
    }

    /// Devolve a identidade capturada deste Child, mesmo se ele terminar antes de o chamador
    /// associar o splash. Nunca relê outra sessão posterior com o mesmo ID de jogo.
    pub fn launch_prepared_with_control(
        &self,
        prepared: PreparedLaunch,
        starter: &dyn Starter,
        before_start: impl FnOnce(),
        on_exit: Box<dyn FnOnce(PlayedSession) + Send>,
    ) -> AppResult<Option<Arc<dyn GameProcessControl>>> {
        let game_id = prepared.game_id;
        {
            let mut launching = self.launching.lock().unwrap_or_else(PoisonError::into_inner);
            if launching.contains(&game_id) || self.sessions.lock().unwrap_or_else(PoisonError::into_inner).contains_key(&game_id)
            {
                return Err(AppError::text(prepared.language, "errors.alreadyRunning", &[]));
            }
            launching.insert(game_id);
        }
        let reservation = LaunchReservation { launching: &self.launching, game_id };
        prepared.validate_files()?;
        before_start();
        let mut process = starter.start(&prepared.command, &prepared.args, &prepared.cwd).map_err(|failure| {
            AppError::text(prepared.language, "errors.launchFailed", &[prepared.emulator_name, &failure.to_string()])
        })?;
        let process_id = process.id();
        // Falha ao preparar o controle não perde um processo que já foi aberto: a sessão continua
        // contando o tempo, apenas sem comandos de janela. Nunca há um fallback por busca de PID.
        let control = process.control().ok().filter(|control| control.process_id() == process_id);
        let launched_control = control.clone();
        self.sessions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(game_id, ProcessSession { started_at: (self.clock)(), process_id, control });
        drop(reservation);
        // Emulador que abre maximizado (ex.: o RetroArch): a janela dele é maximizada quando aparecer.
        if prepared.maximize {
            maximize_window(process.id());
        }

        let sessions = Arc::clone(&self.sessions);
        let clock = Arc::clone(&self.clock);
        thread::spawn(move || {
            process.wait();
            let session = sessions.lock().unwrap_or_else(PoisonError::into_inner).remove(&game_id);
            // Sem a sessão, o tempo já foi registrado (o app fechou com o jogo aberto).
            if let Some(session) = session {
                let ended_at = clock();
                on_exit(PlayedSession { game_id, seconds: seconds_between(session.started_at, ended_at), ended_at });
            }
        });
        Ok(launched_control)
    }

    /// Ao fechar o app com jogos abertos: as sessões até agora (os emuladores continuam abertos).
    pub fn finish_all(&self) -> Vec<PlayedSession> {
        let now = (self.clock)();
        let mut sessions = self.sessions.lock().unwrap_or_else(PoisonError::into_inner);
        sessions
            .drain()
            .map(|(game_id, session)| PlayedSession { game_id, seconds: seconds_between(session.started_at, now), ended_at: now })
            .collect()
    }
}

fn seconds_between(start: DateTime<Utc>, end: DateTime<Utc>) -> f64 {
    (end - start).num_milliseconds() as f64 / 1000.0
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{Receiver, Sender, channel};
    use std::time::Duration;

    use super::*;
    use crate::emulators::{EmulatorId, set_emulator_path};
    use crate::game_window::{GameProcessControl, SessionControlError};
    use crate::library::{EmulatedGame, add_emulated_game};
    use crate::test_support::{create_files, memory_database, temp_folder};

    const PT: Language = Language::PtBr;

    /// Um programa de mentira: fecha quando o teste mandar.
    struct FakeProcess {
        closed: Receiver<()>,
        control: Arc<FakeControl>,
        control_failure: bool,
    }

    struct FakeControl {
        alive: AtomicBool,
        actions: Mutex<Vec<&'static str>>,
    }

    impl GameProcessControl for FakeControl {
        fn process_id(&self) -> u32 {
            4242
        }
        fn is_running(&self) -> bool {
            self.alive.load(Ordering::SeqCst)
        }
        fn resume(&self) -> Result<(), SessionControlError> {
            self.actions.lock().unwrap().push("resume");
            Ok(())
        }
        fn request_close(&self) -> Result<(), SessionControlError> {
            self.actions.lock().unwrap().push("close");
            Ok(())
        }
    }

    impl RunningProcess for FakeProcess {
        fn id(&self) -> u32 {
            4242
        }
        fn wait(&mut self) {
            let _ = self.closed.recv();
            self.control.alive.store(false, Ordering::SeqCst);
        }
        fn control(&self) -> io::Result<Arc<dyn GameProcessControl>> {
            if self.control_failure { Err(io::Error::other("handle indisponível")) } else { Ok(self.control.clone()) }
        }
    }

    /// Guarda o que pediram para abrir e devolve programas de mentira (ou o erro dado).
    #[derive(Default)]
    struct FakeStarter {
        calls: Mutex<Vec<(String, Vec<String>, String)>>,
        closers: Mutex<Vec<Sender<()>>>,
        controls: Mutex<Vec<Arc<FakeControl>>>,
        control_failure: bool,
        failure: Option<String>,
    }

    impl Starter for FakeStarter {
        fn start(&self, command: &str, args: &[String], cwd: &Path) -> io::Result<Box<dyn RunningProcess>> {
            self.calls.lock().unwrap().push((command.to_string(), args.to_vec(), cwd.to_string_lossy().into_owned()));
            if let Some(failure) = &self.failure {
                return Err(io::Error::other(failure.clone()));
            }
            let (close, closed) = channel();
            self.closers.lock().unwrap().push(close);
            let control = Arc::new(FakeControl { alive: AtomicBool::new(true), actions: Mutex::default() });
            self.controls.lock().unwrap().push(control.clone());
            Ok(Box::new(FakeProcess { closed, control, control_failure: self.control_failure }))
        }
    }

    /// Um relógio parado, que o teste adianta.
    fn fake_clock() -> (Clock, Arc<Mutex<DateTime<Utc>>>) {
        let now = Arc::new(Mutex::new(DateTime::parse_from_rfc3339("2026-09-19T20:00:00.000Z").unwrap().with_timezone(&Utc)));
        let shared = Arc::clone(&now);
        (Arc::new(move || *shared.lock().unwrap()), now)
    }

    /// Um PCSX2 e uma ROM de mentira, e o jogo na biblioteca.
    fn setup_game(db: &Connection, name: &str) -> (String, String, i64) {
        let root = temp_folder(name);
        create_files(&root, &[("PCSX2/pcsx2-qt.exe", ""), ("Roms/Salto Estelar.iso", "")]);
        let exe = root.join("PCSX2").join("pcsx2-qt.exe").to_string_lossy().into_owned();
        let rom = root.join("Roms").join("Salto Estelar.iso").to_string_lossy().into_owned();
        set_emulator_path(db, EmulatorId::Pcsx2, &exe).unwrap();
        let game = EmulatedGame {
            title: "Salto Estelar",
            rom_path: &rom,
            platform: "PlayStation 2",
            library: "PCSX2",
            emulator: EmulatorId::Pcsx2,
            core: None,
        };
        let id = add_emulated_game(db, PT, &game).unwrap().unwrap();
        (exe, rom, id)
    }

    #[test]
    fn abre_o_emulador_com_a_rom_e_conta_o_tempo_ate_ele_fechar() {
        let db = memory_database();
        let (exe, rom, game_id) = setup_game(&db, "jogar");
        let (clock, now) = fake_clock();
        let launcher = Launcher::new(clock);
        let starter = FakeStarter::default();
        let (ended, sessions) = channel();

        launcher.launch(&db, PT, game_id, &starter, Box::new(move |session| ended.send(session).unwrap())).unwrap();
        let folder = Path::new(&exe).parent().unwrap().to_string_lossy().into_owned();
        assert_eq!(
            *starter.calls.lock().unwrap(),
            [(exe.clone(), vec!["-batch".to_string(), "--".to_string(), rom.clone()], folder)]
        );
        assert_eq!(launcher.running(), [game_id]);
        let again = launcher.launch(&db, PT, game_id, &starter, Box::new(|_| ()));
        assert_eq!(again.unwrap_err().to_string(), "Esse jogo já está aberto.");

        *now.lock().unwrap() += chrono::Duration::minutes(42);
        starter.closers.lock().unwrap()[0].send(()).unwrap();
        let session = sessions.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(session.game_id, game_id);
        assert_eq!(session.seconds, 42.0 * 60.0);
        assert!(launcher.running().is_empty());
    }

    #[test]
    fn fechar_o_app_com_o_jogo_aberto_registra_o_tempo_ate_ali_uma_vez_so() {
        let db = memory_database();
        let (_, _, game_id) = setup_game(&db, "fechar-app");
        let (clock, now) = fake_clock();
        let launcher = Launcher::new(clock);
        let starter = FakeStarter::default();
        let (ended, sessions) = channel();
        launcher.launch(&db, PT, game_id, &starter, Box::new(move |session| ended.send(session).unwrap())).unwrap();

        *now.lock().unwrap() += chrono::Duration::minutes(20);
        let finished = launcher.finish_all();
        assert_eq!(finished.len(), 1);
        assert_eq!(finished[0].seconds, 20.0 * 60.0);
        assert!(launcher.running().is_empty());

        // O emulador fecha depois: o tempo não conta de novo.
        starter.closers.lock().unwrap()[0].send(()).unwrap();
        assert!(sessions.recv_timeout(Duration::from_millis(500)).is_err());
    }

    #[test]
    fn avisa_quando_o_emulador_nao_abre() {
        let db = memory_database();
        let (_, _, game_id) = setup_game(&db, "nao-abre");
        let launcher = Launcher::new(fake_clock().0);
        let starter = FakeStarter { failure: Some("acesso negado".into()), ..Default::default() };
        let error = launcher.launch(&db, PT, game_id, &starter, Box::new(|_| ())).unwrap_err().to_string();
        assert_eq!(error, "Não deu para abrir o PCSX2: acesso negado");
        assert!(launcher.running().is_empty());
    }

    #[test]
    fn mensagens_claras_quando_falta_algo() {
        let db = memory_database();
        let (exe, rom, game_id) = setup_game(&db, "falta-algo");
        let launcher = Launcher::new(fake_clock().0);
        let starter = FakeStarter::default();
        let error = |db: &Connection| launcher.launch(db, PT, game_id, &starter, Box::new(|_| ())).unwrap_err().to_string();

        // Sem o emulador configurado.
        db.execute("DELETE FROM emulators", []).unwrap();
        assert_eq!(error(&db), "O PCSX2 não foi encontrado. Configure ele na aba Emuladores.");

        // ROM apagada.
        set_emulator_path(&db, EmulatorId::Pcsx2, &exe).unwrap();
        let gone = Path::new(&rom).with_file_name("sumiu.iso").to_string_lossy().into_owned();
        db.execute("UPDATE games SET rom_path = ?1 WHERE id = ?2", (&gone, game_id)).unwrap();
        assert!(error(&db).contains("A ROM não foi encontrada"));

        // Jogo sem ROM (ex.: de outra biblioteca, no futuro).
        db.execute("UPDATE games SET rom_path = NULL, emulator_id = NULL WHERE id = ?1", [game_id]).unwrap();
        assert!(error(&db).contains("Esse jogo não tem ROM"));
        assert!(starter.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn sessao_publica_identifica_o_processo_iniciado_e_pede_fechamento_sem_finaliza_la() {
        let db = memory_database();
        let (_, _, game_id) = setup_game(&db, "sessao-controle");
        let (clock, now) = fake_clock();
        let launcher = Launcher::new(clock);
        let starter = FakeStarter::default();
        let (ended, sessions) = channel();
        launcher.launch(&db, PT, game_id, &starter, Box::new(move |session| ended.send(session).unwrap())).unwrap();
        assert_eq!(
            serde_json::to_value(launcher.running_sessions()).unwrap(),
            serde_json::json!([{"gameId": game_id, "processId": 4242, "startedAt": "2026-09-19T20:00:00.000Z", "canControl": true}])
        );

        launcher.resume_game(game_id).unwrap();
        launcher.request_close(game_id).unwrap();
        assert_eq!(*starter.controls.lock().unwrap()[0].actions.lock().unwrap(), ["resume", "close"]);
        assert_eq!(launcher.running(), [game_id]);
        assert!(sessions.try_recv().is_err());

        *now.lock().unwrap() += chrono::Duration::minutes(10);
        starter.closers.lock().unwrap()[0].send(()).unwrap();
        assert_eq!(sessions.recv_timeout(Duration::from_secs(5)).unwrap().seconds, 600.0);
        assert!(launcher.running_sessions().is_empty());
        assert_eq!(launcher.resume_game(game_id), Err(SessionControlError::NotRunning));
    }

    #[test]
    fn pid_igual_nao_autoriza_controlar_outra_identidade_de_processo() {
        let db = memory_database();
        let (_, _, game_id) = setup_game(&db, "sessao-identidade");
        let launcher = Launcher::new(fake_clock().0);
        let starter = FakeStarter::default();
        launcher.launch(&db, PT, game_id, &starter, Box::new(|_| ())).unwrap();
        let original = starter.controls.lock().unwrap()[0].clone();
        original.alive.store(false, Ordering::SeqCst);
        // Outra identidade pode apresentar o mesmo número; ela nunca substitui o handle da sessão.
        let other = FakeControl { alive: AtomicBool::new(true), actions: Mutex::default() };
        assert_eq!(original.process_id(), other.process_id());
        assert_eq!(launcher.resume_game(game_id), Err(SessionControlError::NotRunning));
        assert_eq!(launcher.request_close(game_id), Err(SessionControlError::NotRunning));
        assert!(!launcher.running_sessions()[0].can_control);
        assert!(original.actions.lock().unwrap().is_empty());
        assert!(other.actions.lock().unwrap().is_empty());
        starter.closers.lock().unwrap()[0].send(()).unwrap();
    }

    #[test]
    fn comando_exige_uma_sessao_iniciada_pelo_app() {
        let launcher = Launcher::new(fake_clock().0);
        assert_eq!(launcher.resume_game(77), Err(SessionControlError::NotRunning));
        assert_eq!(launcher.request_close(77), Err(SessionControlError::NotRunning));
    }

    #[test]
    fn falha_ao_copiar_o_handle_preserva_a_sessao_e_o_tempo_jogado() {
        let db = memory_database();
        let (_, _, game_id) = setup_game(&db, "sessao-sem-handle");
        let (clock, now) = fake_clock();
        let launcher = Launcher::new(clock);
        let starter = FakeStarter { control_failure: true, ..Default::default() };
        let (ended, sessions) = channel();
        launcher.launch(&db, PT, game_id, &starter, Box::new(move |session| ended.send(session).unwrap())).unwrap();
        assert_eq!(launcher.running(), [game_id]);
        assert!(!launcher.running_sessions()[0].can_control);
        assert_eq!(launcher.resume_game(game_id), Err(SessionControlError::ControlUnavailable));
        assert_eq!(launcher.request_close(game_id), Err(SessionControlError::ControlUnavailable));
        *now.lock().unwrap() += chrono::Duration::minutes(2);
        starter.closers.lock().unwrap()[0].send(()).unwrap();
        assert_eq!(sessions.recv_timeout(Duration::from_secs(5)).unwrap().seconds, 120.0);
    }

    #[test]
    fn prepara_sem_spawn_e_chama_hook_antes_do_starter_sem_travar_consultas() {
        let db = memory_database();
        let (_, _, game_id) = setup_game(&db, "preparar-lancamento");
        let launcher = Launcher::new(fake_clock().0);
        let starter = FakeStarter::default();
        let prepared = launcher.prepare(&db, PT, game_id).unwrap();
        assert!(starter.calls.lock().unwrap().is_empty());
        launcher
            .launch_prepared(
                prepared,
                &starter,
                || {
                    assert!(launcher.running().is_empty());
                    assert!(launcher.running_sessions().is_empty());
                    assert!(starter.calls.lock().unwrap().is_empty());
                },
                Box::new(|_| ()),
            )
            .unwrap();
        assert_eq!(starter.calls.lock().unwrap().len(), 1);
        assert_eq!(launcher.running(), [game_id]);
        starter.closers.lock().unwrap()[0].send(()).unwrap();
    }

    #[test]
    fn arquivo_removido_entre_prepare_e_spawn_nao_abre_splash() {
        let db = memory_database();
        let (_, rom, game_id) = setup_game(&db, "preparar-rom-removida");
        let launcher = Launcher::new(fake_clock().0);
        let starter = FakeStarter::default();
        let prepared = launcher.prepare(&db, PT, game_id).unwrap();
        std::fs::remove_file(rom).unwrap();
        let called = AtomicBool::new(false);
        assert!(
            launcher
                .launch_prepared(
                    prepared,
                    &starter,
                    || {
                        called.store(true, Ordering::SeqCst);
                    },
                    Box::new(|_| ())
                )
                .is_err()
        );
        assert!(!called.load(Ordering::SeqCst));
        assert!(starter.calls.lock().unwrap().is_empty());
        assert!(launcher.running().is_empty());
    }

    #[test]
    fn reserva_impede_dois_spawns_do_mesmo_id_sem_mutex_durante_hook() {
        let db = memory_database();
        let (_, _, game_id) = setup_game(&db, "preparar-concorrencia");
        let launcher = Arc::new(Launcher::new(fake_clock().0));
        let starter = Arc::new(FakeStarter::default());
        let first = launcher.prepare(&db, PT, game_id).unwrap();
        let second = launcher.prepare(&db, PT, game_id).unwrap();
        let (entered, entering) = channel();
        let (release, released) = channel();
        let first_launcher = launcher.clone();
        let first_starter = starter.clone();
        let opening = thread::spawn(move || {
            first_launcher.launch_prepared(
                first,
                first_starter.as_ref(),
                || {
                    entered.send(()).unwrap();
                    released.recv().unwrap();
                },
                Box::new(|_| ()),
            )
        });
        entering.recv_timeout(Duration::from_secs(5)).unwrap();

        let (probed, probe) = channel();
        let reading_launcher = launcher.clone();
        let reading = thread::spawn(move || {
            probed.send(reading_launcher.running()).unwrap();
        });
        let (finished, finish) = channel();
        let other_launcher = launcher.clone();
        let other_starter = starter.clone();
        let other = thread::spawn(move || {
            finished
                .send(other_launcher.launch_prepared(
                    second,
                    other_starter.as_ref(),
                    || panic!("hook duplicado"),
                    Box::new(|_| ()),
                ))
                .unwrap();
        });
        let readable = probe.recv_timeout(Duration::from_secs(1));
        let duplicate = finish.recv_timeout(Duration::from_secs(1));
        release.send(()).unwrap();
        opening.join().unwrap().unwrap();
        reading.join().unwrap();
        other.join().unwrap();
        assert!(readable.unwrap().is_empty());
        assert_eq!(duplicate.unwrap().unwrap_err().to_string(), "Esse jogo já está aberto.");
        assert_eq!(starter.calls.lock().unwrap().len(), 1);
        starter.closers.lock().unwrap()[0].send(()).unwrap();
    }

    #[test]
    fn panic_no_hook_e_falha_de_spawn_liberam_reserva_para_tentar_novamente() {
        let db = memory_database();
        let (_, _, game_id) = setup_game(&db, "preparar-falha");
        let launcher = Launcher::new(fake_clock().0);
        let starter = FakeStarter::default();
        let prepared = launcher.prepare(&db, PT, game_id).unwrap();
        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            launcher.launch_prepared(prepared, &starter, || panic!("hook fictício"), Box::new(|_| ()))
        }));
        assert!(panicked.is_err());
        let failing = FakeStarter { failure: Some("falha fictícia".into()), ..Default::default() };
        assert!(
            launcher.launch_prepared(launcher.prepare(&db, PT, game_id).unwrap(), &failing, || {}, Box::new(|_| ())).is_err()
        );
        launcher.launch_prepared(launcher.prepare(&db, PT, game_id).unwrap(), &starter, || {}, Box::new(|_| ())).unwrap();
        starter.closers.lock().unwrap()[0].send(()).unwrap();
    }

    #[test]
    fn tempo_do_hook_nao_entra_na_sessao_jogada() {
        let db = memory_database();
        let (_, _, game_id) = setup_game(&db, "preparar-tempo");
        let (clock, now) = fake_clock();
        let launcher = Launcher::new(clock);
        let starter = FakeStarter::default();
        let (ended, sessions) = channel();
        launcher
            .launch_prepared(
                launcher.prepare(&db, PT, game_id).unwrap(),
                &starter,
                || {
                    *now.lock().unwrap() += chrono::Duration::seconds(30);
                },
                Box::new(move |session| {
                    ended.send(session).unwrap();
                }),
            )
            .unwrap();
        *now.lock().unwrap() += chrono::Duration::seconds(60);
        starter.closers.lock().unwrap()[0].send(()).unwrap();
        assert_eq!(sessions.recv_timeout(Duration::from_secs(5)).unwrap().seconds, 60.0);
    }

    #[test]
    fn devolve_arc_da_sessao_iniciada_sem_lookup_que_possa_pegar_sessao_nova() {
        let db = memory_database();
        let (_, _, game_id) = setup_game(&db, "preparar-arc-original");
        let launcher = Launcher::new(fake_clock().0);
        let starter = FakeStarter::default();
        let (ended, sessions) = channel();
        let original = launcher
            .launch_prepared_with_control(
                launcher.prepare(&db, PT, game_id).unwrap(),
                &starter,
                || {},
                Box::new(move |session| {
                    ended.send(session).unwrap();
                }),
            )
            .unwrap()
            .unwrap();
        assert!(Arc::ptr_eq(&original, &launcher.session_control(game_id).unwrap()));
        starter.closers.lock().unwrap()[0].send(()).unwrap();
        sessions.recv_timeout(Duration::from_secs(5)).unwrap();
        let next = launcher
            .launch_prepared_with_control(launcher.prepare(&db, PT, game_id).unwrap(), &starter, || {}, Box::new(|_| ()))
            .unwrap()
            .unwrap();
        assert!(!Arc::ptr_eq(&original, &next));
        assert!(!original.is_running());
        assert!(next.is_running());
        starter.closers.lock().unwrap()[1].send(()).unwrap();
    }
}
