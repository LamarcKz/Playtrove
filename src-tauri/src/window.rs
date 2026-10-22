//! A janela principal: sem a barra padrão do Windows (a barra do topo é a da interface), aberta já
//! maximizada e com o idioma e a marca DEV no endereço.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};

use serde::Serialize;
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::i18n::Language;
use crate::test_mode::test_mode;

const MAIN_WINDOW: &str = "main";

/// O aviso de quando a janela maximiza ou restaura (o canal window:state da interface).
const WINDOW_STATE_EVENT: &str = "window:state";

/// Cor de fundo da janela enquanto a interface carrega: a mesma de --background no tema escuro.
const BACKGROUND_COLOR: Color = Color(0x12, 0x16, 0x1d, 0xff);

/// As opções que o Tauri já passa ao WebView2 (sem o mini menu do Edge e sem o SmartScreen). Quem passa
/// outras precisa repetir estas.
const WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// O que a interface sabe da janela.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub is_maximized: bool,
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
    if let Some(port) = test_mode().remote_debugging_port {
        builder =
            builder.additional_browser_args(&format!("{WEBVIEW_ARGS} --remote-debugging-port={port} --enable-logging --v=0"));
    }
    let window = builder.build()?;
    send_state_changes(&window);
    Ok(window)
}

/// Traz a janela principal para a frente (abriram o app de novo com ele já aberto).
#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn bring_to_front(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
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

/// Avisa a interface sempre que a janela maximizar ou restaurar (pelo botão, pelo duplo clique na
/// barra do topo ou pelo Windows). O estado de partida fica em aberto: logo depois de criada, a janela
/// ainda não terminou de maximizar, e o primeiro tamanho de verdade sempre vira aviso.
fn send_state_changes(window: &WebviewWindow) {
    const UNKNOWN: u8 = 2;
    let last = AtomicU8::new(UNKNOWN);
    let handle = window.clone();
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Resized(_)) {
            return;
        }
        let Ok(is_maximized) = handle.is_maximized() else { return };
        if last.swap(u8::from(is_maximized), Ordering::Relaxed) != u8::from(is_maximized) {
            let _ = handle.emit(WINDOW_STATE_EVENT, WindowState { is_maximized });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_janela_so_abre_o_endereco_da_interface() {
        let url = |text: &str| Url::parse(text).unwrap();
        assert!(is_app_url(&url("http://tauri.localhost/index.html?lang=en")));
        assert!(is_app_url(&url("http://localhost:1420/index.html")));
        assert!(!is_app_url(&url("http://localhost:5173/")));
        assert!(!is_app_url(&url("https://github.com/LamarcKz/Playtrove")));
    }
}
