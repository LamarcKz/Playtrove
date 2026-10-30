//! Splash nativo do Aniki Helper (MIT): uma janela por lançamento, presa ao Arc original da sessão.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::game_window::GameProcessControl;
use crate::launch_splash_state::{DEFAULT_MAXIMUM_WAIT_MS, DEFAULT_MINIMUM_MS, Phase, ReadyIdentity, SplashTimeline};

pub const WINDOW_LABEL: &str = "game-launch-splash";
pub const STATE_EVENT: &str = "game-launch-splash:state";
pub const LOGO_POSITIONS: [&str; 9] =
    ["leftTop", "leftCenter", "leftBottom", "centerTop", "center", "centerBottom", "rightTop", "rightCenter", "rightBottom"];

#[derive(Clone, Debug)]
pub struct SplashOptions {
    pub enabled: bool,
    pub minimum_duration_ms: u64,
    pub maximum_wait_ms: u64,
    pub show_logo: bool,
    pub logo_position: String,
    pub background_dimming: f64,
    /// Primeiro passo: prioridade do fundo do jogo ou somente global, ambas com imagens estáticas.
    pub selection_mode: String,
}

impl Default for SplashOptions {
    fn default() -> Self {
        Self {
            enabled: true,
            minimum_duration_ms: DEFAULT_MINIMUM_MS,
            maximum_wait_ms: DEFAULT_MAXIMUM_WAIT_MS,
            show_logo: true,
            logo_position: "leftCenter".into(),
            background_dimming: 95.0 / 255.0,
            selection_mode: "automatic".into(),
        }
    }
}

impl From<&crate::fullscreen::FullscreenConfig> for SplashOptions {
    fn from(config: &crate::fullscreen::FullscreenConfig) -> Self {
        Self {
            enabled: config.game_launch_splash_enabled,
            minimum_duration_ms: config.game_launch_splash_minimum_duration_ms,
            maximum_wait_ms: config.game_launch_splash_maximum_wait_ms,
            show_logo: config.game_launch_splash_show_logo,
            logo_position: config.game_launch_splash_logo_position.clone(),
            background_dimming: config.game_launch_splash_background_dimming,
            selection_mode: config.game_launch_splash_selection_mode.clone(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct SplashMedia {
    pub title: String,
    pub game_background_url: Option<String>,
    pub global_url: Option<String>,
    pub logo_url: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SplashPhase {
    Launching,
    Waiting,
    Closing,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplashState {
    pub generation: u64,
    pub open: bool,
    pub game_id: Option<i64>,
    pub title: String,
    pub phase: Option<SplashPhase>,
    pub source: String,
    pub image_url: Option<String>,
    pub logo_url: Option<String>,
    pub show_logo: bool,
    pub logo_position: String,
    pub background_dimming: f64,
    pub global_available: bool,
}

impl Default for SplashState {
    fn default() -> Self {
        Self {
            generation: 0,
            open: false,
            game_id: None,
            title: String::new(),
            phase: None,
            source: "black".into(),
            image_url: None,
            logo_url: None,
            show_logo: true,
            logo_position: "leftCenter".into(),
            background_dimming: 95.0 / 255.0,
            global_available: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SplashError {
    Disabled,
    InvalidOptions,
    InvalidMedia,
    Window,
    ServiceStopped,
    Superseded,
}

fn internal_image(url: &str) -> bool {
    let Ok(url) = tauri::Url::parse(url) else { return false };
    url.scheme() == "http"
        && matches!(url.host_str(), Some("playtrove-img.localhost" | "playtrove-theme.localhost" | "playtrove-gallery.localhost"))
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && ["png", "jpg", "jpeg", "webp", "bmp", "jfif", "gif", "svg", "ico"]
            .iter()
            .any(|extension| url.path().to_ascii_lowercase().ends_with(&format!(".{extension}")))
}

fn prepare_state(token: u64, game_id: i64, options: &SplashOptions, media: SplashMedia) -> Result<SplashState, SplashError> {
    if !options.enabled {
        return Err(SplashError::Disabled);
    }
    if game_id <= 0
        || !(500..=600000).contains(&options.minimum_duration_ms)
        || !(1000..=120000).contains(&options.maximum_wait_ms)
        || !options.background_dimming.is_finite()
        || !(0.0..=0.8).contains(&options.background_dimming)
        || !LOGO_POSITIONS.contains(&options.logo_position.as_str())
        || !["automatic", "global"].contains(&options.selection_mode.as_str())
    {
        return Err(SplashError::InvalidOptions);
    }
    if [&media.game_background_url, &media.global_url, &media.logo_url]
        .iter()
        .any(|url| url.as_ref().is_some_and(|url| !internal_image(url)))
    {
        return Err(SplashError::InvalidMedia);
    }
    let global_available = media.global_url.is_some();
    let (source, image_url) = if options.selection_mode == "automatic" && media.game_background_url.is_some() {
        ("gameBackground", media.game_background_url)
    } else if media.global_url.is_some() {
        ("global", media.global_url)
    } else {
        ("black", None)
    };
    Ok(SplashState {
        generation: token,
        open: true,
        game_id: Some(game_id),
        title: media.title,
        phase: Some(SplashPhase::Launching),
        source: source.into(),
        image_url,
        logo_url: media.logo_url,
        show_logo: options.show_logo,
        logo_position: options.logo_position.clone(),
        background_dimming: options.background_dimming,
        global_available,
    })
}

trait SplashBackend {
    fn show(&self, token: u64, synthetic: bool) -> Result<(), SplashError>;
    fn hide(&self, token: u64);
    fn ready(&self, process: &dyn GameProcessControl, synthetic: bool) -> Option<ReadyIdentity>;
    fn rendered(&self, _token: u64) {}
}

struct SplashActor<B> {
    backend: B,
    state: SplashState,
    timeline: Option<SplashTimeline>,
    process: Option<Arc<dyn GameProcessControl>>,
    synthetic: bool,
}

impl<B: SplashBackend> SplashActor<B> {
    fn new(backend: B) -> Self {
        Self { backend, state: SplashState::default(), timeline: None, process: None, synthetic: false }
    }

    fn begin(
        &mut self,
        token: u64,
        game_id: i64,
        options: SplashOptions,
        media: SplashMedia,
        now: u64,
    ) -> Result<(), SplashError> {
        self.begin_kind(token, game_id, options, media, now, false)
    }

    fn begin_kind(
        &mut self,
        token: u64,
        game_id: i64,
        options: SplashOptions,
        media: SplashMedia,
        now: u64,
        synthetic: bool,
    ) -> Result<(), SplashError> {
        if token <= self.state.generation {
            return Err(SplashError::Superseded);
        }
        let state = prepare_state(token, game_id, &options, media)?;
        self.stop();
        self.backend.show(token, synthetic)?;
        self.state = state;
        self.synthetic = synthetic;
        self.timeline = Some(SplashTimeline::new(token, now, options.minimum_duration_ms, options.maximum_wait_ms));
        Ok(())
    }

    fn started(&mut self, token: u64, process: Arc<dyn GameProcessControl>, now: u64) {
        if let Some(timeline) = &mut self.timeline
            && timeline.started(token, now)
        {
            self.process = Some(process);
            self.state.phase = Some(SplashPhase::Waiting);
        }
    }

    fn rendered(&mut self, token: u64, now: u64) {
        if let Some(timeline) = &mut self.timeline
            && timeline.rendered(token, now)
        {
            self.backend.rendered(token);
        }
    }

    fn failed(&mut self, token: u64, now: u64) {
        if let Some(timeline) = &mut self.timeline {
            timeline.failed(token, now);
        }
        self.tick(now);
    }

    fn window_gone(&mut self, token: u64) {
        if self.timeline.as_ref().is_some_and(|timeline| timeline.token() == token) {
            self.stop();
        }
    }

    fn hide_state(&mut self) {
        self.state.open = false;
        self.state.phase = None;
        self.state.game_id = None;
        self.state.title.clear();
        self.state.image_url = None;
        self.state.logo_url = None;
        self.timeline = None;
        self.process = None;
    }

    fn stop(&mut self) {
        if let Some(timeline) = &self.timeline {
            self.backend.hide(timeline.token());
        }
        self.hide_state();
    }

    fn tick(&mut self, now: u64) {
        let Some(timeline) = &mut self.timeline else { return };
        let alive = self.process.as_ref().map(|process| process.is_running());
        let ready = if timeline.phase() == Phase::Waiting && alive == Some(true) {
            self.process.as_ref().and_then(|process| self.backend.ready(process.as_ref(), self.synthetic))
        } else {
            None
        };
        timeline.tick(now, alive, ready);
        match timeline.phase() {
            Phase::Hidden => {
                debug_assert!(timeline.reason().is_some());
                let token = timeline.token();
                self.backend.hide(token);
                self.hide_state();
            }
            Phase::Closing => self.state.phase = Some(SplashPhase::Closing),
            _ => {}
        }
    }

    fn wake_after(&self, now: u64) -> Option<u64> {
        self.timeline.as_ref().and_then(|timeline| timeline.wake_after(now))
    }
}

enum Message {
    Begin(u64, i64, SplashOptions, SplashMedia, Sender<Result<(), SplashError>>),
    Started(u64, Arc<dyn GameProcessControl>),
    Rendered(u64),
    Failed(u64),
    WindowGone(u64),
    TestOpen(u64, i64, bool, Sender<Result<SplashState, SplashError>>),
    Stop,
}

pub struct GameLaunchSplash {
    sender: Sender<Message>,
    state: Arc<Mutex<SplashState>>,
    generation: AtomicU64,
    stopped: Arc<AtomicBool>,
    native: bool,
}

impl Drop for GameLaunchSplash {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl GameLaunchSplash {
    pub fn start(app: AppHandle, webview_folder: PathBuf) -> Self {
        let (sender, receiver) = mpsc::channel();
        let state = Arc::new(Mutex::new(SplashState::default()));
        let stopped = Arc::new(AtomicBool::new(false));
        let native = !cfg!(test) && crate::test_mode::test_mode().data_dir.is_none();
        let worker_state = state.clone();
        let worker_stopped = stopped.clone();
        thread::spawn(move || run_worker(app, webview_folder, receiver, worker_state, worker_stopped, native));
        Self { sender, state, generation: AtomicU64::new(1), stopped, native }
    }

    pub fn get_state(&self) -> SplashState {
        self.state.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    pub fn begin(&self, game_id: i64, options: SplashOptions, media: SplashMedia) -> Result<u64, SplashError> {
        if !self.native {
            return Err(SplashError::Disabled);
        }
        let token = self.generation.fetch_add(1, Ordering::Relaxed);
        let (reply, receive) = mpsc::channel();
        self.send(Message::Begin(token, game_id, options, media, reply))?;
        receive.recv_timeout(Duration::from_secs(15)).map_err(|_| SplashError::ServiceStopped)??;
        Ok(token)
    }

    pub fn started(&self, token: u64, process: Arc<dyn GameProcessControl>) -> Result<(), SplashError> {
        self.send(Message::Started(token, process))
    }
    pub fn failed(&self, token: u64) -> Result<(), SplashError> {
        self.send(Message::Failed(token))
    }
    pub fn rendered(&self, token: u64) -> Result<(), SplashError> {
        self.send(Message::Rendered(token))
    }

    pub fn open_test_game(&self, game_id: i64) -> Result<SplashState, SplashError> {
        self.open_test_game_with_failure(game_id, false)
    }

    pub fn open_test_game_with_failure(&self, game_id: i64, failed: bool) -> Result<SplashState, SplashError> {
        if !cfg!(debug_assertions) || !crate::test_hooks::active() {
            return Err(SplashError::Disabled);
        }
        let token = self.generation.fetch_add(1, Ordering::Relaxed);
        let (reply, receive) = mpsc::channel();
        self.send(Message::TestOpen(token, game_id, failed, reply))?;
        receive.recv_timeout(Duration::from_secs(15)).map_err(|_| SplashError::ServiceStopped)?
    }

    pub fn shutdown(&self) {
        if !self.stopped.swap(true, Ordering::SeqCst) {
            let _ = self.sender.send(Message::Stop);
        }
    }
    fn send(&self, message: Message) -> Result<(), SplashError> {
        if self.stopped.load(Ordering::SeqCst) {
            return Err(SplashError::ServiceStopped);
        }
        self.sender.send(message).map_err(|_| SplashError::ServiceStopped)
    }
}

fn run_worker(
    app: AppHandle,
    webview_folder: PathBuf,
    receiver: Receiver<Message>,
    state: Arc<Mutex<SplashState>>,
    stopped: Arc<AtomicBool>,
    native: bool,
) {
    let mut actor = SplashActor::new(NativeBackend { app: app.clone(), webview_folder, token: AtomicU64::new(0), native });
    let clock = Instant::now();
    loop {
        let now = clock.elapsed().as_millis() as u64;
        let received = match actor.wake_after(now) {
            Some(delay) => receiver.recv_timeout(Duration::from_millis(delay)),
            None => receiver.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
        };
        let now = clock.elapsed().as_millis() as u64;
        match received {
            Ok(Message::Begin(token, id, options, media, reply)) => {
                let result = actor.begin(token, id, options, media, now);
                publish(&app, &state, &actor.state);
                // O chamador que desistiu do pedido não deixa uma janela órfã para outro lançamento.
                if reply.send(result).is_err() {
                    actor.stop();
                }
            }
            Ok(Message::Started(token, process)) => actor.started(token, process, now),
            Ok(Message::Rendered(token)) => actor.rendered(token, now),
            Ok(Message::Failed(token)) => actor.failed(token, now),
            Ok(Message::WindowGone(token)) => actor.window_gone(token),
            Ok(Message::TestOpen(token, id, failed, reply)) => {
                let options = {
                    let config = crate::fullscreen::get_config(&app.state::<crate::state::AppState>().db());
                    SplashOptions::from(&config)
                };
                let media = if cfg!(debug_assertions) && crate::test_hooks::active() {
                    media_for_game(&app.state::<crate::state::AppState>(), &app.state::<crate::images::ImagesDir>(), id)
                        .map_err(|_| SplashError::InvalidMedia)
                } else {
                    Err(SplashError::Disabled)
                };
                let result = media.and_then(|media| {
                    actor.begin_kind(token, id, options, media, now, true)?;
                    if failed {
                        actor.failed(token, now);
                    } else {
                        actor.started(token, Arc::new(SyntheticProcess), now);
                    }
                    Ok(actor.state.clone())
                });
                publish(&app, &state, &actor.state);
                if reply.send(result).is_err() {
                    actor.stop();
                }
            }
            Ok(Message::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        actor.tick(clock.elapsed().as_millis() as u64);
        publish(&app, &state, &actor.state);
    }
    actor.stop();
    publish(&app, &state, &actor.state);
    stopped.store(true, Ordering::SeqCst);
}

fn publish(app: &AppHandle, shared: &Mutex<SplashState>, next: &SplashState) {
    let changed = {
        let mut current = shared.lock().unwrap_or_else(PoisonError::into_inner);
        if *current == *next {
            false
        } else {
            *current = next.clone();
            true
        }
    };
    if changed {
        let _ = app.emit(STATE_EVENT, next);
    }
}

struct NativeBackend {
    app: AppHandle,
    webview_folder: PathBuf,
    token: AtomicU64,
    native: bool,
}

struct SyntheticProcess;
impl GameProcessControl for SyntheticProcess {
    fn process_id(&self) -> u32 {
        42
    }
    fn is_running(&self) -> bool {
        true
    }
    fn resume(&self) -> Result<(), crate::game_window::SessionControlError> {
        Err(crate::game_window::SessionControlError::ControlUnavailable)
    }
    fn request_close(&self) -> Result<(), crate::game_window::SessionControlError> {
        Err(crate::game_window::SessionControlError::ControlUnavailable)
    }
}

/// Lê somente dados da biblioteca e devolve URLs internas de imagens que existem. O guard do banco
/// termina antes de consultar o global ou criar qualquer janela.
pub(crate) fn media_for_game(
    state: &crate::state::AppState,
    images: &crate::images::ImagesDir,
    game_id: i64,
) -> crate::errors::AppResult<SplashMedia> {
    let (title, background, logo, version): (String, Option<String>, Option<String>, Option<String>) = state.db().query_row(
        "SELECT title, background_image, logo_image, metadata_updated_at FROM games WHERE id = ?1",
        [game_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let global_url = crate::aniki_custom_media::get_global_splash(state.database(), state.language(), &images.0)?;
    let image = |file: Option<String>| {
        file.filter(|file| {
            let mut components = std::path::Path::new(file).components();
            matches!(components.next(), Some(std::path::Component::Normal(_)))
                && components.next().is_none()
                && images.0.join(game_id.to_string()).join(file).is_file()
        })
        .map(|file| crate::images::image_url(game_id, &file, version.as_deref()))
    };
    Ok(SplashMedia { title, game_background_url: image(background), global_url, logo_url: image(logo) })
}

impl SplashBackend for NativeBackend {
    fn show(&self, token: u64, synthetic: bool) -> Result<(), SplashError> {
        use tauri::{PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent, window::Color};
        if cfg!(test) || (!self.native && !(synthetic && cfg!(debug_assertions) && crate::test_hooks::active())) {
            return Err(SplashError::Disabled);
        }
        let main = self.app.get_webview_window("main").ok_or(SplashError::Window)?;
        let monitor = main
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| self.app.primary_monitor().ok().flatten())
            .ok_or(SplashError::Window)?;
        let language = self.app.state::<crate::state::AppState>().language();
        let query = format!("index.html?gameLaunchSplash=1&generation={token}&lang={}", language.id());
        let browser_args = crate::window::browser_args();
        let window = WebviewWindowBuilder::new(&self.app, WINDOW_LABEL, WebviewUrl::App(query.into()))
            .title(if cfg!(debug_assertions) { "Playtrove Dev" } else { "Playtrove" })
            .decorations(false)
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .focused(false)
            .focusable(false)
            .transparent(true)
            .visible(false)
            .background_color(Color(0, 0, 0, 255))
            .data_directory(self.webview_folder.clone())
            .additional_browser_args(&browser_args)
            .on_navigation(|url| match url.host_str() {
                Some("tauri.localhost") => true,
                Some("localhost") => cfg!(debug_assertions) && url.port() == Some(1420),
                _ => false,
            })
            .build()
            .map_err(|_| SplashError::Window)?;
        let opened = (|| {
            let position = monitor.position();
            let size = monitor.size();
            window.set_position(PhysicalPosition::new(position.x, position.y)).map_err(|_| SplashError::Window)?;
            window.set_size(PhysicalSize::new(size.width, size.height)).map_err(|_| SplashError::Window)?;
            window.set_ignore_cursor_events(true).map_err(|_| SplashError::Window)?;
            window.show().map_err(|_| SplashError::Window)
        })();
        if opened.is_err() {
            let _ = window.destroy();
            return opened;
        }
        self.token.store(token, Ordering::SeqCst);
        if synthetic {
            self.app.state::<crate::test_hooks::TestHooks>().record_opened("launch-splash:open");
        }
        let app = self.app.clone();
        window.on_window_event(move |event| {
            if let Some(service) = app.try_state::<GameLaunchSplash>() {
                match event {
                    WindowEvent::Destroyed => {
                        let _ = service.send(Message::WindowGone(token));
                    }
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = service.failed(token);
                    }
                    _ => {}
                }
            }
        });
        Ok(())
    }

    fn hide(&self, token: u64) {
        if cfg!(test) {
            return;
        }
        if self.token.compare_exchange(token, 0, Ordering::SeqCst, Ordering::SeqCst).is_ok()
            && let Some(window) = self.app.get_webview_window(WINDOW_LABEL)
        {
            let _ = window.destroy();
            if !self.native {
                self.app.state::<crate::test_hooks::TestHooks>().record_opened("launch-splash:hide");
            }
        }
    }
    fn ready(&self, process: &dyn GameProcessControl, synthetic: bool) -> Option<ReadyIdentity> {
        if synthetic {
            return Some(ReadyIdentity { process_id: process.process_id(), window_id: 1 });
        }
        if self.native && !cfg!(test) { crate::game_window::ready_window(process) } else { None }
    }
    fn rendered(&self, token: u64) {
        if !cfg!(test)
            && self.token.load(Ordering::SeqCst) == token
            && let Some(window) = self.app.get_webview_window(WINDOW_LABEL)
        {
            // O renderer já apresentou dois quadros opacos; só agora a superfície permite o fade.
            let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_window::SessionControlError;
    use crate::launch_splash_state::CloseReason;

    struct FakeProcess {
        alive: AtomicBool,
        resumed: AtomicU64,
    }
    impl GameProcessControl for FakeProcess {
        fn process_id(&self) -> u32 {
            42
        }
        fn is_running(&self) -> bool {
            self.alive.load(Ordering::SeqCst)
        }
        fn resume(&self) -> Result<(), SessionControlError> {
            self.resumed.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
        fn request_close(&self) -> Result<(), SessionControlError> {
            panic!("splash nunca fecha o processo")
        }
    }
    #[derive(Default)]
    struct FakeBackend {
        actions: Mutex<Vec<(bool, u64)>>,
        overlay_open: AtomicBool,
    }
    impl SplashBackend for FakeBackend {
        fn show(&self, token: u64, _synthetic: bool) -> Result<(), SplashError> {
            self.actions.lock().unwrap().push((true, token));
            Ok(())
        }
        fn hide(&self, token: u64) {
            self.actions.lock().unwrap().push((false, token));
        }
        fn ready(&self, process: &dyn GameProcessControl, _synthetic: bool) -> Option<ReadyIdentity> {
            Some(ReadyIdentity { process_id: process.process_id(), window_id: 10 })
        }
    }
    fn media() -> SplashMedia {
        SplashMedia {
            title: "Game Test".into(),
            game_background_url: Some("http://playtrove-img.localhost/1/background.png".into()),
            global_url: Some("http://playtrove-img.localhost/profile/splash-global-test.png".into()),
            logo_url: None,
        }
    }
    fn process() -> Arc<FakeProcess> {
        Arc::new(FakeProcess { alive: AtomicBool::new(true), resumed: AtomicU64::new(0) })
    }

    #[test]
    fn prioridade_real_e_global_indisponivel_sao_explicitos() {
        let automatic = prepare_state(1, 1, &SplashOptions::default(), media()).unwrap();
        assert_eq!(automatic.source, "gameBackground");
        assert!(automatic.global_available);
        let global = SplashOptions { selection_mode: "global".into(), ..Default::default() };
        assert_eq!(prepare_state(1, 1, &global, media()).unwrap().source, "global");
        let missing = prepare_state(1, 1, &global, SplashMedia::default()).unwrap();
        assert_eq!(missing.source, "black");
        assert!(!missing.global_available);
    }

    #[test]
    fn urls_externas_arquivos_e_videos_nao_sao_aceitos() {
        for invalid in [
            "file:///temporary/image.png",
            "https://example.test/image.png",
            "http://playtrove-img.localhost.example.test/image.png",
            "http://playtrove-img.localhost:123/image.png",
            "http://playtrove-theme.localhost/aniki/video.mp4",
        ] {
            let bad = SplashMedia { global_url: Some(invalid.into()), ..media() };
            assert_eq!(prepare_state(1, 1, &SplashOptions::default(), bad), Err(SplashError::InvalidMedia));
        }
    }

    #[test]
    fn preferencia_invalida_nao_remove_splash_atual() {
        let mut actor = SplashActor::new(FakeBackend::default());
        actor.begin(1, 1, SplashOptions::default(), media(), 0).unwrap();
        let invalid = SplashOptions { background_dimming: f64::NAN, ..Default::default() };
        assert_eq!(actor.begin(2, 2, invalid, media(), 100), Err(SplashError::InvalidOptions));
        assert_eq!(actor.state.generation, 1);
        assert!(actor.state.open);
    }

    #[test]
    fn token_antigo_nao_fecha_novo_nem_substitui_arc_original() {
        let mut actor = SplashActor::new(FakeBackend::default());
        actor.begin(1, 1, SplashOptions::default(), media(), 0).unwrap();
        actor.begin(2, 2, SplashOptions::default(), media(), 100).unwrap();
        let original = process();
        actor.started(2, original.clone(), 100);
        actor.started(1, process(), 200);
        actor.failed(1, 300);
        actor.window_gone(1);
        assert!(actor.state.open);
        original.alive.store(false, Ordering::SeqCst);
        actor.tick(400);
        assert_eq!(actor.timeline.as_ref().unwrap().reason(), Some(CloseReason::ProcessExited));
    }

    #[test]
    fn splash_visual_nunca_retorna_foco_mesmo_apos_fade_e_alt_tab() {
        for overlay in [false, true] {
            let mut actor = SplashActor::new(FakeBackend::default());
            actor.backend.overlay_open.store(overlay, Ordering::SeqCst);
            actor.begin(1, 1, SplashOptions::default(), media(), 0).unwrap();
            actor.rendered(1, 0);
            let process = process();
            actor.started(1, process.clone(), 0);
            for now in [2400, 2900, 3400, 3900, 4320] {
                actor.tick(now);
            }
            assert!(!actor.state.open);
            assert_eq!(process.resumed.load(Ordering::SeqCst), 0);
            actor.window_gone(1);
            actor.tick(4439);
            assert_eq!(process.resumed.load(Ordering::SeqCst), 0);
            actor.tick(4440);
            assert_eq!(process.resumed.load(Ordering::SeqCst), 0);
            assert_eq!(actor.wake_after(4440), None);
        }
    }

    #[test]
    fn begin_atrasado_na_fila_nao_substitui_geracao_mais_nova() {
        let mut actor = SplashActor::new(FakeBackend::default());
        actor.begin(2, 2, SplashOptions::default(), media(), 0).unwrap();
        assert!(actor.begin(1, 1, SplashOptions::default(), media(), 100).is_err());
        assert_eq!(actor.state.generation, 2);
        assert_eq!(actor.state.game_id, Some(2));
    }

    #[test]
    fn encerramento_real_ou_servico_parado_nunca_solicitam_fechar_ou_focar() {
        let mut actor = SplashActor::new(FakeBackend::default());
        actor.begin(1, 1, SplashOptions::default(), media(), 0).unwrap();
        let process = process();
        actor.started(1, process.clone(), 0);
        process.alive.store(false, Ordering::SeqCst);
        actor.tick(1);
        actor.tick(421);
        actor.stop();
        assert!(!actor.state.open);
        assert_eq!(process.resumed.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn midia_compartilhada_so_devolve_arquivos_presentes_e_libera_guard_do_banco() {
        let db = crate::test_support::memory_database();
        let language = crate::i18n::Language::PtBr;
        let game_id = crate::library::add_emulated_game(
            &db,
            language,
            &crate::library::EmulatedGame {
                title: "Game Test",
                rom_path: "game-test.iso",
                platform: "Platform Test",
                library: "Library Test",
                emulator: crate::emulators::EmulatorId::Pcsx2,
                core: None,
            },
        )
        .unwrap()
        .unwrap();
        db.execute("UPDATE games SET background_image='background.png', logo_image='logo.png' WHERE id=?1", [game_id]).unwrap();
        let images = crate::images::ImagesDir(crate::test_support::temp_folder("launch-splash-media"));
        crate::test_support::create_files(&images.0, &[(&format!("{game_id}/background.png"), "fake-image")]);
        let state = crate::state::AppState::new(db, language);
        let media = media_for_game(&state, &images, game_id).unwrap();
        assert_eq!(media.title, "Game Test");
        assert!(media.game_background_url.unwrap().starts_with("http://playtrove-img.localhost/"));
        assert_eq!(media.logo_url, None);
        assert_eq!(media.global_url, None);
        assert!(state.database().try_lock().is_ok());
    }
}
