//! Abre um jogo no emulador dele e conta o tempo até o emulador fechar: os jogos abertos ficam na
//! memória, e o emulador abre separado do app (fechar o app não fecha o jogo).

use std::collections::HashMap;
use std::io;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;

use chrono::{DateTime, Utc};
use rusqlite::Connection;

use crate::emulator_window::maximize_window;
use crate::emulators::{build_launch_command, get_emulator_paths, get_preset};
use crate::errors::{AppError, AppResult};
use crate::i18n::Language;
use crate::library::get_launch_info;

/// Um programa aberto pelo app (o emulador; os testes usam um de mentira).
pub trait RunningProcess: Send {
    fn id(&self) -> u32;
    /// Espera o programa fechar.
    fn wait(&mut self);
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
}

/// Uma vez que o jogo foi jogado: quanto tempo e quando terminou.
#[derive(Debug, PartialEq)]
pub struct PlayedSession {
    pub game_id: i64,
    pub seconds: f64,
    pub ended_at: DateTime<Utc>,
}

/// O relógio (os testes passam um de mentira, para "passar o tempo").
pub type Clock = Arc<dyn Fn() -> DateTime<Utc> + Send + Sync>;

/// Os jogos abertos agora: id do jogo → quando começou.
pub struct Launcher {
    sessions: Arc<Mutex<HashMap<i64, DateTime<Utc>>>>,
    clock: Clock,
}

impl Launcher {
    pub fn new(clock: Clock) -> Launcher {
        Launcher { sessions: Arc::default(), clock }
    }

    /// Ids dos jogos abertos agora.
    pub fn running(&self) -> Vec<i64> {
        let mut ids: Vec<i64> = self.sessions.lock().unwrap_or_else(PoisonError::into_inner).keys().copied().collect();
        ids.sort();
        ids
    }

    /// Abre um jogo no emulador dele e, numa linha de execução à parte, espera o emulador fechar; aí chama
    /// `on_exit` com a sessão (quem chama registra o tempo jogado). Devolve um erro claro quando não dá
    /// para abrir.
    pub fn launch(
        &self,
        db: &Connection,
        language: Language,
        game_id: i64,
        starter: &dyn Starter,
        on_exit: Box<dyn FnOnce(PlayedSession) + Send>,
    ) -> AppResult<()> {
        let error = |key: &str, values: &[&str]| AppError::text(language, &format!("errors.{key}"), values);
        if self.sessions.lock().unwrap_or_else(PoisonError::into_inner).contains_key(&game_id) {
            return Err(error("alreadyRunning", &[]));
        }
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
        let cwd = Path::new(&command).parent().unwrap_or(Path::new("."));
        let mut process =
            starter.start(&command, &args, cwd).map_err(|failure| error("launchFailed", &[preset.name, &failure.to_string()]))?;
        self.sessions.lock().unwrap_or_else(PoisonError::into_inner).insert(game_id, (self.clock)());
        // Emulador que abre maximizado (ex.: o RetroArch): a janela dele é maximizada quando aparecer.
        if preset.maximize {
            maximize_window(process.id());
        }

        let sessions = Arc::clone(&self.sessions);
        let clock = Arc::clone(&self.clock);
        thread::spawn(move || {
            process.wait();
            let started = sessions.lock().unwrap_or_else(PoisonError::into_inner).remove(&game_id);
            // Sem a sessão, o tempo já foi registrado (o app fechou com o jogo aberto).
            if let Some(started) = started {
                let ended_at = clock();
                on_exit(PlayedSession { game_id, seconds: seconds_between(started, ended_at), ended_at });
            }
        });
        Ok(())
    }

    /// Ao fechar o app com jogos abertos: as sessões até agora (os emuladores continuam abertos).
    pub fn finish_all(&self) -> Vec<PlayedSession> {
        let now = (self.clock)();
        let mut sessions = self.sessions.lock().unwrap_or_else(PoisonError::into_inner);
        sessions
            .drain()
            .map(|(game_id, started)| PlayedSession { game_id, seconds: seconds_between(started, now), ended_at: now })
            .collect()
    }
}

fn seconds_between(start: DateTime<Utc>, end: DateTime<Utc>) -> f64 {
    (end - start).num_milliseconds() as f64 / 1000.0
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::{Receiver, Sender, channel};
    use std::time::Duration;

    use super::*;
    use crate::emulators::{EmulatorId, set_emulator_path};
    use crate::library::{EmulatedGame, add_emulated_game};
    use crate::test_support::{create_files, memory_database, temp_folder};

    const PT: Language = Language::PtBr;

    /// Um programa de mentira: fecha quando o teste mandar.
    struct FakeProcess(Receiver<()>);

    impl RunningProcess for FakeProcess {
        fn id(&self) -> u32 {
            4242
        }
        fn wait(&mut self) {
            let _ = self.0.recv();
        }
    }

    /// Guarda o que pediram para abrir e devolve programas de mentira (ou o erro dado).
    #[derive(Default)]
    struct FakeStarter {
        calls: Mutex<Vec<(String, Vec<String>, String)>>,
        closers: Mutex<Vec<Sender<()>>>,
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
            Ok(Box::new(FakeProcess(closed)))
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
}
