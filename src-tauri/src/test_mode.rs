//! O que os testes automáticos pedem ao app para rodar sem mexer no computador de verdade. Vem das
//! variáveis de ambiente PLAYTROVE_*, e o app de verdade (o build de release) ignora todas elas.

use std::path::PathBuf;
use std::sync::LazyLock;

pub struct TestMode {
    /// Pasta de dados temporária, no lugar da biblioteca de verdade.
    pub data_dir: Option<PathBuf>,
    /// Começar com os 12 jogos de exemplo.
    pub sample_games: bool,
    /// O idioma que o Windows finge ter (ex.: "en-US").
    pub system_language: Option<String>,
    /// Sem a marca DEV, para as capturas de tela do README.
    pub hide_dev_mark: bool,
}

static TEST_MODE: LazyLock<TestMode> = LazyLock::new(|| TestMode {
    data_dir: test_variable("DATA_DIR").map(PathBuf::from),
    sample_games: test_variable("SAMPLE_GAMES").as_deref() == Some("1"),
    system_language: test_variable("SYSTEM_LANGUAGE"),
    hide_dev_mark: test_variable("HIDE_DEV_MARK").as_deref() == Some("1"),
});

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
