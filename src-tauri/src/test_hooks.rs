//! Só para os testes automáticos do app (tests/app): no lugar das janelas de "Abrir" do Windows, do
//! navegador e do Explorador, que os testes nunca abrem de verdade, e para mexer no tamanho da janela.
//! Valem só com a pasta de dados dos testes (PLAYTROVE_DATA_DIR, que o app de verdade ignora); fora deles,
//! os comandos não fazem nada.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Condvar, Mutex, PoisonError};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, LogicalSize, Manager, State, WebviewWindow};

use crate::metadata::theme_downloader::{ThemeDownloader, ThemeSearchResult};
use crate::metadata::trailer_downloader::TrailerDownloader;
use crate::test_mode::test_mode;

/// Só o servidor HTTP de mentira dos testes fornece trailers aqui; ferramentas reais nunca são usadas.
pub struct TestTrailerDownloader {
    base: String,
}

impl TestTrailerDownloader {
    pub fn new(base: &str) -> Self {
        Self { base: base.trim_end_matches('/').to_string() }
    }
}

impl TrailerDownloader for TestTrailerDownloader {
    fn download(&self, video_id: &str, destination: &std::path::Path) -> Result<(), String> {
        use std::io::Read;
        let error = || "falha no trailer do servidor de testes".to_string();
        if video_id.len() != 11 || !video_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') {
            return Err(error());
        }
        let agent: ureq::Agent =
            ureq::Agent::config_builder().timeout_global(Some(std::time::Duration::from_secs(60))).build().into();
        let mut response = agent.get(&format!("{}/trailers/{video_id}.mp4", self.base)).call().map_err(|_| error())?;
        let mut output = std::fs::OpenOptions::new().write(true).create_new(true).open(destination).map_err(|_| error())?;
        let mut reader = response.body_mut().as_reader();
        std::io::copy(&mut (&mut reader).take(100 * 1024 * 1024), &mut output).map_err(|_| error())?;
        if reader.read(&mut [0; 1]).map_err(|_| error())? != 0 {
            return Err(error());
        }
        Ok(())
    }
}

/// Servidor local dos testes: nunca prepara nem executa ferramentas de áudio reais.
pub struct TestThemeDownloader {
    base: String,
}

impl TestThemeDownloader {
    pub fn new(base: &str) -> Self {
        Self { base: base.trim_end_matches('/').to_string() }
    }
}

impl ThemeDownloader for TestThemeDownloader {
    fn search(&self, title: &str, _platform: Option<&str>, query: Option<&str>) -> Result<ThemeSearchResult, String> {
        use std::io::Read;
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(std::time::Duration::from_secs(20)))
            .build()
            .into();
        let encoded = percent_encoding::utf8_percent_encode(title, percent_encoding::NON_ALPHANUMERIC);
        let query = query
            .map(|query| format!("&query={}", percent_encoding::utf8_percent_encode(query, percent_encoding::NON_ALPHANUMERIC)))
            .unwrap_or_default();
        let mut response = agent
            .get(&format!("{}/theme-search?title={encoded}{query}", self.base))
            .call()
            .map_err(|_| "falha na busca de testes")?;
        if response.status() != 200 {
            return Err("falha na busca de testes".into());
        }
        let mut bytes = Vec::new();
        response.body_mut().as_reader().take(1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| "falha na busca de testes")?;
        if bytes.len() > 1024 * 1024 {
            return Err("busca de testes grande demais".into());
        }
        serde_json::from_slice(&bytes).map_err(|_| "busca de testes inválida".into())
    }

    fn download_video(
        &self,
        video_id: &str,
        destination: &std::path::Path,
        cancel: &std::sync::atomic::AtomicBool,
    ) -> Result<(), String> {
        use std::io::{Read, Write};
        use std::sync::atomic::Ordering;
        if video_id.len() != 11 || !video_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') {
            return Err("ID de áudio de testes inválido".into());
        }
        let agent: ureq::Agent =
            ureq::Agent::config_builder().timeout_global(Some(std::time::Duration::from_secs(20))).build().into();
        let mut response =
            agent.get(&format!("{}/theme-audio/{video_id}.m4a", self.base)).call().map_err(|_| "falha no tema de testes")?;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map_err(|_| "falha ao gravar tema de testes")?;
        let mut reader = response.body_mut().as_reader();
        let mut bytes = [0; 16384];
        let mut received = 0usize;
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("tema de testes cancelado".into());
            }
            let read = reader.read(&mut bytes).map_err(|_| "falha ao receber tema de testes")?;
            if read == 0 {
                break;
            }
            received += read;
            if received > 32 * 1024 * 1024 {
                return Err("tema de testes grande demais".into());
            }
            file.write_all(&bytes[..read]).map_err(|_| "falha ao gravar tema de testes")?;
        }
        Ok(())
    }
}

/// Os testes automáticos estão rodando (com a pasta de dados deles)?
pub fn active() -> bool {
    test_mode().data_dir.is_some()
}

#[derive(Default)]
pub struct TestHooks {
    /// A resposta combinada para a próxima janela de "Abrir" (arquivo ou pasta).
    open_dialog: Mutex<Option<PathBuf>>,
    /// Os endereços e arquivos que o app pediu para abrir no navegador ou mostrar no Explorador.
    opened: Mutex<Vec<String>>,
    /// As imagens retidas (pelo caminho dentro da pasta de imagens, ex.: "8/cover.png"): o pedido espera
    /// até o teste liberar, para conferir a tela enquanto a imagem carrega.
    held_images: Mutex<HashMap<String, HeldImage>>,
    image_released: Condvar,
    /// Foco simulado nos testes do app para garantir determinismo quando outras janelas do SO estiverem ativas.
    simulated_focus: Mutex<Option<bool>>,
}

#[derive(Default)]
struct HeldImage {
    requests: u32,
    released: bool,
}

impl TestHooks {
    /// A resposta para a janela de "Abrir" que o app ia mostrar agora (sem nada combinado: cancelar).
    pub fn take_open_dialog(&self) -> Option<PathBuf> {
        self.open_dialog.lock().unwrap_or_else(PoisonError::into_inner).take()
    }

    pub fn record_opened(&self, target: &str) {
        self.opened.lock().unwrap_or_else(PoisonError::into_inner).push(target.to_string());
    }

    /// Um pedido de imagem: se o teste reteve essa imagem, espera ele liberar.
    pub fn wait_if_held(&self, path: &str) {
        let mut held = self.held_images.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(image) = held.get_mut(path) else { return };
        image.requests += 1;
        while held.get(path).is_some_and(|image| !image.released) {
            held = self.image_released.wait(held).unwrap_or_else(PoisonError::into_inner);
        }
    }

    pub fn simulated_focus(&self) -> Option<bool> {
        *self.simulated_focus.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn set_simulated_focus(&self, focused: bool) {
        *self.simulated_focus.lock().unwrap_or_else(PoisonError::into_inner) = Some(focused);
    }
}

/// O Playnite do tema Aniki fechou, nos testes ("window": voltar ao modo janela; "quit": sair).
#[tauri::command]
pub fn test_aniki_exit(app: AppHandle, kind: Value) {
    if !active() {
        return;
    }
    let kind =
        if kind.as_str() == Some("quit") { crate::aniki_session::ExitKind::Quit } else { crate::aniki_session::ExitKind::Window };
    crate::aniki_session::finish(&app, kind);
}

/// Abre o endereço no navegador padrão (nos testes, só anota).
pub fn open_in_browser(app: &AppHandle, url: &str) {
    if active() {
        app.state::<TestHooks>().record_opened(url);
    } else {
        let _ = tauri_plugin_opener::open_url(url, None::<&str>);
    }
}

/// Mostra o arquivo no Explorador, já selecionado (nos testes, só anota).
pub fn show_in_explorer(app: &AppHandle, path: &str) {
    if active() {
        app.state::<TestHooks>().record_opened(path);
    } else {
        let _ = tauri_plugin_opener::reveal_item_in_dir(path);
    }
}

/// Combina a resposta da próxima janela de "Abrir": este caminho, sem abrir nada.
#[tauri::command]
pub fn test_mock_open_dialog(hooks: State<'_, TestHooks>, path: Value) {
    if let (true, Some(path)) = (active(), path.as_str()) {
        *hooks.open_dialog.lock().unwrap_or_else(PoisonError::into_inner) = Some(PathBuf::from(path));
    }
}

/// O que o app pediu para abrir no navegador ou no Explorador até agora.
#[tauri::command]
pub fn test_opened(hooks: State<'_, TestHooks>) -> Vec<String> {
    if active() { hooks.opened.lock().unwrap_or_else(PoisonError::into_inner).clone() } else { Vec::new() }
}

/// A janela, como os testes conferem: o título, se está maximizada, o tamanho e a área livre da tela
/// (em pixels lógicos, como os da página).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestWindow {
    title: String,
    maximized: bool,
    fullscreen: bool,
    foreground: bool,
    visible: bool,
    size: [f64; 2],
    work_area: [f64; 2],
}

#[tauri::command]
pub fn test_window(window: WebviewWindow) -> Option<TestWindow> {
    if !active() {
        return None;
    }
    let scale = window.scale_factor().ok()?;
    // A área da janela, sem as bordas invisíveis que o Windows põe em volta (para puxar o tamanho).
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    let monitor = window.current_monitor().ok().flatten()?;
    let area = monitor.work_area().size.to_logical::<f64>(monitor.scale_factor());
    Some(TestWindow {
        title: window.title().ok()?,
        maximized: window.is_maximized().ok()?,
        fullscreen: window.is_fullscreen().ok()?,
        foreground: crate::window::has_input_focus(&window).ok()?,
        visible: window.is_visible().ok()?,
        size: [size.width.round(), size.height.round()],
        work_area: [area.width.round(), area.height.round()],
    })
}

/// Ativa somente a própria janela dos testes. CDP pode focar o DOM sem ativar a janela no Windows.
#[tauri::command]
pub fn test_focus_window(window: WebviewWindow) -> crate::errors::AppResult<Option<TestWindow>> {
    if !active() {
        return Ok(None);
    }
    window.unminimize()?;
    window.show()?;
    if let Some(hooks) = window.try_state::<TestHooks>() {
        hooks.set_simulated_focus(true);
    }
    let _ = window.set_focus();
    crate::window::focus_content(&window)?;
    let _ = crate::window::reconcile_state(&window)?;
    Ok(test_window(window))
}
/// Tira a janela do maximizado e deixa a área da página com este tamanho (os testes usam 1280×800).
#[tauri::command]
pub fn test_set_window_size(window: WebviewWindow, width: Value, height: Value) {
    if let (true, Some(width), Some(height)) = (active(), width.as_f64(), height.as_f64()) {
        let _ = window.unmaximize();
        let _ = window.set_size(LogicalSize::new(width, height));
    }
}

/// Retém estas imagens (caminhos dentro da pasta de imagens): os pedidos delas esperam o teste liberar.
#[tauri::command]
pub fn test_hold_images(hooks: State<'_, TestHooks>, paths: Value) {
    if !active() {
        return;
    }
    let mut held = hooks.held_images.lock().unwrap_or_else(PoisonError::into_inner);
    for path in paths.as_array().into_iter().flatten().filter_map(Value::as_str) {
        held.insert(path.to_string(), HeldImage::default());
    }
}

/// Quantos pedidos de uma imagem retida já chegaram.
#[tauri::command]
pub fn test_image_requests(hooks: State<'_, TestHooks>, path: Value) -> u32 {
    let held = hooks.held_images.lock().unwrap_or_else(PoisonError::into_inner);
    path.as_str().and_then(|path| held.get(path)).map_or(0, |image| image.requests)
}

/// Libera uma imagem retida (os pedidos que esperavam recebem o arquivo).
#[tauri::command]
pub fn test_release_image(hooks: State<'_, TestHooks>, path: Value) {
    let mut held = hooks.held_images.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(image) = path.as_str().and_then(|path| held.get_mut(path)) {
        image.released = true;
    }
    hooks.image_released.notify_all();
}

/// Injeta somente estados sintéticos na pasta de testes; nunca acessa um controle real.
#[tauri::command]
pub fn test_controller_input(
    state: State<'_, crate::state::AppState>,
    controllers: State<'_, crate::controllers::Controllers>,
    connected: Value,
    buttons: Value,
) -> crate::errors::AppResult<Option<crate::controller_input::ControllerInputSnapshot>> {
    if !active() {
        return Ok(None);
    }
    let connected = crate::validation::to_bool(&connected, state.language())?;
    let buttons = serde_json::from_value::<Vec<crate::controller_input::ControllerButton>>(buttons)
        .map_err(|_| crate::errors::AppError::text(state.language(), "errors.invalidValue", &[]))?;
    Ok(Some(controllers.inject_test_input(connected, buttons)))
}
