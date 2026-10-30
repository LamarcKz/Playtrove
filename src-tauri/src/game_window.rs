//! Controla somente a janela do processo lançado, mantendo um handle próprio da identidade original.

use std::io;
use std::os::windows::io::{AsRawHandle, BorrowedHandle, OwnedHandle};
use std::process::Child;
use std::sync::Arc;

use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, WAIT_TIMEOUT, WPARAM};
use windows::Win32::System::Threading::WaitForSingleObject;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GW_OWNER, GetForegroundWindow, GetWindow, GetWindowThreadProcessId, IsIconic, IsWindowVisible, PostMessageW,
    SW_RESTORE, SW_SHOW, SetForegroundWindow, ShowWindowAsync, WM_CLOSE,
};
use windows::core::BOOL;

/// Razões técnicas para o comando; a ponte traduz cada uma para o idioma do app.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionControlError {
    NotRunning,
    ControlUnavailable,
    WindowUnavailable,
    OperationFailed,
}

/// A identidade original do processo e suas operações de janela; os testes usam processos de mentira.
pub trait GameProcessControl: Send + Sync {
    fn process_id(&self) -> u32;
    fn is_running(&self) -> bool;
    fn resume(&self) -> Result<(), SessionControlError>;
    fn request_close(&self) -> Result<(), SessionControlError>;
}

/// Duplica o handle do Child, sem procurar um processo pelo número do PID. O handle continua válido
/// mesmo após a saída e impede confundir uma sessão encerrada com outra identidade.
pub fn control_for_child(child: &Child) -> io::Result<Arc<dyn GameProcessControl>> {
    // SAFETY: o Child possui esse handle e vive durante toda a duplicação. A cópia possui sua própria
    // referência ao objeto do processo e é fechada por OwnedHandle quando a sessão deixa de usá-la.
    let handle = unsafe { BorrowedHandle::borrow_raw(child.as_raw_handle()) }.try_clone_to_owned()?;
    Ok(Arc::new(SystemGameProcess { process_id: child.id(), handle }))
}

struct SystemGameProcess {
    process_id: u32,
    handle: OwnedHandle,
}

impl GameProcessControl for SystemGameProcess {
    fn process_id(&self) -> u32 {
        self.process_id
    }

    fn is_running(&self) -> bool {
        // SAFETY: o handle é próprio e não pode ser fechado enquanto self estiver emprestado. Prazo
        // zero apenas consulta; diferentemente do código de saída, não confunde um exit code de 259.
        unsafe { WaitForSingleObject(HANDLE(self.handle.as_raw_handle()), 0) == WAIT_TIMEOUT }
    }

    fn resume(&self) -> Result<(), SessionControlError> {
        operate(self, &SystemWindows, WindowAction::Resume)
    }

    fn request_close(&self) -> Result<(), SessionControlError> {
        operate(self, &SystemWindows, WindowAction::RequestClose)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WindowId(usize);

#[derive(Clone, Copy)]
enum WindowAction {
    Resume,
    RequestClose,
}

trait WindowSystem {
    fn main_window(&self, process_id: u32) -> Option<WindowId>;
    fn owner(&self, window: WindowId) -> u32;
    fn is_minimized(&self, window: WindowId) -> bool;
    fn show(&self, window: WindowId, restore: bool) -> bool;
    fn focus(&self, window: WindowId) -> bool;
    fn request_close(&self, window: WindowId) -> bool;
}

fn validate_window(
    process: &dyn GameProcessControl,
    windows: &dyn WindowSystem,
    window: WindowId,
) -> Result<(), SessionControlError> {
    if !process.is_running() {
        return Err(SessionControlError::NotRunning);
    }
    if windows.owner(window) != process.process_id() {
        return Err(SessionControlError::WindowUnavailable);
    }
    Ok(())
}

fn operate(
    process: &dyn GameProcessControl,
    windows: &dyn WindowSystem,
    action: WindowAction,
) -> Result<(), SessionControlError> {
    if !process.is_running() {
        return Err(SessionControlError::NotRunning);
    }
    let window = windows.main_window(process.process_id()).ok_or(SessionControlError::WindowUnavailable)?;
    validate_window(process, windows, window)?;
    let succeeded = match action {
        WindowAction::Resume => {
            if !windows.show(window, windows.is_minimized(window)) {
                return Err(SessionControlError::OperationFailed);
            }
            // A janela pode desaparecer ou ser reutilizada enquanto a restauração é solicitada.
            validate_window(process, windows, window)?;
            windows.focus(window)
        }
        WindowAction::RequestClose => windows.request_close(window),
    };
    if succeeded { Ok(()) } else { Err(SessionControlError::OperationFailed) }
}

struct SystemWindows;

/// Só é usado com o Arc da sessão original, nunca com um PID fornecido pela interface.
pub(crate) fn native_target(process: &dyn GameProcessControl) -> Result<HWND, SessionControlError> {
    let windows = SystemWindows;
    let window = windows.main_window(process.process_id()).ok_or(SessionControlError::WindowUnavailable)?;
    validate_window(process, &windows, window)?;
    Ok(HWND(window.0 as _))
}

pub(crate) fn is_foreground(process: &dyn GameProcessControl) -> bool {
    if !process.is_running() {
        return false;
    }
    // SAFETY: consulta apenas a janela ativa; seu PID ainda precisa ser o da identidade original.
    let window = unsafe { GetForegroundWindow() };
    SystemWindows.owner(WindowId(window.0 as usize)) == process.process_id()
}

/// Consulta apenas janelas do processo original vivo. Testes nunca enumeram janelas do computador.
pub(crate) fn ready_window(process: &dyn GameProcessControl) -> Option<crate::launch_splash_state::ReadyIdentity> {
    if cfg!(test) || !process.is_running() {
        return None;
    }
    let mut windows = readiness_windows(process.process_id());
    let splashes: Vec<_> =
        windows.iter().filter(|(_, facts)| facts.visible && !facts.minimized && facts.splash_like).map(|(id, _)| *id).collect();
    for (id, facts) in &mut windows {
        facts.splash_sibling = splashes.iter().any(|splash| splash != id);
    }
    let (window, _) = windows
        .into_iter()
        .filter(|(_, facts)| facts.is_ready())
        .max_by(|(left_id, left), (right_id, right)| left.coverage.total_cmp(&right.coverage).then(left_id.0.cmp(&right_id.0)))?;
    validate_window(process, &SystemWindows, window).ok()?;
    Some(crate::launch_splash_state::ReadyIdentity { process_id: process.process_id(), window_id: window.0 })
}

fn readiness_windows(process_id: u32) -> Vec<(WindowId, crate::launch_splash_state::ReadyWindowFacts)> {
    use crate::launch_splash_state::ReadyWindowFacts;
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow};
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetWindowRect, GetWindowTextW, IsHungAppWindow};

    struct Search {
        process_id: u32,
        windows: Vec<(WindowId, ReadyWindowFacts)>,
    }
    unsafe extern "system" fn visit(window: HWND, data: LPARAM) -> BOOL {
        // SAFETY: EnumWindows chama sincronamente; os buffers e Search vivem durante a chamada.
        let search = unsafe { &mut *(data.0 as *mut Search) };
        let mut owner = 0;
        unsafe { GetWindowThreadProcessId(window, Some(&mut owner)) };
        if owner != search.process_id {
            return true.into();
        }
        let mut rect = RECT::default();
        let mut monitor = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let mut title = [0u16; 512];
        let mut class = [0u16; 256];
        // SAFETY: consultas somente sobre o HWND enumerado; falhas não produzem candidato pronto.
        unsafe {
            if GetWindowRect(window, &mut rect).is_err()
                || !GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST), &mut monitor).as_bool()
            {
                return true.into();
            }
            let title_length = GetWindowTextW(window, &mut title).max(0) as usize;
            let class_length = GetClassNameW(window, &mut class).max(0) as usize;
            let title = String::from_utf16_lossy(&title[..title_length]).to_lowercase();
            let class = String::from_utf16_lossy(&class[..class_length]).to_lowercase();
            let width = (rect.right.min(monitor.rcMonitor.right) - rect.left.max(monitor.rcMonitor.left)).max(0);
            let height = (rect.bottom.min(monitor.rcMonitor.bottom) - rect.top.max(monitor.rcMonitor.top)).max(0);
            let area = f64::from(monitor.rcMonitor.right - monitor.rcMonitor.left)
                * f64::from(monitor.rcMonitor.bottom - monitor.rcMonitor.top);
            let coverage = if area > 0.0 { f64::from(width) * f64::from(height) / area } else { 0.0 };
            search.windows.push((
                WindowId(window.0 as usize),
                ReadyWindowFacts {
                    visible: IsWindowVisible(window).as_bool(),
                    minimized: IsIconic(window).as_bool(),
                    hung: IsHungAppWindow(window).as_bool(),
                    width: rect.right - rect.left,
                    height: rect.bottom - rect.top,
                    coverage,
                    foreground: GetForegroundWindow() == window,
                    has_title: !title.trim().is_empty(),
                    splash_like: title.contains("splash") || class.contains("splash"),
                    splash_sibling: false,
                    ignored_title: ["microsoft blend", "visual studio", "playnite", "discord", "explorer"]
                        .iter()
                        .any(|ignored| title.contains(ignored)),
                },
            ));
        }
        true.into()
    }
    let mut search = Search { process_id, windows: Vec::new() };
    // SAFETY: Search permanece vivo e mutavelmente emprestado exclusivamente pelo enumerador.
    if unsafe { EnumWindows(Some(visit), LPARAM((&mut search as *mut Search) as isize)) }.is_err() {
        return Vec::new();
    }
    search.windows
}

impl WindowSystem for SystemWindows {
    fn main_window(&self, process_id: u32) -> Option<WindowId> {
        struct Search {
            process_id: u32,
            found: Option<WindowId>,
        }
        unsafe extern "system" fn visit(window: HWND, data: LPARAM) -> BOOL {
            // SAFETY: EnumWindows chama esta função sincronamente e Search permanece vivo.
            let search = unsafe { &mut *(data.0 as *mut Search) };
            let mut process_id = 0;
            // SAFETY: a janela foi fornecida pelo próprio enumerador do Windows.
            unsafe {
                GetWindowThreadProcessId(window, Some(&mut process_id));
                if process_id == search.process_id && IsWindowVisible(window).as_bool() && GetWindow(window, GW_OWNER).is_err() {
                    search.found = Some(WindowId(window.0 as usize));
                    return BOOL(0);
                }
            }
            BOOL(1)
        }
        let mut search = Search { process_id, found: None };
        // SAFETY: o endereço de Search só é usado pelo callback durante esta chamada.
        unsafe {
            let _ = EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize));
        }
        search.found
    }

    fn owner(&self, window: WindowId) -> u32 {
        let mut process_id = 0;
        // SAFETY: consulta sem desreferenciar o HWND; janela já fechada devolve PID zero.
        unsafe { GetWindowThreadProcessId(HWND(window.0 as _), Some(&mut process_id)) };
        process_id
    }

    fn is_minimized(&self, window: WindowId) -> bool {
        // SAFETY: consulta de estado sobre o HWND validado pela operação.
        unsafe { IsIconic(HWND(window.0 as _)).as_bool() }
    }

    fn show(&self, window: WindowId, restore: bool) -> bool {
        // SAFETY: apenas mostra/restaura a janela validada, sem esperar seu processamento de mensagens.
        unsafe { ShowWindowAsync(HWND(window.0 as _), if restore { SW_RESTORE } else { SW_SHOW }).as_bool() }
    }

    fn focus(&self, window: WindowId) -> bool {
        // SAFETY: o HWND foi revalidado imediatamente antes do foco; o Windows ainda pode recusá-lo.
        unsafe { SetForegroundWindow(HWND(window.0 as _)).as_bool() }
    }

    fn request_close(&self, window: WindowId) -> bool {
        // SAFETY: WM_CLOSE é uma solicitação normal, que o jogo pode cancelar. Não termina o processo,
        // destrói a janela diretamente nem espera uma aplicação que esteja sem responder.
        unsafe { PostMessageW(Some(HWND(window.0 as _)), WM_CLOSE, WPARAM(0), LPARAM(0)).is_ok() }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

    use super::*;

    struct FakeProcess {
        alive: AtomicBool,
    }

    impl GameProcessControl for FakeProcess {
        fn process_id(&self) -> u32 {
            4242
        }
        fn is_running(&self) -> bool {
            self.alive.load(Ordering::SeqCst)
        }
        fn resume(&self) -> Result<(), SessionControlError> {
            Err(SessionControlError::ControlUnavailable)
        }
        fn request_close(&self) -> Result<(), SessionControlError> {
            Err(SessionControlError::ControlUnavailable)
        }
    }

    struct FakeWindows<'a> {
        owner: AtomicU32,
        minimized: bool,
        actions: Mutex<Vec<&'static str>>,
        changed_after_show: bool,
        available: bool,
        succeed: bool,
        exit_on_lookup: Option<&'a AtomicBool>,
    }

    impl Default for FakeWindows<'_> {
        fn default() -> Self {
            Self {
                owner: AtomicU32::new(4242),
                minimized: false,
                actions: Mutex::default(),
                changed_after_show: false,
                available: true,
                succeed: true,
                exit_on_lookup: None,
            }
        }
    }

    impl WindowSystem for FakeWindows<'_> {
        fn main_window(&self, process_id: u32) -> Option<WindowId> {
            assert_eq!(process_id, 4242);
            if let Some(alive) = self.exit_on_lookup {
                alive.store(false, Ordering::SeqCst);
            }
            self.available.then_some(WindowId(12))
        }
        fn owner(&self, window: WindowId) -> u32 {
            assert_eq!(window, WindowId(12));
            self.owner.load(Ordering::SeqCst)
        }
        fn is_minimized(&self, _window: WindowId) -> bool {
            self.minimized
        }
        fn show(&self, _window: WindowId, restore: bool) -> bool {
            self.actions.lock().unwrap().push(if restore { "restore" } else { "show" });
            if self.changed_after_show {
                self.owner.store(9999, Ordering::SeqCst);
            }
            self.succeed
        }
        fn focus(&self, _window: WindowId) -> bool {
            self.actions.lock().unwrap().push("focus");
            self.succeed
        }
        fn request_close(&self, _window: WindowId) -> bool {
            self.actions.lock().unwrap().push("close");
            self.succeed
        }
    }

    #[test]
    fn retomar_restaura_a_janela_minimizada_antes_de_focar() {
        let process = FakeProcess { alive: AtomicBool::new(true) };
        let windows = FakeWindows { minimized: true, ..Default::default() };
        assert_eq!(operate(&process, &windows, WindowAction::Resume), Ok(()));
        assert_eq!(*windows.actions.lock().unwrap(), ["restore", "focus"]);
    }

    #[test]
    fn retomar_preserva_o_estado_de_uma_janela_que_ja_esta_visivel() {
        let process = FakeProcess { alive: AtomicBool::new(true) };
        let windows = FakeWindows::default();
        assert_eq!(operate(&process, &windows, WindowAction::Resume), Ok(()));
        assert_eq!(*windows.actions.lock().unwrap(), ["show", "focus"]);
    }

    #[test]
    fn fechamento_so_envia_a_solicitacao_e_nao_foca_nem_encerra_o_processo() {
        let process = FakeProcess { alive: AtomicBool::new(true) };
        let windows = FakeWindows::default();
        assert_eq!(operate(&process, &windows, WindowAction::RequestClose), Ok(()));
        assert_eq!(*windows.actions.lock().unwrap(), ["close"]);
        assert!(process.is_running());
    }

    #[test]
    fn processo_encerrado_ou_janela_de_outro_pid_nao_recebe_acao() {
        for action in [WindowAction::Resume, WindowAction::RequestClose] {
            let process = FakeProcess { alive: AtomicBool::new(false) };
            let windows = FakeWindows::default();
            assert_eq!(operate(&process, &windows, action), Err(SessionControlError::NotRunning));
            process.alive.store(true, Ordering::SeqCst);
            windows.owner.store(9999, Ordering::SeqCst);
            assert_eq!(operate(&process, &windows, action), Err(SessionControlError::WindowUnavailable));
            assert!(windows.actions.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn janela_trocada_apos_restaurar_nao_recebe_foco() {
        let process = FakeProcess { alive: AtomicBool::new(true) };
        let windows = FakeWindows { minimized: true, changed_after_show: true, ..Default::default() };
        assert_eq!(operate(&process, &windows, WindowAction::Resume), Err(SessionControlError::WindowUnavailable));
        assert_eq!(*windows.actions.lock().unwrap(), ["restore"]);
    }

    #[test]
    fn ausencia_de_janela_e_falhas_do_windows_sao_reportadas() {
        let process = FakeProcess { alive: AtomicBool::new(true) };
        let windows = FakeWindows { available: false, ..Default::default() };
        assert_eq!(operate(&process, &windows, WindowAction::Resume), Err(SessionControlError::WindowUnavailable));
        let windows = FakeWindows { succeed: false, ..Default::default() };
        assert_eq!(operate(&process, &windows, WindowAction::Resume), Err(SessionControlError::OperationFailed));
        assert_eq!(operate(&process, &windows, WindowAction::RequestClose), Err(SessionControlError::OperationFailed));
        assert_eq!(*windows.actions.lock().unwrap(), ["show", "close"]);
    }

    #[test]
    fn saida_durante_a_busca_da_janela_cancela_o_comando() {
        let process = FakeProcess { alive: AtomicBool::new(true) };
        let windows = FakeWindows { exit_on_lookup: Some(&process.alive), ..Default::default() };
        assert_eq!(operate(&process, &windows, WindowAction::RequestClose), Err(SessionControlError::NotRunning));
        assert!(windows.actions.lock().unwrap().is_empty());
    }
}
