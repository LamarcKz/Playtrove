//! Centro de controle nativo: janela própria vinculada ao processo original, com atalhos opt-in.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::controller_input::{ControllerButton, ControllerInputSnapshot, InputState};
use crate::game_window::{GameProcessControl, SessionControlError};
use crate::launcher::Launcher;
use crate::state::AppState;

pub const STATE_EVENT: &str = "game-overlay:state";
pub const INPUT_EVENT: &str = "game-overlay:input";
pub const WINDOW_LABEL: &str = "game-overlay";
const TOGGLE_COOLDOWN_MS: u64 = 350;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayState {
    pub open: bool,
    pub is_focused: bool,
    pub game_id: Option<i64>,
    pub enabled: bool,
    pub keyboard_shortcut_available: bool,
    pub controller_shortcut_available: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverlayError {
    Disabled,
    NoActiveGame,
    Session(SessionControlError),
    Window,
    ServiceStopped,
    InputHeld,
}

#[derive(Clone)]
struct OverlayTarget {
    game_id: i64,
    process: Arc<dyn GameProcessControl>,
    synthetic: bool,
    window_token: Arc<()>,
}

trait OverlayBackend {
    fn target(&self, game_id: i64) -> Result<OverlayTarget, OverlayError>;
    fn foreground_target(&self) -> Option<OverlayTarget>;
    fn show(&self, target: &OverlayTarget) -> Result<(), OverlayError>;
    fn hide(&self) -> Result<(), OverlayError>;
    fn focus_app(&self) -> Result<(), OverlayError>;
    fn is_focused(&self) -> bool;
}

struct OverlayModel<B> {
    backend: B,
    state: OverlayState,
    target: Option<OverlayTarget>,
    last_toggle: Option<u64>,
}

impl<B: OverlayBackend> OverlayModel<B> {
    fn new(backend: B) -> Self {
        Self { backend, state: OverlayState::default(), target: None, last_toggle: None }
    }

    fn configure(&mut self, enabled: bool) {
        self.state.enabled = enabled;
        if !enabled {
            let _ = self.dismiss();
            self.state.keyboard_shortcut_available = false;
            self.state.controller_shortcut_available = false;
        }
    }

    fn open(&mut self, game_id: i64, now: u64) -> Result<(), OverlayError> {
        if !self.state.enabled {
            return Err(OverlayError::Disabled);
        }
        if self.state.open {
            return Ok(());
        }
        let target = self.backend.target(game_id)?;
        self.open_target(target, now)
    }

    fn open_target(&mut self, mut target: OverlayTarget, now: u64) -> Result<(), OverlayError> {
        if !self.state.enabled {
            return Err(OverlayError::Disabled);
        }
        if self.state.open {
            return Ok(());
        }
        if !target.process.is_running() {
            return Err(OverlayError::NoActiveGame);
        }
        target.window_token = Arc::new(());
        self.backend.show(&target)?;
        self.state.game_id = Some(target.game_id);
        self.target = Some(target);
        self.state.open = true;
        self.state.is_focused = self.backend.is_focused();
        self.last_toggle = Some(now);
        Ok(())
    }

    fn dismiss(&mut self) -> Result<(), OverlayError> {
        if self.state.open {
            self.backend.hide()?;
        }
        self.forget_window();
        Ok(())
    }

    fn forget_window(&mut self) {
        self.target = None;
        self.state.open = false;
        self.state.is_focused = false;
        self.state.game_id = None;
    }

    fn window_gone(&mut self, token: &Arc<()>) {
        if self.target.as_ref().is_some_and(|target| Arc::ptr_eq(&target.window_token, token)) {
            self.forget_window();
        }
    }

    fn return_to_game(&mut self) -> Result<(), OverlayError> {
        let Some(target) = &self.target else {
            return Ok(());
        };
        target.process.resume().map_err(OverlayError::Session)?;
        self.dismiss()
    }

    fn return_to_app(&mut self) -> Result<(), OverlayError> {
        let target = self.target.as_ref().ok_or(OverlayError::NoActiveGame)?;
        if !target.process.is_running() {
            return Err(OverlayError::NoActiveGame);
        }
        self.backend.focus_app()?;
        self.dismiss()
    }

    fn request_close_game(&mut self) -> Result<(), OverlayError> {
        let target = self.target.clone().ok_or(OverlayError::NoActiveGame)?;
        if !target.process.is_running() {
            return Err(OverlayError::NoActiveGame);
        }
        target.process.request_close().map_err(OverlayError::Session)?;
        // Libera possíveis diálogos de salvar/sair do jogo; a sessão do Launcher continua até wait.
        self.dismiss()?;
        if target.process.is_running() {
            target.process.resume().map_err(OverlayError::Session)?;
        }
        Ok(())
    }

    fn tick(&mut self) -> Result<(), OverlayError> {
        if self.state.open && (!self.state.enabled || self.target.as_ref().is_none_or(|target| !target.process.is_running())) {
            self.dismiss()?;
        }
        self.state.is_focused = self.state.open && self.backend.is_focused();
        Ok(())
    }

    fn toggle(&mut self, now: u64) -> Result<(), OverlayError> {
        if self.last_toggle.is_some_and(|last| now.saturating_sub(last) < TOGGLE_COOLDOWN_MS) {
            return Ok(());
        }
        if self.state.open {
            self.return_to_game()?;
            self.last_toggle = Some(now);
            Ok(())
        } else {
            if !self.state.enabled {
                return Err(OverlayError::Disabled);
            }
            let target = self.backend.foreground_target().ok_or(OverlayError::NoActiveGame)?;
            self.open(target.game_id, now)
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReturnDecision {
    Wait,
    Ready,
    TimedOut,
}
struct ReturnToGameGate {
    deadline: u64,
    neutral_since: Option<u64>,
    not_before: u64,
}
impl ReturnToGameGate {
    fn new(now: u64) -> Self {
        Self { deadline: now.saturating_add(2500), neutral_since: None, not_before: now }
    }
    fn for_close(now: u64) -> Self {
        Self { not_before: now.saturating_add(350), ..Self::new(now) }
    }
    fn observe(&mut self, now: u64, confirmation_held: bool) -> ReturnDecision {
        if confirmation_held {
            self.neutral_since = None;
            return if now >= self.deadline { ReturnDecision::TimedOut } else { ReturnDecision::Wait };
        }
        let since = *self.neutral_since.get_or_insert(now);
        if now.saturating_sub(since) >= 120 && now >= self.not_before { ReturnDecision::Ready } else { ReturnDecision::Wait }
    }
}

#[derive(Default)]
struct OverlayInputRouter {
    input: InputState,
}
impl OverlayInputRouter {
    fn set_active(&mut self, active: bool) {
        self.input.set_enabled(active);
    }
    fn observe(&mut self, key: u32, buttons: Vec<ControllerButton>) {
        if self.input.snapshot.controller_key.is_some_and(|selected| selected != key) {
            return;
        }
        self.input.select(Some(key));
        self.input.observe(buttons);
    }
    fn snapshot(&self) -> ControllerInputSnapshot {
        self.input.snapshot.clone()
    }
}

fn buttons_from_hid(usages: &[u16], x: u32, y: u32, hat: u32) -> Vec<ControllerButton> {
    use ControllerButton::*;
    let candidates = [
        (Up, matches!(hat, 0 | 1 | 7) || y <= 64),
        (Down, matches!(hat, 3..=5) || y >= 192),
        (Left, matches!(hat, 5..=7) || x <= 64),
        (Right, matches!(hat, 1..=3) || x >= 192),
        (Cross, usages.contains(&2)),
        (Circle, usages.contains(&3)),
        (Square, usages.contains(&1)),
        (Triangle, usages.contains(&4)),
        (L1, usages.contains(&5)),
        (R1, usages.contains(&6)),
        (L2, usages.contains(&7)),
        (R2, usages.contains(&8)),
        (Options, usages.contains(&10)),
        (Create, usages.contains(&9)),
        (L3, usages.contains(&11)),
        (R3, usages.contains(&12)),
        (Ps, usages.contains(&13)),
        (Touchpad, usages.contains(&14)),
    ];
    candidates.into_iter().filter_map(|(button, pressed)| pressed.then_some(button)).collect()
}

/// O combo age ao soltar, depois de observar repouso; uma reconexão ou retorno exige novo repouso.
#[derive(Default)]
struct ControllerShortcutGate {
    armed: bool,
    pending: bool,
}
impl ControllerShortcutGate {
    fn observe(&mut self, neutral: bool, chord: bool) -> bool {
        if !self.armed {
            self.armed = neutral;
            return false;
        }
        if chord {
            self.pending = true;
        }
        if neutral && self.pending {
            self.armed = false;
            self.pending = false;
            return true;
        }
        false
    }
}

enum Action {
    Open(i64),
    ReturnGame,
    ReturnApp,
    RequestCloseGame,
    TestOpen(i64),
    TestInput(bool, Vec<ControllerButton>),
}
enum Message {
    Action(Action, Option<Sender<Result<OverlayState, OverlayError>>>),
    Configure(bool, String),
    WindowGone(Arc<()>),
    FocusChanged,
    Stop,
}

/// Um worker por app. Os comandos públicos devem ser chamados por comandos Tauri assíncronos.
pub struct GameOverlay {
    app: AppHandle,
    sender: Sender<Message>,
    shared: Arc<Shared>,
}
struct Shared {
    state: Mutex<OverlayState>,
    input: Mutex<ControllerInputSnapshot>,
    thread_id: AtomicU32,
    stopped: AtomicBool,
    native: bool,
}

impl GameOverlay {
    pub fn start(app: AppHandle, webview_folder: PathBuf) -> Self {
        let native = !cfg!(test) && crate::test_mode::test_mode().data_dir.is_none();
        let shared = Arc::new(Shared {
            state: Mutex::default(),
            input: Mutex::default(),
            thread_id: AtomicU32::new(0),
            stopped: AtomicBool::new(false),
            native,
        });
        let (sender, receiver) = mpsc::channel();
        let worker_app = app.clone();
        let worker_shared = shared.clone();
        thread::spawn(move || run_worker(worker_app, webview_folder, receiver, worker_shared));
        let service = Self { app, sender, shared };
        service.refresh();
        service
    }

    pub fn get_state(&self) -> OverlayState {
        self.shared.state.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }
    pub fn get_input_snapshot(&self) -> ControllerInputSnapshot {
        self.shared.input.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    pub fn inject_test_input(
        &self,
        connected: bool,
        buttons: Vec<ControllerButton>,
    ) -> Result<ControllerInputSnapshot, OverlayError> {
        if !cfg!(debug_assertions) || crate::test_mode::test_mode().data_dir.is_none() {
            return Err(OverlayError::Disabled);
        }
        self.request(Action::TestInput(connected, buttons))?;
        Ok(self.get_input_snapshot())
    }
    pub fn open(&self, game_id: i64) -> Result<OverlayState, OverlayError> {
        self.request(Action::Open(game_id))
    }
    pub fn close(&self) -> Result<OverlayState, OverlayError> {
        self.return_to_game()
    }
    pub fn return_to_game(&self) -> Result<OverlayState, OverlayError> {
        self.request(Action::ReturnGame)
    }
    pub fn return_to_app(&self) -> Result<OverlayState, OverlayError> {
        self.request(Action::ReturnApp)
    }
    pub fn request_close_game(&self) -> Result<OverlayState, OverlayError> {
        self.request(Action::RequestCloseGame)
    }

    /// Gancho da prova GUI: só usa um processo sintético nos dados temporários dos testes.
    pub fn open_test_game(&self, game_id: i64) -> Result<OverlayState, OverlayError> {
        if !cfg!(debug_assertions) || crate::test_mode::test_mode().data_dir.is_none() {
            return Err(OverlayError::Disabled);
        }
        self.request(Action::TestOpen(game_id))
    }

    /// Reconciliar depois de salvar preferências; sessões também são verificadas pelo worker.
    pub fn refresh(&self) {
        let config = crate::fullscreen::get_config(&self.app.state::<AppState>().db());
        let _ = self.send(Message::Configure(config.in_game_overlay_enabled, config.in_game_overlay_hotkey));
    }

    pub fn shutdown(&self) {
        if !self.shared.stopped.swap(true, Ordering::SeqCst) {
            let _ = self.send(Message::Stop);
        }
    }

    fn request(&self, action: Action) -> Result<OverlayState, OverlayError> {
        if self.shared.stopped.load(Ordering::SeqCst) {
            return Err(OverlayError::ServiceStopped);
        }
        let (reply, receive) = mpsc::channel();
        self.send(Message::Action(action, Some(reply)))?;
        receive.recv_timeout(Duration::from_secs(20)).map_err(|_| OverlayError::ServiceStopped)?
    }

    fn send(&self, message: Message) -> Result<(), OverlayError> {
        self.sender.send(message).map_err(|_| OverlayError::ServiceStopped)?;
        if self.shared.native {
            native::wake(self.shared.thread_id.load(Ordering::SeqCst));
        }
        Ok(())
    }
}
impl Drop for GameOverlay {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn publish(app: &AppHandle, shared: &Shared, state: &OverlayState) {
    let mut current = shared.state.lock().unwrap_or_else(PoisonError::into_inner);
    if *current != *state {
        *current = state.clone();
        let _ = app.emit(STATE_EVENT, state);
    }
}

fn publish_input(app: &AppHandle, shared: &Shared, snapshot: ControllerInputSnapshot) {
    let mut current = shared.input.lock().unwrap_or_else(PoisonError::into_inner);
    if *current != snapshot {
        *current = snapshot.clone();
        let _ = app.emit_to(WINDOW_LABEL, INPUT_EVENT, snapshot);
    }
}

struct PendingReturn {
    gate: ReturnToGameGate,
    close_game: bool,
    reply: Option<Sender<Result<OverlayState, OverlayError>>>,
}

fn run_worker(app: AppHandle, webview_folder: PathBuf, receiver: Receiver<Message>, shared: Arc<Shared>) {
    if shared.native {
        native::initialize_queue(&shared.thread_id);
    }
    let mut input = shared.native.then(native::ShortcutInput::new);
    let mut model = OverlayModel::new(native::RuntimeBackend { app: app.clone(), webview_folder, simulated: !shared.native });
    let mut hotkey = "CtrlShiftF12".to_string();
    let clock = Instant::now();
    let mut routed = OverlayInputRouter::default();
    let mut pending_return: Option<PendingReturn> = None;
    let mut test_buttons = Vec::new();
    loop {
        let messages = if shared.native {
            receiver.try_iter().collect::<Vec<_>>()
        } else {
            match receiver.recv_timeout(Duration::from_millis(if pending_return.is_some() { 20 } else { 200 })) {
                Ok(message) => std::iter::once(message).chain(receiver.try_iter()).collect(),
                Err(mpsc::RecvTimeoutError::Timeout) => Vec::new(),
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        };
        let mut stop = false;
        for message in messages {
            match message {
                Message::Stop => {
                    stop = true;
                    break;
                }
                Message::Configure(enabled, value) => {
                    model.configure(enabled);
                    hotkey = value;
                    if let Some(input) = &mut input {
                        input.reset();
                    }
                }
                Message::WindowGone(token) => model.window_gone(&token),
                Message::FocusChanged => {
                    let _ = model.tick();
                }
                Message::Action(action, reply) => {
                    let now = clock.elapsed().as_millis() as u64;
                    if matches!(&action, Action::ReturnGame | Action::RequestCloseGame) && model.state.open {
                        if pending_return.is_none() {
                            let close_game = matches!(&action, Action::RequestCloseGame);
                            pending_return = Some(PendingReturn {
                                gate: if close_game { ReturnToGameGate::for_close(now) } else { ReturnToGameGate::new(now) },
                                close_game,
                                reply,
                            });
                        } else if let Some(reply) = reply {
                            let _ = reply.send(Err(OverlayError::InputHeld));
                        }
                        continue;
                    }
                    let result = match action {
                        Action::Open(id) => model.open(id, now),
                        Action::ReturnGame => model.return_to_game(),
                        Action::ReturnApp => model.return_to_app(),
                        Action::RequestCloseGame => model.request_close_game(),
                        Action::TestOpen(id) => {
                            let process = Arc::new(native::SyntheticProcess { app: app.clone(), alive: AtomicBool::new(true) });
                            model.open_target(
                                OverlayTarget { game_id: id, process, synthetic: true, window_token: Arc::new(()) },
                                now,
                            )
                        }
                        Action::TestInput(connected, buttons) => {
                            routed.set_active(model.state.open && model.state.is_focused);
                            test_buttons = if connected { buttons } else { Vec::new() };
                            if connected {
                                routed.observe(1, test_buttons.clone());
                            } else {
                                routed.input.select(None);
                            }
                            Ok(())
                        }
                    };
                    routed.set_active(model.state.open && model.state.is_focused);
                    publish_input(&app, &shared, routed.snapshot());
                    publish(&app, &shared, &model.state);
                    if let Some(reply) = reply {
                        let _ = reply.send(result.map(|_| model.state.clone()));
                    }
                }
            }
        }
        if stop {
            break;
        }
        let _ = model.tick();
        routed.set_active(model.state.open && model.state.is_focused);
        if let Some(input) = &mut input {
            let has_game = app.state::<Launcher>().running_sessions().iter().any(|session| session.can_control);
            input.configure(model.state.enabled && has_game, &hotkey);
            let toggles = input.poll();
            let _ = model.tick();
            routed.set_active(model.state.open && model.state.is_focused);
            if routed.snapshot().controller_key.is_some_and(|key| !input.device_ready(key)) {
                routed.input.select(None);
            }
            for (key, buttons) in input.take_inputs() {
                routed.observe(key, buttons);
            }
            if let Some((key, buttons)) = input.latest_input(routed.snapshot().controller_key) {
                routed.observe(key, buttons);
            } else {
                routed.input.select(None);
            }
            model.state.keyboard_shortcut_available = input.keyboard_available();
            model.state.controller_shortcut_available = input.controller_available();
            for _ in 0..toggles {
                let now = clock.elapsed().as_millis() as u64;
                if model.state.open {
                    if pending_return.is_none()
                        && model.last_toggle.is_none_or(|last| now.saturating_sub(last) >= TOGGLE_COOLDOWN_MS)
                    {
                        pending_return = Some(PendingReturn { gate: ReturnToGameGate::new(now), close_game: false, reply: None });
                    }
                } else {
                    let _ = model.toggle(now);
                }
                input.reset();
            }
        }
        if let Some(pending) = &mut pending_return {
            let held =
                input.as_ref().map_or_else(|| test_buttons.contains(&ControllerButton::Cross), |input| input.confirmation_held());
            let decision = if model.state.open {
                pending.gate.observe(clock.elapsed().as_millis() as u64, held)
            } else {
                ReturnDecision::Ready
            };
            if decision != ReturnDecision::Wait {
                let result = if decision == ReturnDecision::TimedOut {
                    Err(OverlayError::InputHeld)
                } else if pending.close_game {
                    model.request_close_game()
                } else {
                    model.return_to_game()
                };
                if result.is_ok() {
                    model.last_toggle = Some(clock.elapsed().as_millis() as u64);
                    if let Some(input) = &mut input {
                        input.reset();
                    }
                }
                routed.set_active(model.state.open && model.state.is_focused);
                publish_input(&app, &shared, routed.snapshot());
                publish(&app, &shared, &model.state);
                if let Some(reply) = pending_return.take().and_then(|pending| pending.reply) {
                    let _ = reply.send(result.map(|_| model.state.clone()));
                }
            }
        }
        routed.set_active(model.state.open && model.state.is_focused);
        publish_input(&app, &shared, routed.snapshot());
        publish(&app, &shared, &model.state);
        if shared.native {
            native::wait(if pending_return.is_some() { 20 } else { 200 });
        }
    }
    let _ = model.dismiss();
    model.configure(false);
    routed.set_active(false);
    publish_input(&app, &shared, routed.snapshot());
    publish(&app, &shared, &model.state);
    shared.stopped.store(true, Ordering::SeqCst);
    shared.thread_id.store(0, Ordering::SeqCst);
    // O drop do observador ocorre na própria thread que registrou os atalhos.
}

mod native {
    use std::collections::{HashMap, HashSet};
    use std::mem::{size_of, size_of_val};

    use tauri::window::Color;
    use tauri::{PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent};
    use windows::Win32::Devices::HumanInterfaceDevice::{
        HIDP_CAPS, HIDP_STATUS_SUCCESS, HIDP_VALUE_CAPS, HidP_GetCaps, HidP_GetUsageValue, HidP_GetUsages, HidP_GetValueCaps,
        HidP_Input, HidP_MaxUsageListLength, PHIDP_PREPARSED_DATA,
    };
    use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, WPARAM};
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, RegisterHotKey, UnregisterHotKey,
    };
    use windows::Win32::UI::Input::{
        GetRawInputData, GetRawInputDeviceInfoW, HRAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RID_DEVICE_INFO, RID_INPUT,
        RIDEV_DEVNOTIFY, RIDEV_INPUTSINK, RIDEV_REMOVE, RIDI_DEVICEINFO, RIDI_PREPARSEDDATA, RIM_TYPEHID,
        RegisterRawInputDevices,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, DispatchMessageW, HWND_MESSAGE, MSG, MWMO_INPUTAVAILABLE, MsgWaitForMultipleObjectsEx,
        PM_NOREMOVE, PM_REMOVE, PeekMessageW, PostThreadMessageW, QS_ALLINPUT, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WM_HOTKEY,
        WM_INPUT, WM_INPUT_DEVICE_CHANGE,
    };
    use windows::core::w;

    use super::*;

    const HOTKEY_ID: i32 = 0x5047;
    const WAKE: u32 = WM_APP + 73;

    pub(super) fn initialize_queue(id: &AtomicU32) {
        // SAFETY: cria somente a fila desta thread; nenhum atalho ou dispositivo é registrado aqui.
        unsafe {
            let _ = PeekMessageW(&mut MSG::default(), None, 0, 0, PM_NOREMOVE);
            id.store(GetCurrentThreadId(), Ordering::SeqCst);
        }
    }
    pub(super) fn wake(id: u32) {
        if id != 0 {
            // SAFETY: id pertence exclusivamente ao worker criado pelo serviço.
            unsafe {
                let _ = PostThreadMessageW(id, WAKE, WPARAM(0), LPARAM(0));
            }
        }
    }
    pub(super) fn wait(milliseconds: u32) {
        // SAFETY: espera bloqueante por mensagens ou pelo prazo de reconciliação das sessões.
        unsafe {
            let _ = MsgWaitForMultipleObjectsEx(None, milliseconds, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
        }
    }

    pub(super) struct RuntimeBackend {
        pub app: AppHandle,
        pub webview_folder: PathBuf,
        pub simulated: bool,
    }

    impl RuntimeBackend {
        fn note(&self, action: &str) {
            self.app.state::<crate::test_hooks::TestHooks>().record_opened(action);
        }
    }
    impl OverlayBackend for RuntimeBackend {
        fn target(&self, game_id: i64) -> Result<OverlayTarget, OverlayError> {
            if self.simulated {
                return Err(OverlayError::NoActiveGame);
            }
            let process = self.app.state::<Launcher>().session_control(game_id).map_err(OverlayError::Session)?;
            Ok(OverlayTarget { game_id, process, synthetic: false, window_token: Arc::new(()) })
        }
        fn foreground_target(&self) -> Option<OverlayTarget> {
            if self.simulated {
                return None;
            }
            let launcher = self.app.state::<Launcher>();
            launcher.running_sessions().into_iter().find_map(|session| {
                let process = launcher.session_control(session.game_id).ok()?;
                crate::game_window::is_foreground(process.as_ref()).then_some(OverlayTarget {
                    game_id: session.game_id,
                    process,
                    synthetic: false,
                    window_token: Arc::new(()),
                })
            })
        }
        fn show(&self, target: &OverlayTarget) -> Result<(), OverlayError> {
            if cfg!(test) {
                return Ok(());
            }
            if self.simulated && !target.synthetic {
                return Err(OverlayError::NoActiveGame);
            }
            let owner = if target.synthetic {
                self.app.get_webview_window("main").ok_or(OverlayError::Window)?.hwnd().map_err(|_| OverlayError::Window)?
            } else {
                crate::game_window::native_target(target.process.as_ref()).map_err(OverlayError::Session)?
            };
            let mut monitor = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
            // SAFETY: o anchor é da sessão validada, ou da janela própria no adaptador de teste.
            unsafe {
                if !GetMonitorInfoW(MonitorFromWindow(owner, MONITOR_DEFAULTTONEAREST), &mut monitor).as_bool() {
                    return Err(OverlayError::Window);
                }
            }
            let rect = monitor.rcMonitor;
            let language = self.app.state::<AppState>().language();
            let query = format!("index.html?gameOverlay=1&lang={}", language.id());
            // WebViews do mesmo perfil precisam das mesmas opções, inclusive a porta da prova GUI.
            let browser_args = crate::window::browser_args();
            let window = WebviewWindowBuilder::new(&self.app, WINDOW_LABEL, WebviewUrl::App(query.into()))
                .title(if cfg!(debug_assertions) { "Playtrove Dev" } else { "Playtrove" })
                .decorations(false)
                .resizable(false)
                .skip_taskbar(true)
                .always_on_top(true)
                .visible(false)
                .background_color(Color(0x12, 0x16, 0x1d, 0xff))
                .data_directory(self.webview_folder.clone())
                .additional_browser_args(&browser_args)
                .on_navigation(|url| match url.host_str() {
                    Some("tauri.localhost") => true,
                    Some("localhost") => cfg!(debug_assertions) && url.port() == Some(1420),
                    _ => false,
                })
                .build()
                .map_err(|_| OverlayError::Window)?;
            let result = (|| {
                window.set_position(PhysicalPosition::new(rect.left, rect.top)).map_err(|_| OverlayError::Window)?;
                window
                    .set_size(PhysicalSize::new((rect.right - rect.left).max(1) as u32, (rect.bottom - rect.top).max(1) as u32))
                    .map_err(|_| OverlayError::Window)?;
                if !target.process.is_running() {
                    return Err(OverlayError::NoActiveGame);
                }
                window.show().map_err(|_| OverlayError::Window)?;
                window.set_focus().map_err(|_| OverlayError::Window)?;
                crate::window::focus_content(&window).map_err(|_| OverlayError::Window)?;
                if !wait_for_focus(&window) {
                    return Err(OverlayError::Window);
                }
                Ok(())
            })();
            if result.is_err() {
                let _ = window.destroy();
                return result;
            }
            let app = self.app.clone();
            let token = target.window_token.clone();
            window.on_window_event(move |event| {
                if let Some(service) = app.try_state::<GameOverlay>() {
                    match event {
                        WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            let _ = service.send(Message::Action(Action::ReturnGame, None));
                        }
                        WindowEvent::Focused(_) => {
                            let _ = service.send(Message::FocusChanged);
                        }
                        WindowEvent::Destroyed => {
                            let _ = service.send(Message::WindowGone(token.clone()));
                        }
                        _ => {}
                    }
                }
            });
            if self.simulated {
                self.note("overlay:open");
            }
            Ok(())
        }
        fn hide(&self) -> Result<(), OverlayError> {
            if cfg!(test) {
                return Ok(());
            }
            if let Some(window) = self.app.get_webview_window(WINDOW_LABEL) {
                window.destroy().map_err(|_| OverlayError::Window)?;
            }
            if self.simulated {
                self.note("overlay:hide");
            }
            Ok(())
        }
        fn focus_app(&self) -> Result<(), OverlayError> {
            if cfg!(test) {
                return Ok(());
            }
            if self.simulated {
                self.note("overlay:app");
                return Ok(());
            }
            let window = self.app.get_webview_window("main").ok_or(OverlayError::Window)?;
            window.unminimize().map_err(|_| OverlayError::Window)?;
            window.show().map_err(|_| OverlayError::Window)?;
            window.set_focus().map_err(|_| OverlayError::Window)?;
            if !wait_for_focus(&window) {
                return Err(OverlayError::Window);
            }
            Ok(())
        }
        fn is_focused(&self) -> bool {
            if cfg!(test) {
                return false;
            }
            self.app
                .get_webview_window(WINDOW_LABEL)
                .is_some_and(|window| crate::window::has_input_focus(&window).unwrap_or(false))
        }
    }

    fn wait_for_focus(window: &tauri::WebviewWindow) -> bool {
        for _ in 0..15 {
            if crate::window::has_input_focus(window).unwrap_or(false) {
                return true;
            }
            thread::sleep(Duration::from_millis(10));
        }
        false
    }

    /// Processo da prova GUI. Não abre nem procura processos do computador.
    pub(super) struct SyntheticProcess {
        pub app: AppHandle,
        pub alive: AtomicBool,
    }
    impl GameProcessControl for SyntheticProcess {
        fn process_id(&self) -> u32 {
            0
        }
        fn is_running(&self) -> bool {
            self.alive.load(Ordering::SeqCst)
        }
        fn resume(&self) -> Result<(), SessionControlError> {
            if !self.is_running() {
                return Err(SessionControlError::NotRunning);
            }
            self.app.state::<crate::test_hooks::TestHooks>().record_opened("overlay:resume");
            Ok(())
        }
        fn request_close(&self) -> Result<(), SessionControlError> {
            if !self.is_running() {
                return Err(SessionControlError::NotRunning);
            }
            self.app.state::<crate::test_hooks::TestHooks>().record_opened("overlay:close");
            self.alive.store(false, Ordering::SeqCst);
            Ok(())
        }
    }

    struct Descriptor {
        data: Vec<usize>,
        max_usages: u32,
        gate: ControllerShortcutGate,
        valid: bool,
        key: u32,
        values: Vec<HIDP_VALUE_CAPS>,
        buttons_known: bool,
        cross_held: bool,
        last_input: Option<Vec<ControllerButton>>,
    }
    pub(super) struct ShortcutInput {
        active: bool,
        hotkey: String,
        keyboard: bool,
        keyboard_armed: bool,
        raw_window: Option<HWND>,
        raw_registered: bool,
        devices: HashMap<usize, Descriptor>,
        rejected: HashSet<usize>,
        next_key: u32,
        pending_inputs: Vec<(u32, Vec<ControllerButton>)>,
        latest: Option<(u32, Vec<ControllerButton>)>,
    }
    impl ShortcutInput {
        pub fn new() -> Self {
            Self {
                active: false,
                hotkey: String::new(),
                keyboard: false,
                keyboard_armed: false,
                raw_window: None,
                raw_registered: false,
                devices: HashMap::new(),
                rejected: HashSet::new(),
                next_key: 1,
                pending_inputs: Vec::new(),
                latest: None,
            }
        }
        pub fn keyboard_available(&self) -> bool {
            self.keyboard
        }
        pub fn controller_available(&self) -> bool {
            self.raw_registered && self.devices.values().any(|device| device.valid)
        }
        pub fn take_inputs(&mut self) -> Vec<(u32, Vec<ControllerButton>)> {
            std::mem::take(&mut self.pending_inputs)
        }
        pub fn device_ready(&self, key: u32) -> bool {
            self.devices.values().any(|device| device.key == key && device.valid)
        }
        pub fn latest_input(&self, selected: Option<u32>) -> Option<(u32, Vec<ControllerButton>)> {
            self.devices
                .values()
                .find(|device| device.valid && selected.is_none_or(|key| key == device.key))
                .and_then(|device| device.last_input.clone().map(|buttons| (device.key, buttons)))
        }
        pub fn confirmation_held(&self) -> bool {
            // SAFETY: consulta apenas Enter, sem hooks nem navegação de teclado global.
            let enter = unsafe { GetAsyncKeyState(0x0d) as u16 & 0x8000 != 0 };
            enter || self.devices.values().any(|device| !device.buttons_known || device.cross_held)
        }
        pub fn reset(&mut self) {
            self.keyboard_armed = false;
            for device in self.devices.values_mut() {
                device.gate = ControllerShortcutGate::default();
            }
        }
        pub fn configure(&mut self, active: bool, hotkey: &str) {
            if self.active == active && self.hotkey == hotkey {
                return;
            }
            self.clear();
            self.active = active;
            self.hotkey = hotkey.to_string();
            if !active {
                return;
            }
            let (modifiers, key) = match hotkey {
                "CtrlF12" => (MOD_CONTROL, 0x7b),
                "AltF12" => (MOD_ALT, 0x7b),
                "CtrlAltF12" => (MOD_CONTROL | MOD_ALT, 0x7b),
                "CtrlShiftF11" => (MOD_CONTROL | MOD_SHIFT, 0x7a),
                _ => (MOD_CONTROL | MOD_SHIFT, 0x7b),
            };
            // SAFETY: todos os registros pertencem a esta thread. Nenhuma tecla é capturada por hook.
            unsafe {
                self.keyboard = RegisterHotKey(None, HOTKEY_ID, modifiers | MOD_NOREPEAT, key).is_ok();
                self.raw_window = CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    w!("STATIC"),
                    w!("Playtrove Overlay Input"),
                    WINDOW_STYLE::default(),
                    0,
                    0,
                    0,
                    0,
                    Some(HWND_MESSAGE),
                    None,
                    None,
                    None,
                )
                .ok();
                if let Some(window) = self.raw_window {
                    let device = RAWINPUTDEVICE {
                        usUsagePage: 1,
                        usUsage: 5,
                        dwFlags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY,
                        hwndTarget: window,
                    };
                    self.raw_registered = RegisterRawInputDevices(&[device], size_of::<RAWINPUTDEVICE>() as u32).is_ok();
                }
            }
        }

        pub fn poll(&mut self) -> usize {
            let mut toggles = 0;
            let mut message = MSG::default();
            // SAFETY: consome apenas mensagens da própria thread e entrega o restante ao procedimento padrão.
            unsafe {
                for _ in 0..128 {
                    if !PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                        break;
                    }
                    if self.active {
                        if message.message == WM_HOTKEY
                            && message.wParam.0 == HOTKEY_ID as usize
                            && self.keyboard
                            && self.keyboard_armed
                        {
                            self.keyboard_armed = false;
                            toggles += 1;
                        } else if message.message == WM_INPUT && self.raw_registered {
                            toggles += usize::from(self.observe_raw(HRAWINPUT(message.lParam.0 as _)));
                        } else if message.message == WM_INPUT_DEVICE_CHANGE && message.wParam.0 == 2 {
                            if let Some(device) = self.devices.remove(&(message.lParam.0 as usize))
                                && self.latest.as_ref().is_some_and(|(key, _)| *key == device.key)
                            {
                                self.latest = None;
                            }
                            self.rejected.remove(&(message.lParam.0 as usize));
                        }
                    }
                    let _ = DispatchMessageW(&message);
                }
                if self.active && [0x10, 0x11, 0x12, 0x7a, 0x7b].iter().all(|key| GetAsyncKeyState(*key) as u16 & 0x8000 == 0) {
                    self.keyboard_armed = true;
                }
            }
            toggles
        }

        fn observe_raw(&mut self, input: HRAWINPUT) -> bool {
            let Some((handle, reports)) = raw_reports(input) else {
                return false;
            };
            let id = handle.0 as usize;
            if self.rejected.contains(&id) {
                return false;
            }
            if !self.devices.contains_key(&id) {
                if self.devices.len() + self.rejected.len() >= 128 {
                    return false;
                }
                let Some(mut descriptor) = descriptor(handle) else {
                    self.rejected.insert(id);
                    return false;
                };
                descriptor.key = self.next_key;
                self.next_key = self.next_key.wrapping_add(1).max(1);
                self.devices.insert(id, descriptor);
            }
            let device = self.devices.get_mut(&id).unwrap();
            let mut trigger = false;
            for mut report in reports {
                let mut usages = vec![0u16; device.max_usages as usize];
                let mut count = device.max_usages;
                // SAFETY: os dados preparsed vieram do Windows para este dispositivo; os buffers pertencem
                // a esta chamada. HidP valida o id e comprimento, sem inferir transporte pelo pacote.
                let status = unsafe {
                    HidP_GetUsages(
                        HidP_Input,
                        9,
                        None,
                        usages.as_mut_ptr(),
                        &mut count,
                        PHIDP_PREPARSED_DATA(device.data.as_ptr() as isize),
                        &mut report,
                    )
                };
                if status != HIDP_STATUS_SUCCESS || count > device.max_usages {
                    device.valid = false;
                    device.buttons_known = false;
                    device.gate = ControllerShortcutGate::default();
                    continue;
                }
                usages.truncate(count as usize);
                device.buttons_known = true;
                device.cross_held = usages.contains(&2);
                trigger |= device.gate.observe(usages.is_empty(), usages.contains(&9) && usages.contains(&10));
                if let Some((x, y, hat)) = axes(device, &report) {
                    device.valid = true;
                    let buttons = buttons_from_hid(&usages, x, y, hat);
                    device.last_input = Some(buttons.clone());
                    if !self.latest.as_ref().is_some_and(|(key, previous)| *key == device.key && *previous == buttons) {
                        self.latest = Some((device.key, buttons.clone()));
                        self.pending_inputs.push((device.key, buttons));
                    }
                } else {
                    device.valid = false;
                }
            }
            trigger
        }

        fn clear(&mut self) {
            // SAFETY: remove somente registros feitos por este observador, na thread que os possui.
            unsafe {
                if self.keyboard {
                    let _ = UnregisterHotKey(None, HOTKEY_ID);
                }
                if self.raw_registered {
                    let device =
                        RAWINPUTDEVICE { usUsagePage: 1, usUsage: 5, dwFlags: RIDEV_REMOVE, hwndTarget: HWND::default() };
                    let _ = RegisterRawInputDevices(&[device], size_of::<RAWINPUTDEVICE>() as u32);
                }
                if let Some(window) = self.raw_window.take() {
                    let _ = DestroyWindow(window);
                }
            }
            self.keyboard = false;
            self.keyboard_armed = false;
            self.raw_registered = false;
            self.devices.clear();
            self.rejected.clear();
            self.pending_inputs.clear();
            self.latest = None;
        }
    }
    impl Drop for ShortcutInput {
        fn drop(&mut self) {
            self.clear();
        }
    }

    fn raw_reports(input: HRAWINPUT) -> Option<(HANDLE, Vec<Vec<u8>>)> {
        let mut size = 0;
        // SAFETY: primeiro consulta o tamanho; a segunda chamada recebe memória alinhada e limitada.
        unsafe {
            if GetRawInputData(input, RID_INPUT, None, &mut size, size_of::<RAWINPUTHEADER>() as u32) == u32::MAX
                || size < size_of::<RAWINPUTHEADER>() as u32 + 8
                || size > 65536
            {
                return None;
            }
            let mut data = vec![0usize; (size as usize).div_ceil(size_of::<usize>())];
            if GetRawInputData(input, RID_INPUT, Some(data.as_mut_ptr().cast()), &mut size, size_of::<RAWINPUTHEADER>() as u32)
                == u32::MAX
                || size as usize > size_of_val(data.as_slice())
            {
                return None;
            }
            let header = std::ptr::read_unaligned(data.as_ptr().cast::<RAWINPUTHEADER>());
            if header.dwType != RIM_TYPEHID.0 {
                return None;
            }
            let bytes = std::slice::from_raw_parts(data.as_ptr().cast::<u8>(), size as usize);
            let offset = size_of::<RAWINPUTHEADER>();
            let width = u32::from_le_bytes(bytes.get(offset..offset + 4)?.try_into().ok()?) as usize;
            let count = u32::from_le_bytes(bytes.get(offset + 4..offset + 8)?.try_into().ok()?) as usize;
            if width == 0 || count == 0 || count > 128 {
                return None;
            }
            let payload = bytes.get(offset + 8..offset + 8 + width.checked_mul(count)?)?;
            Some((header.hDevice, payload.chunks_exact(width).map(<[u8]>::to_vec).collect()))
        }
    }

    fn descriptor(handle: HANDLE) -> Option<Descriptor> {
        let mut info = RID_DEVICE_INFO { cbSize: size_of::<RID_DEVICE_INFO>() as u32, ..Default::default() };
        let mut size = info.cbSize;
        // SAFETY: consulte exclusivamente metadados do dispositivo que originou WM_INPUT; não abre HID.
        unsafe {
            if GetRawInputDeviceInfoW(Some(handle), RIDI_DEVICEINFO, Some((&mut info as *mut RID_DEVICE_INFO).cast()), &mut size)
                == u32::MAX
                || info.dwType != RIM_TYPEHID
            {
                return None;
            }
            let hid = info.Anonymous.hid;
            if hid.dwVendorId != 0x054c || hid.dwProductId != 0x0ce6 || hid.usUsagePage != 1 || hid.usUsage != 5 {
                return None;
            }
            let mut bytes = 0;
            if GetRawInputDeviceInfoW(Some(handle), RIDI_PREPARSEDDATA, None, &mut bytes) == u32::MAX
                || bytes == 0
                || bytes > 65536
            {
                return None;
            }
            let mut data = vec![0usize; (bytes as usize).div_ceil(size_of::<usize>())];
            if GetRawInputDeviceInfoW(Some(handle), RIDI_PREPARSEDDATA, Some(data.as_mut_ptr().cast()), &mut bytes) == u32::MAX {
                return None;
            }
            let pointer = PHIDP_PREPARSED_DATA(data.as_ptr() as isize);
            let mut caps = HIDP_CAPS::default();
            if HidP_GetCaps(pointer, &mut caps) != HIDP_STATUS_SUCCESS || caps.UsagePage != 1 || caps.Usage != 5 {
                return None;
            }
            let max_usages = HidP_MaxUsageListLength(HidP_Input, Some(9), pointer);
            if !(10..=128).contains(&max_usages) {
                return None;
            }
            if caps.NumberInputValueCaps == 0 || caps.NumberInputValueCaps > 128 {
                return None;
            }
            let mut values = vec![HIDP_VALUE_CAPS::default(); caps.NumberInputValueCaps as usize];
            let mut count = caps.NumberInputValueCaps;
            if HidP_GetValueCaps(HidP_Input, values.as_mut_ptr(), &mut count, pointer) != HIDP_STATUS_SUCCESS
                || count > caps.NumberInputValueCaps
            {
                return None;
            }
            values.truncate(count as usize);
            Some(Descriptor {
                data,
                max_usages,
                gate: ControllerShortcutGate::default(),
                valid: false,
                key: 0,
                values,
                buttons_known: false,
                cross_held: false,
                last_input: None,
            })
        }
    }

    fn axes(device: &Descriptor, report: &[u8]) -> Option<(u32, u32, u32)> {
        let value = |usage: u16| -> Option<u32> {
            let cap = device.values.iter().find(|cap| {
                if cap.UsagePage != 1 || Some(cap.ReportID) != report.first().copied() {
                    return false;
                }
                // SAFETY: IsRange é o discriminador do union fornecido pelo HID parser.
                unsafe {
                    if cap.IsRange {
                        (cap.Anonymous.Range.UsageMin..=cap.Anonymous.Range.UsageMax).contains(&usage)
                    } else {
                        cap.Anonymous.NotRange.Usage == usage
                    }
                }
            })?;
            if cap.LogicalMin != 0 || (usage != 0x39 && cap.LogicalMax != 255) || (usage == 0x39 && cap.LogicalMax != 7) {
                return None;
            }
            let mut value = 0;
            // SAFETY: o parser usa o descritor e o comprimento deste relatório; não há offsets inferidos.
            let status = unsafe {
                HidP_GetUsageValue(
                    HidP_Input,
                    1,
                    Some(cap.LinkCollection),
                    usage,
                    &mut value,
                    PHIDP_PREPARSED_DATA(device.data.as_ptr() as isize),
                    report,
                )
            };
            (status == HIDP_STATUS_SUCCESS && (usage == 0x39 || value <= 255)).then_some(value)
        };
        Some((value(0x30)?, value(0x31)?, value(0x39)?))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::game_window::{GameProcessControl, SessionControlError};

    struct FakeProcess {
        alive: AtomicBool,
        focus_succeeds: AtomicBool,
        actions: Arc<Mutex<Vec<&'static str>>>,
    }
    impl GameProcessControl for FakeProcess {
        fn process_id(&self) -> u32 {
            4242
        }
        fn is_running(&self) -> bool {
            self.alive.load(Ordering::SeqCst)
        }
        fn resume(&self) -> Result<(), SessionControlError> {
            self.actions.lock().unwrap().push("focus-game");
            if self.focus_succeeds.load(Ordering::SeqCst) { Ok(()) } else { Err(SessionControlError::OperationFailed) }
        }
        fn request_close(&self) -> Result<(), SessionControlError> {
            self.actions.lock().unwrap().push("request-close");
            Ok(())
        }
    }
    struct FakeBackend {
        process: Arc<FakeProcess>,
        targets: HashMap<i64, OverlayTarget>,
        foreground: Option<i64>,
    }
    impl FakeBackend {
        fn new() -> Self {
            let process = Arc::new(FakeProcess {
                alive: AtomicBool::new(true),
                focus_succeeds: AtomicBool::new(true),
                actions: Arc::default(),
            });
            let targets = HashMap::from([(
                7,
                OverlayTarget { game_id: 7, process: process.clone(), synthetic: true, window_token: Arc::new(()) },
            )]);
            Self { process, targets, foreground: Some(7) }
        }
    }
    impl OverlayBackend for FakeBackend {
        fn target(&self, game_id: i64) -> Result<OverlayTarget, OverlayError> {
            self.targets.get(&game_id).cloned().ok_or(OverlayError::NoActiveGame)
        }
        fn foreground_target(&self) -> Option<OverlayTarget> {
            self.foreground.and_then(|id| self.targets.get(&id).cloned())
        }
        fn show(&self, _target: &OverlayTarget) -> Result<(), OverlayError> {
            self.process.actions.lock().unwrap().push("show-overlay");
            Ok(())
        }
        fn hide(&self) -> Result<(), OverlayError> {
            self.process.actions.lock().unwrap().push("hide-overlay");
            Ok(())
        }
        fn focus_app(&self) -> Result<(), OverlayError> {
            self.process.actions.lock().unwrap().push("focus-app");
            Ok(())
        }
        fn is_focused(&self) -> bool {
            true
        }
    }

    #[test]
    fn preferencia_desligada_nao_abre_nem_usa_janela_generica() {
        let mut model = OverlayModel::new(FakeBackend::new());
        assert_eq!(model.open(7, 0), Err(OverlayError::Disabled));
        assert!(model.backend.process.actions.lock().unwrap().is_empty());
        model.configure(true);
        model.backend.foreground = None;
        assert_eq!(model.toggle(400), Err(OverlayError::NoActiveGame));
        assert!(model.backend.process.actions.lock().unwrap().is_empty());
    }

    #[test]
    fn abrir_exige_uma_sessao_viva_e_publica_somente_o_id_do_jogo() {
        let mut model = OverlayModel::new(FakeBackend::new());
        model.configure(true);
        assert_eq!(model.open(8, 0), Err(OverlayError::NoActiveGame));
        model.open(7, 0).unwrap();
        assert_eq!(
            serde_json::to_value(&model.state).unwrap(),
            serde_json::json!({"open":true,"isFocused":true,"gameId":7,"enabled":true,"keyboardShortcutAvailable":false,"controllerShortcutAvailable":false})
        );
        assert_eq!(*model.backend.process.actions.lock().unwrap(), ["show-overlay"]);
    }

    #[test]
    fn retornar_so_fecha_apos_conseguir_focar_o_processo_original() {
        let mut model = OverlayModel::new(FakeBackend::new());
        model.configure(true);
        model.open(7, 0).unwrap();
        model.backend.process.focus_succeeds.store(false, Ordering::SeqCst);
        assert_eq!(model.return_to_game(), Err(OverlayError::Session(SessionControlError::OperationFailed)));
        assert!(model.state.open);
        assert_eq!(*model.backend.process.actions.lock().unwrap(), ["show-overlay", "focus-game"]);
        model.backend.process.focus_succeeds.store(true, Ordering::SeqCst);
        model.return_to_game().unwrap();
        assert!(!model.state.open);
        assert_eq!(*model.backend.process.actions.lock().unwrap(), ["show-overlay", "focus-game", "focus-game", "hide-overlay"]);
    }

    #[test]
    fn voltar_ao_app_nao_fecha_nem_suspende_o_jogo() {
        let mut model = OverlayModel::new(FakeBackend::new());
        model.configure(true);
        model.open(7, 0).unwrap();
        model.return_to_app().unwrap();
        assert!(model.backend.process.is_running());
        assert_eq!(*model.backend.process.actions.lock().unwrap(), ["show-overlay", "focus-app", "hide-overlay"]);
    }

    #[test]
    fn saida_do_processo_original_fecha_overlay_sem_reusar_o_mesmo_game_id() {
        let mut model = OverlayModel::new(FakeBackend::new());
        model.configure(true);
        model.open(7, 0).unwrap();
        model.backend.process.alive.store(false, Ordering::SeqCst);
        model.tick().unwrap();
        assert!(!model.state.open);
        assert_eq!(model.state.game_id, None);
        assert_eq!(*model.backend.process.actions.lock().unwrap(), ["show-overlay", "hide-overlay"]);
    }

    #[test]
    fn toggle_tem_cooldown_de_350_ms() {
        let mut model = OverlayModel::new(FakeBackend::new());
        model.configure(true);
        model.toggle(0).unwrap();
        model.toggle(349).unwrap();
        assert!(model.state.open);
        model.toggle(350).unwrap();
        assert!(!model.state.open);
    }

    #[test]
    fn combo_espera_neutro_soltar_e_rearmar_apos_retorno() {
        let mut gate = ControllerShortcutGate::default();
        assert!(!gate.observe(false, true));
        assert!(!gate.observe(true, false));
        assert!(!gate.observe(false, true));
        assert!(!gate.observe(false, true));
        assert!(gate.observe(true, false));
        assert!(!gate.observe(false, true));
        assert!(!gate.observe(true, false));
        assert!(!gate.observe(false, true));
        assert!(gate.observe(true, false));
    }

    #[test]
    fn desativar_descarta_alvo_e_disponibilidade_dos_atalhos() {
        let mut model = OverlayModel::new(FakeBackend::new());
        model.configure(true);
        model.open(7, 0).unwrap();
        model.state.keyboard_shortcut_available = true;
        model.state.controller_shortcut_available = true;
        model.configure(false);
        assert!(!model.state.open);
        assert!(!model.state.keyboard_shortcut_available);
        assert!(!model.state.controller_shortcut_available);
        assert_eq!(model.state.game_id, None);
    }

    #[test]
    fn notificacao_tardia_da_janela_anterior_nao_fecha_uma_nova() {
        let mut model = OverlayModel::new(FakeBackend::new());
        model.configure(true);
        model.open(7, 0).unwrap();
        let old = model.target.as_ref().unwrap().window_token.clone();
        model.return_to_app().unwrap();
        model.open(7, 500).unwrap();
        model.window_gone(&old);
        assert!(model.state.open);
    }

    #[test]
    fn solicitar_fechamento_libera_dialogos_sem_encerrar_o_processo() {
        let mut model = OverlayModel::new(FakeBackend::new());
        model.configure(true);
        model.open(7, 0).unwrap();
        model.request_close_game().unwrap();
        assert!(!model.state.open);
        assert!(model.backend.process.is_running());
        assert_eq!(
            *model.backend.process.actions.lock().unwrap(),
            ["show-overlay", "request-close", "hide-overlay", "focus-game"]
        );
    }

    #[test]
    fn retomar_aguarda_confirmacao_soltar_e_mais_120_ms() {
        let mut gate = ReturnToGameGate::new(0);
        assert_eq!(gate.observe(0, true), ReturnDecision::Wait);
        assert_eq!(gate.observe(1000, true), ReturnDecision::Wait);
        assert_eq!(gate.observe(1100, false), ReturnDecision::Wait);
        assert_eq!(gate.observe(1219, false), ReturnDecision::Wait);
        assert_eq!(gate.observe(1220, false), ReturnDecision::Ready);
        let mut held = ReturnToGameGate::new(0);
        assert_eq!(held.observe(2500, true), ReturnDecision::TimedOut);
    }

    #[test]
    fn fechamento_aguarda_pelo_menos_350_ms_e_a_soltura_da_confirmacao() {
        let mut gate = ReturnToGameGate::for_close(0);
        assert_eq!(gate.observe(0, false), ReturnDecision::Wait);
        assert_eq!(gate.observe(349, false), ReturnDecision::Wait);
        assert_eq!(gate.observe(350, false), ReturnDecision::Ready);
        let mut held = ReturnToGameGate::for_close(0);
        assert_eq!(held.observe(350, true), ReturnDecision::Wait);
        assert_eq!(held.observe(400, false), ReturnDecision::Wait);
        assert_eq!(held.observe(520, false), ReturnDecision::Ready);
    }

    #[test]
    fn entrada_so_do_overlay_exige_neutro_apos_abertura_e_perda_de_foco() {
        use crate::controller_input::ControllerButton::Cross;
        let mut input = OverlayInputRouter::default();
        input.set_active(true);
        input.observe(1, vec![Cross]);
        assert!(input.snapshot().buttons.is_empty());
        input.observe(1, vec![]);
        input.observe(1, vec![Cross]);
        assert_eq!(input.snapshot().buttons, [Cross]);
        input.set_active(false);
        input.observe(1, vec![Cross]);
        assert!(input.snapshot().buttons.is_empty());
        input.set_active(true);
        input.observe(1, vec![Cross]);
        assert!(input.snapshot().buttons.is_empty());
    }

    #[test]
    fn outro_controle_nao_rearma_nem_troca_o_dispositivo_durante_uma_acao() {
        use crate::controller_input::ControllerButton::{Cross, Triangle};
        let mut input = OverlayInputRouter::default();
        input.set_active(true);
        input.observe(1, vec![]);
        input.observe(2, vec![]);
        input.observe(1, vec![Cross]);
        input.observe(2, vec![Triangle]);
        assert_eq!(input.snapshot().controller_key, Some(1));
        assert_eq!(input.snapshot().buttons, [Cross]);
    }

    #[test]
    fn hid_normalizado_interpreta_botao_hat_e_zona_morta_do_analogico() {
        use crate::controller_input::ControllerButton::*;
        assert_eq!(buttons_from_hid(&[2, 9, 10], 128, 128, 8), vec![Cross, Options, Create]);
        assert_eq!(buttons_from_hid(&[], 192, 64, 8), vec![Up, Right]);
        assert_eq!(buttons_from_hid(&[], 128, 128, 5), vec![Down, Left]);
        assert!(buttons_from_hid(&[], 128, 128, 8).is_empty());
    }
}
