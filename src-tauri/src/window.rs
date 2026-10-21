//! A janela principal: sem a barra padrão do Windows (a barra do topo é a da interface), aberta já
//! maximizada e com o idioma e a marca DEV no endereço, como no app em Electron (src/main/window.ts).

use std::sync::atomic::{AtomicU8, Ordering};

use serde::Serialize;
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::i18n::Language;
use crate::test_mode::test_mode;

const MAIN_WINDOW: &str = "main";

/// O aviso de quando a janela maximiza ou restaura (o canal window:state da interface).
const WINDOW_STATE_EVENT: &str = "window:state";

/// Cor de fundo da janela enquanto a interface carrega: a mesma de --background no tema escuro.
const BACKGROUND_COLOR: Color = Color(0x12, 0x16, 0x1d, 0xff);

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

/// Cria a janela principal. O idioma vai no endereço da interface (?lang=en), para a primeira tela já
/// aparecer no idioma certo.
pub fn create_main_window(app: &AppHandle, language: Language) -> tauri::Result<()> {
    let mut query = format!("lang={}", language.id());
    if let Some(mark) = dev_mark() {
        query.push_str(&format!("&dev={mark}"));
    }
    let window = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App(format!("index.html?{query}").into()))
        .title(if cfg!(debug_assertions) { "Playtrove Dev" } else { "Playtrove" })
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 600.0)
        .decorations(false)
        .background_color(BACKGROUND_COLOR)
        .maximized(true)
        // Segurança: a janela nunca sai do endereço da própria interface.
        .on_navigation(is_app_url)
        .build()?;
    send_state_changes(&window);
    Ok(())
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
