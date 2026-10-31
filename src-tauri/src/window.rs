//! A janela principal: sem a barra padrão do Windows (a barra do topo é a da interface), aberta já
//! maximizada e com o idioma e a marca DEV no endereço.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

use serde::Serialize;
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::controllers::Controllers;
use crate::i18n::Language;
use crate::state::AppState;
use crate::test_mode::test_mode;

pub const MAIN_WINDOW: &str = "main";

/// O aviso de quando a janela maximiza ou restaura (o canal window:state da interface).
const WINDOW_STATE_EVENT: &str = "window:state";

/// Cor de fundo da janela enquanto a interface carrega: a mesma de --background no tema escuro.
const BACKGROUND_COLOR: Color = Color(0x12, 0x16, 0x1d, 0xff);

/// As opções que o Tauri já passa ao WebView2 (sem o mini menu do Edge e sem o SmartScreen). Quem passa
/// outras precisa repetir estas.
const WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
/// O app é local: a música tema, os sons da navegação e os trailers tocam sem esperar um clique (quem abre
/// direto na tela cheia e usa só o controle nunca clica, e o WebView2 bloquearia o áudio).
const AUTOPLAY_ARGS: &str = "--autoplay-policy=no-user-gesture-required";

/// As opções do WebView2 da janela (mais a porta da depuração, nos testes do app).
fn browser_args() -> String {
    let mut arguments = format!("{WEBVIEW_ARGS} {AUTOPLAY_ARGS}");
    if let Some(port) = test_mode().remote_debugging_port {
        arguments.push_str(&format!(" --remote-debugging-port={port} --enable-logging --v=0"));
    }
    arguments
}

/// O que a interface sabe da janela.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub is_maximized: bool,
    pub is_fullscreen: bool,
    pub is_focused: bool,
}

impl WindowState {
    fn signature(&self) -> u8 {
        u8::from(self.is_maximized) | (u8::from(self.is_fullscreen) << 1) | (u8::from(self.is_focused) << 2)
    }
}

/// Deduplica maximização, tela cheia e foco nativo; eventos intermediários de uma transição não chegam à interface.
struct WindowStateTracker {
    last: AtomicU8,
    transitioning: AtomicBool,
}

impl Default for WindowStateTracker {
    fn default() -> Self {
        Self { last: AtomicU8::new(8), transitioning: AtomicBool::new(false) }
    }
}

/// A marca DEV (no título da janela e no logo) em tudo o que roda o código em desenvolvimento: o modo
/// de desenvolvimento, com a cópia da biblioteca ("library"), e os testes automáticos ("tests"), para
/// as janelas nunca parecerem o app de verdade (pedido do usuário em 2026-10-14). Só as capturas de
/// tela do README ficam sem ela.
fn dev_mark() -> Option<&'static str> {
    if !cfg!(debug_assertions) || test_mode().hide_dev_mark {
        return None;
    }
    Some(if test_mode().data_dir.is_some() { "tests" } else { "library" })
}

/// O tamanho da janela fora do maximizado.
const RESTORED_SIZE: (f64, f64) = (1280.0, 800.0);

/// O tamanho da janela quando ela sai do maximizado: 1280×800 ou, numa tela menor, a área livre dela (sem
/// a barra de tarefas). Sem isso, o Windows deixaria a janela passar da tela, por baixo da barra.
fn restored_size(app: &AppHandle) -> (f64, f64) {
    let (width, height) = RESTORED_SIZE;
    match app.primary_monitor().ok().flatten() {
        Some(monitor) => {
            let area = monitor.work_area().size.to_logical::<f64>(monitor.scale_factor());
            (width.min(area.width), height.min(area.height))
        }
        None => (width, height),
    }
}

/// Cria a janela principal. O idioma vai no endereço da interface (?lang=en), para a primeira tela já
/// aparecer no idioma certo.
///
/// O navegador da janela (WebView2) guarda o que precisa numa pasta dentro da pasta de dados desta vez
/// (`webview_folder`): o app de verdade, o modo de desenvolvimento e os testes ficam cada um com a sua.
/// Numa pasta só, uma janela não abre enquanto outra estiver aberta com outras opções.
pub fn create_main_window(app: &AppHandle, language: Language, webview_folder: PathBuf) -> tauri::Result<WebviewWindow> {
    app.manage(WindowStateTracker::default());
    let start_fullscreen = crate::fullscreen::get_config(&app.state::<AppState>().db()).start_on_launch;
    let mut query = format!("lang={}", language.id());
    if let Some(mark) = dev_mark() {
        query.push_str(&format!("&dev={mark}"));
    }
    let (width, height) = restored_size(app);
    let mut builder = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App(format!("index.html?{query}").into()))
        .title(if cfg!(debug_assertions) { "Playtrove Dev" } else { "Playtrove" })
        .inner_size(width, height)
        .min_inner_size(960.0, 600.0)
        .decorations(false)
        .background_color(BACKGROUND_COLOR)
        .maximized(true)
        .data_directory(webview_folder)
        // Segurança: a janela nunca sai do endereço da própria interface.
        .on_navigation(is_app_url);
    // Nos testes do app, a janela aceita o Playwright por esta porta, e o WebView2 guarda o registro dele
    // na pasta de dados (para o erro, se ela não abrir). Pela variável WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    // não dá: o Windows do robô dos testes ignora.
    builder = builder.additional_browser_args(&browser_args());
    let window = builder.build()?;
    send_state_changes(&window);
    if start_fullscreen {
        if let Err(error) = set_fullscreen(&window, true) {
            eprintln!("não foi possível iniciar em tela cheia: {error}");
        }
        // Abrindo direto na tela cheia, ninguém clicou na janela: sem pedir o primeiro plano, o Windows deixa o
        // foco com quem abriu o app, e o controle, a música e os trailers ficam parados até um Alt+Tab.
        let _ = window.set_focus();
        let _ = focus_content(&window);
    } else {
        reconcile_state(&window)?;
    }
    Ok(window)
}

/// Traz a janela principal para a frente (abriram o app de novo com ele já aberto).
#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn bring_to_front(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = focus_content(&window);
    }
}

/// É o endereço da interface? (O build, servido pelo Tauri, ou o Vite, no modo de desenvolvimento.)
fn is_app_url(url: &Url) -> bool {
    match url.host_str() {
        Some("tauri.localhost") => true,
        Some("localhost") => cfg!(debug_assertions) && url.port() == Some(1420),
        _ => false,
    }
}

/// No Windows, o foco pode estar no HWND filho do WebView2 enquanto o getter do Tao consulta o pai.
/// A janela de primeiro plano identifica o app ativo sem confundir essa transferência interna.
pub fn has_input_focus(window: &WebviewWindow) -> tauri::Result<bool> {
    if window.is_minimized().unwrap_or(false) {
        return Ok(false);
    }
    if crate::test_mode::test_mode().data_dir.is_some()
        && let Some(hooks) = window.try_state::<crate::test_hooks::TestHooks>()
        && let Some(focused) = hooks.simulated_focus()
    {
        return Ok(focused);
    }
    let hwnd = window.hwnd()?;
    // SAFETY: consulta somente o identificador da janela ativa, sem alterar foco ou acessar seu conteúdo.
    Ok(unsafe { windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow() == hwnd })
}

/// O HWND principal já precisa estar em primeiro plano; o WebView recebe o foco de entrada interno.
pub fn focus_content(window: &WebviewWindow) -> tauri::Result<()> {
    if has_input_focus(window)? {
        let webview: &tauri::Webview = window.as_ref();
        webview.set_focus()?;
    }
    Ok(())
}
/// Consulta o estado nativo e publica mudanças de maximização, tela cheia ou foco na própria janela.
pub fn reconcile_state(window: &WebviewWindow) -> tauri::Result<WindowState> {
    let state = WindowState {
        is_maximized: window.is_maximized()?,
        is_fullscreen: window.is_fullscreen()?,
        is_focused: has_input_focus(window)?,
    };
    if !state.is_fullscreen {
        window.state::<Controllers>().set_input_enabled(false);
    }
    let tracker = window.state::<WindowStateTracker>();
    let signature = state.signature();
    if !tracker.transitioning.load(Ordering::Acquire) && tracker.last.swap(signature, Ordering::Relaxed) != signature {
        let _ = window.emit(WINDOW_STATE_EVENT, &state);
    }
    Ok(state)
}

/// O Tauri/Windows guarda o WINDOWPLACEMENT ao entrar e o restaura ao sair, incluindo o retângulo
/// restaurado e o estado maximizado. Não redimensionamos por cima desse estado nativo.
pub fn set_fullscreen(window: &WebviewWindow, enabled: bool) -> tauri::Result<WindowState> {
    let previous = window.is_fullscreen()?;
    let had_focus = has_input_focus(window)?;
    if previous == enabled {
        return reconcile_state(window);
    }
    window.state::<Controllers>().set_input_enabled(false);
    let tracker = window.state::<WindowStateTracker>();
    tracker.transitioning.store(true, Ordering::Release);
    let result = window.set_fullscreen(enabled);
    if result.is_err() {
        let _ = window.set_fullscreen(previous);
    }
    tracker.transitioning.store(false, Ordering::Release);
    // A mudança de estilo pode soltar o foreground. Só o restaura se a transição começou na janela ativa.
    if had_focus {
        let _ = window.set_focus();
    }
    let _ = focus_content(window);
    let reconciled = reconcile_state(window);
    result?;
    reconciled
}

/// Mudanças pelo Windows também reconciliam tela cheia. Perder foco interrompe a leitura rápida;
/// voltar exige uma nova habilitação da interface e um estado neutro no serviço de controles.
fn send_state_changes(window: &WebviewWindow) {
    let handle = window.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed)
            || (matches!(event, WindowEvent::Focused(false)) && !has_input_focus(&handle).unwrap_or(false))
        {
            handle.state::<Controllers>().set_input_enabled(false);
        }
        if matches!(event, WindowEvent::Resized(_) | WindowEvent::Moved(_) | WindowEvent::Focused(_)) {
            let _ = reconcile_state(&handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contrato_de_janela_inclui_modo_e_foco_nativos() {
        let state = WindowState { is_maximized: true, is_fullscreen: false, is_focused: true };
        assert_eq!(
            serde_json::to_value(&state).unwrap(),
            serde_json::json!({ "isMaximized": true, "isFullscreen": false, "isFocused": true })
        );
        let mut signatures = Vec::new();
        for is_maximized in [false, true] {
            for is_fullscreen in [false, true] {
                for is_focused in [false, true] {
                    signatures.push(WindowState { is_maximized, is_fullscreen, is_focused }.signature());
                }
            }
        }
        signatures.sort();
        signatures.dedup();
        assert_eq!(signatures.len(), 8);
    }

    #[test]
    fn a_janela_so_abre_o_endereco_da_interface() {
        let url = |text: &str| Url::parse(text).unwrap();
        assert!(is_app_url(&url("http://tauri.localhost/index.html?lang=en")));
        assert!(is_app_url(&url("http://localhost:1420/index.html")));
        assert!(!is_app_url(&url("http://localhost:5173/")));
        assert!(!is_app_url(&url("https://github.com/LamarcKz/Playtrove")));
    }
}
