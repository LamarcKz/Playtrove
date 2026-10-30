//! Entrar e sair do tema Aniki: o Playtrove grava a biblioteca para o plugin, sobe a ponte local, abre
//! o Playnite com o Aniki e esconde a janela dele. Quando o Playnite fecha, um `Playnite.DesktopApp.exe`
//! aberto logo em seguida é o "Voltar ao modo janela" (o Playtrove fecha esse desktop e mostra a
//! janela dele); sem isso, foi o "Sair", e o Playtrove fecha também.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::aniki_bridge::{self, BridgeActions, BridgeServer, GameUpdate};
use crate::errors::{AppError, AppResult};
use crate::state::AppState;
use crate::test_hooks::{self, TestHooks};
use crate::theme_pack::AnikiPack;

/// Até quanto tempo depois de o Playnite fechar um desktop dele ainda é o "Voltar ao modo janela".
const DESKTOP_WINDOW: Duration = Duration::from_secs(5);
const DESKTOP_EXE: &str = "Playnite.DesktopApp.exe";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExitKind {
    Window,
    Quit,
}

/// O que fazer quando o Playnite fecha: um Playnite que caiu (ou foi fechado à força) mostra a janela,
/// nunca deixa o Playtrove escondido sem nada na tela.
pub fn exit_kind(exited_normally: bool, desktop_started_after: Option<Duration>) -> ExitKind {
    let back_to_window = desktop_started_after.is_some_and(|elapsed| elapsed <= DESKTOP_WINDOW);
    if back_to_window || !exited_normally { ExitKind::Window } else { ExitKind::Quit }
}

/// A sessão aberta do Aniki (uma de cada vez).
#[derive(Default)]
pub struct AnikiSession {
    running: AtomicBool,
    server: Mutex<Option<BridgeServer>>,
}

/// O que o plugin pede, feito pelo mesmo código do desktop.
struct AppActions {
    app: AppHandle,
}

impl BridgeActions for AppActions {
    fn play(&self, game_id: i64) -> Result<u32, String> {
        crate::commands::play_game(&self.app, game_id).map_err(|error| error.to_string())
    }

    fn update(&self, update: GameUpdate) -> Result<(), String> {
        let state = self.app.state::<AppState>();
        aniki_bridge::apply_game_update(&state.db(), state.language(), &update).map_err(|error| error.to_string())?;
        crate::commands::notify_library_changed(&self.app);
        Ok(())
    }
}

/// Copia o plugin, que vai como recurso do app, para a pasta de complementos do Playnite.
fn install_plugin(app: &AppHandle, playnite_data: &Path) -> AppResult<()> {
    let source = app.path().resource_dir()?.join("bridge").join("PlaytroveBridge");
    let target = playnite_data.join("Extensions").join("PlaytroveBridge");
    std::fs::create_dir_all(&target)?;
    for file in ["PlaytroveBridge.dll", "extension.yaml"] {
        std::fs::copy(source.join(file), target.join(file))?;
    }
    Ok(())
}

/// Abre o Playnite com o Aniki no lugar da tela cheia do Playtrove.
pub fn enter(app: &AppHandle) -> AppResult<()> {
    let session = app.state::<AnikiSession>();
    if session.running.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let started = start(app, &session);
    if started.is_err() {
        stop_server(&session);
        session.running.store(false, Ordering::SeqCst);
    }
    started
}

fn start(app: &AppHandle, session: &AnikiSession) -> AppResult<()> {
    let state = app.state::<AppState>();
    let pack = app.state::<AnikiPack>();
    if !pack.installed() {
        return Err(AppError::text(state.language(), "errors.anikiMissing", &[]));
    }
    let data = pack.data_dir();
    pack.write_playnite_config(state.language())?;
    install_plugin(app, &data)?;
    let plugin_data = aniki_bridge::plugin_data_dir(&data);
    aniki_bridge::export_library(&state.db(), &plugin_data.join("library.json"))?;
    let server = BridgeServer::start(Arc::new(AppActions { app: app.clone() }), &plugin_data)?;
    *session.server.lock().unwrap_or_else(PoisonError::into_inner) = Some(server);
    if test_hooks::active() {
        // Nos testes, nada de Playnite de verdade: o teste simula a saída (test_aniki_exit).
        app.state::<TestHooks>().record_opened("aniki:enter");
    } else {
        let mut child = Command::new(pack.playnite_exe()).arg("--userdatadir").arg(&data).arg("--hidesplashscreen").spawn()?;
        let playnite = pack.playnite_exe().parent().map(Path::to_path_buf).unwrap_or_default();
        let handle = app.clone();
        std::thread::spawn(move || {
            let exited_normally = child.wait().is_ok_and(|status| status.success());
            let closed = Instant::now();
            let mut desktop = None;
            while closed.elapsed() <= DESKTOP_WINDOW {
                if close_playnite_desktop(&playnite) {
                    desktop = Some(closed.elapsed());
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            finish(&handle, exit_kind(exited_normally, desktop));
        });
    }
    if let Some(window) = app.get_webview_window(crate::window::MAIN_WINDOW) {
        window.hide()?;
    }
    Ok(())
}

fn stop_server(session: &AnikiSession) {
    if let Some(server) = session.server.lock().unwrap_or_else(PoisonError::into_inner).take() {
        server.stop();
    }
}

/// O Playnite fechou: volta ao modo janela ou fecha o Playtrove.
pub fn finish(app: &AppHandle, kind: ExitKind) {
    let session = app.state::<AnikiSession>();
    stop_server(&session);
    session.running.store(false, Ordering::SeqCst);
    match kind {
        ExitKind::Window => {
            if let Some(window) = app.get_webview_window(crate::window::MAIN_WINDOW) {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        ExitKind::Quit => app.exit(0),
    }
}

/// Procura um `Playnite.DesktopApp.exe` da pasta do Playnite do Aniki (e só dela) e fecha.
#[cfg(windows)]
fn close_playnite_desktop(playnite: &Path) -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, QueryFullProcessImageNameW,
        TerminateProcess,
    };
    let Ok(folder) = playnite.canonicalize() else { return false };
    let mut closed = false;
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return false };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut more = Process32FirstW(snapshot, &mut entry).is_ok();
        while more {
            let name = String::from_utf16_lossy(&entry.szExeFile[..entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(0)]);
            if name.eq_ignore_ascii_case(DESKTOP_EXE)
                && let Ok(process) =
                    OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE, false, entry.th32ProcessID)
            {
                let mut buffer = [0u16; 1024];
                let mut length = buffer.len() as u32;
                let inside = QueryFullProcessImageNameW(
                    process,
                    PROCESS_NAME_WIN32,
                    windows::core::PWSTR(buffer.as_mut_ptr()),
                    &mut length,
                )
                .is_ok()
                    && PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize]))
                        .canonicalize()
                        .is_ok_and(|path| path.starts_with(&folder));
                if inside && TerminateProcess(process, 0).is_ok() {
                    closed = true;
                }
                let _ = CloseHandle(process);
            }
            more = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = CloseHandle(snapshot);
    }
    closed
}

#[cfg(not(windows))]
fn close_playnite_desktop(_playnite: &Path) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[test]
    fn voltar_ao_modo_janela_abre_o_desktop_do_playnite_logo_depois() {
        assert_eq!(exit_kind(true, Some(Duration::from_secs(2))), ExitKind::Window);
    }

    #[test]
    fn sair_fecha_o_playnite_sem_abrir_o_desktop() {
        assert_eq!(exit_kind(true, None), ExitKind::Quit);
        // Um desktop aberto bem depois não é o "voltar ao modo janela".
        assert_eq!(exit_kind(true, Some(Duration::from_secs(7))), ExitKind::Quit);
    }

    #[test]
    fn playnite_que_caiu_ou_foi_fechado_a_forca_mostra_a_janela() {
        assert_eq!(exit_kind(false, None), ExitKind::Window);
    }
}
