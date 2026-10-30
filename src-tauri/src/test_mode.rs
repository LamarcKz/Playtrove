//! O que os testes automáticos pedem ao app para rodar sem mexer no computador de verdade. Vem das
//! variáveis de ambiente PLAYTROVE_*, e o app de verdade (o build de release) ignora todas elas.

use std::path::PathBuf;
use std::sync::LazyLock;

pub struct TestMode {
    /// Pasta de dados temporária, no lugar da biblioteca de verdade.
    pub data_dir: Option<PathBuf>,
    /// Começar com os 12 jogos de exemplo.
    pub sample_games: bool,
    /// Não procurar os emuladores instalados no PC.
    pub skip_emulator_detection: bool,
    /// Endereço do servidor de mentira que faz o papel do IGDB, SteamGridDB, libretro e RetroAchievements.
    pub metadata_server: Option<String>,
    /// O idioma que o Windows finge ter (ex.: "en-US").
    pub system_language: Option<String>,
    /// Sem a marca DEV, para as capturas de tela do README.
    pub hide_dev_mark: bool,
    /// Uma versão nova de mentira (ex.: "9.9.0"), para o aviso de atualização.
    pub fake_update: Option<String>,
    /// A porta em que a janela aceita o Playwright (a depuração do WebView2), nos testes do app.
    pub remote_debugging_port: Option<u16>,
    /// Os pacotes do Aniki de mentira (o Playnite, o tema, o Helper e o IGDB, cada um com endereço e
    /// SHA-256), num JSON `[{"url", "sha256"}]`, no lugar das páginas oficiais.
    pub aniki_packages: Option<Vec<crate::theme_pack::PackageSource>>,
}

static TEST_MODE: LazyLock<TestMode> = LazyLock::new(|| TestMode {
    data_dir: test_variable("DATA_DIR").map(PathBuf::from),
    sample_games: test_variable("SAMPLE_GAMES").as_deref() == Some("1"),
    skip_emulator_detection: test_variable("SKIP_EMULATOR_DETECTION").as_deref() == Some("1"),
    metadata_server: test_variable("METADATA_TEST_SERVER"),
    system_language: test_variable("SYSTEM_LANGUAGE"),
    hide_dev_mark: test_variable("HIDE_DEV_MARK").as_deref() == Some("1"),
    fake_update: test_variable("FAKE_UPDATE"),
    remote_debugging_port: test_variable("REMOTE_DEBUGGING_PORT").and_then(|port| port.parse().ok()),
    aniki_packages: test_variable("ANIKI_PACKAGES").and_then(|json| aniki_packages(&json)),
});

fn aniki_packages(json: &str) -> Option<Vec<crate::theme_pack::PackageSource>> {
    let list: Vec<serde_json::Value> = serde_json::from_str(json).ok()?;
    list.iter()
        .map(|item| {
            Some(crate::theme_pack::PackageSource {
                url: item["url"].as_str()?.to_string(),
                sha256: item["sha256"].as_str()?.to_string(),
            })
        })
        .collect()
}

pub fn test_mode() -> &'static TestMode {
    &TEST_MODE
}

/// Uma variável de ambiente dos testes automáticos, ou None no app de verdade (lá elas não valem).
fn test_variable(name: &str) -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var(format!("PLAYTROVE_{name}")).ok().filter(|value| !value.is_empty())
}
