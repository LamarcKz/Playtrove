//! Acompanha o tempo jogado nos emuladores: lê os registros deles ao abrir o app, a cada minuto e
//! sempre que pedirem (ex.: logo depois de um jogo fechar), numa linha de execução à parte. O mesmo do
//! app em Electron (src/main/playtimeSync.ts).

use std::sync::Mutex;
use std::sync::mpsc::{RecvTimeoutError, Sender, channel};
use std::thread;
use std::time::Duration;

use chrono::Utc;
use tauri::{AppHandle, Manager};

use crate::emulator_playtime::{PlaytimeFolders, find_playtime_files, read_emulator_records, sync_emulator_playtime};
use crate::emulators::get_emulator_paths;
use crate::state::AppState;
use crate::test_mode::test_mode;

/// De quanto em quanto tempo o app relê os registros de tempo dos emuladores.
const SYNC_INTERVAL: Duration = Duration::from_secs(60);

/// Quanto o app espera, depois de o jogo fechar, para reler o tempo registrado pelo emulador (ele grava o
/// dele ao fechar).
pub const AFTER_GAME_DELAY: Duration = Duration::from_secs(3);

/// Pede uma leitura fora de hora à linha de execução que lê os registros.
pub struct PlaytimeSync(Mutex<Sender<()>>);

impl PlaytimeSync {
    /// Começa a acompanhar: lê agora e a cada minuto. `on_change` avisa a interface quando algo mudou.
    pub fn start(app: AppHandle, on_change: fn(&AppHandle)) -> PlaytimeSync {
        let (request, requests) = channel();
        thread::spawn(move || {
            loop {
                match sync_now(&app) {
                    Ok(changed) if changed > 0 => on_change(&app),
                    Ok(_) => {}
                    Err(error) => eprintln!("[tempo jogado] não deu para ler os registros dos emuladores: {error}"),
                }
                if let Err(RecvTimeoutError::Disconnected) = requests.recv_timeout(SYNC_INTERVAL) {
                    break;
                }
            }
        });
        PlaytimeSync(Mutex::new(request))
    }

    /// Lê de novo agora.
    pub fn run(&self) {
        if let Ok(request) = self.0.lock() {
            let _ = request.send(());
        }
    }

    /// Lê de novo daqui a pouco (`delay`).
    pub fn run_after(&self, delay: Duration) {
        let Ok(request) = self.0.lock().map(|request| request.clone()) else { return };
        thread::spawn(move || {
            thread::sleep(delay);
            let _ = request.send(());
        });
    }
}

/// Lê o tempo que os emuladores registraram e atualiza os jogos. Devolve quantos mudaram. Nos testes, as
/// pastas do Windows ficam dentro da pasta de dados do teste: nada do computador de verdade é lido.
fn sync_now(app: &AppHandle) -> Result<usize, Box<dyn std::error::Error>> {
    let folders = match &test_mode().data_dir {
        Some(dir) => PlaytimeFolders {
            documents: dir.join("Documentos"),
            local_app_data: Some(dir.join("LocalAppData")),
            app_data: Some(dir.join("AppData")),
        },
        None => PlaytimeFolders {
            documents: app.path().document_dir()?,
            local_app_data: app.path().local_data_dir().ok(),
            app_data: app.path().data_dir().ok(),
        },
    };
    let state = app.state::<AppState>();
    let paths = get_emulator_paths(&state.db())?;
    // Os arquivos são lidos sem segurar o banco; só a atualização dos jogos usa ele.
    let records = read_emulator_records(find_playtime_files(&paths, &folders));
    Ok(sync_emulator_playtime(&state.db(), &records, Utc::now())?)
}
