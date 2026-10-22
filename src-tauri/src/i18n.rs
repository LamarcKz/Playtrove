//! O idioma do app e os textos que a parte em Rust mostra (os nomes dos status padrão, os erros e as
//! janelas do Windows). Os textos saem dos mesmos dicionários da interface (src/shared/i18n): o
//! `npm run tauri:mensagens` gera o messages.json com as partes que o Rust usa, e um teste confere se
//! ele está em dia.

use std::sync::LazyLock;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::settings::{get_setting, set_setting};
use crate::test_mode::test_mode;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Language {
    #[serde(rename = "pt-BR")]
    PtBr,
    #[serde(rename = "en")]
    En,
}

/// Os idiomas do app (pedido do usuário em 2026-09-27).
pub const LANGUAGES: [Language; 2] = [Language::PtBr, Language::En];

/// O idioma de quando não dá para saber o do Windows.
const DEFAULT_LANGUAGE: Language = Language::PtBr;

impl Language {
    pub fn id(self) -> &'static str {
        match self {
            Language::PtBr => "pt-BR",
            Language::En => "en",
        }
    }

    pub fn from_id(id: &str) -> Option<Language> {
        LANGUAGES.into_iter().find(|language| language.id() == id)
    }
}

/// O idioma pelo do Windows (a lista de idiomas preferidos, do principal para os outros), para quando
/// o usuário ainda não escolheu: Windows em português → português; em qualquer outra língua, inglês
/// (escolha do usuário em 2026-09-27).
fn language_from_system(locales: &[String]) -> Language {
    match locales.first() {
        None => DEFAULT_LANGUAGE,
        Some(main) if main.to_lowercase().starts_with("pt") => Language::PtBr,
        Some(_) => Language::En,
    }
}

/// Os idiomas preferidos do Windows (ou o que os testes automáticos fingem).
pub fn system_locales() -> Vec<String> {
    match &test_mode().system_language {
        Some(language) => vec![language.clone()],
        None => sys_locale::get_locales().collect(),
    }
}

/// Na abertura: o idioma escolhido em Configurações → Geral ou, se o usuário nunca escolheu, o do Windows.
pub fn load_language(db: &Connection, system_locales: &[String]) -> rusqlite::Result<Language> {
    let saved = get_setting(db, "language")?;
    Ok(saved.as_deref().and_then(Language::from_id).unwrap_or_else(|| language_from_system(system_locales)))
}

/// Guarda a escolha de Configurações → Geral.
pub fn save_language(db: &Connection, language: Language) -> rusqlite::Result<()> {
    set_setting(db, "language", Some(language.id()))
}

static MESSAGES: LazyLock<Value> =
    LazyLock::new(|| serde_json::from_str(include_str!("../messages.json")).expect("o messages.json do Tauri é inválido"));

/// Um texto no idioma, pelo caminho no dicionário (ex.: "errors.gameNotFound"). Os "{0}", "{1}"...
/// do texto viram os `values`, na ordem.
pub fn text(language: Language, path: &str, values: &[&str]) -> String {
    let node = path.split('.').fold(&MESSAGES[language.id()], |node, key| &node[key]);
    let mut text = node.as_str().unwrap_or(path).to_string();
    for (index, value) in values.iter().enumerate() {
        text = text.replace(&format!("{{{index}}}"), value);
    }
    text
}

/// O nome de um status que vem com o app, no idioma, ou None se `preset` não for um deles.
pub fn status_preset_name(language: Language, preset: &str) -> Option<String> {
    MESSAGES[language.id()]["statusPresets"][preset].as_str().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_idioma_do_windows_vale_ate_alguem_escolher() {
        let locales = |list: &[&str]| list.iter().map(|locale| locale.to_string()).collect::<Vec<_>>();
        assert_eq!(language_from_system(&locales(&["pt-BR", "en-US"])), Language::PtBr);
        assert_eq!(language_from_system(&locales(&["pt-PT"])), Language::PtBr);
        assert_eq!(language_from_system(&locales(&["en-US", "pt-BR"])), Language::En);
        assert_eq!(language_from_system(&locales(&["es-ES"])), Language::En);
        assert_eq!(language_from_system(&[]), Language::PtBr);
    }

    #[test]
    fn os_textos_saem_dos_dicionarios_nos_dois_idiomas() {
        assert_eq!(status_preset_name(Language::PtBr, "beaten").as_deref(), Some("Zerado"));
        assert_eq!(status_preset_name(Language::En, "beaten").as_deref(), Some("Beaten"));
        assert_eq!(status_preset_name(Language::En, "inventado"), None);
        for language in LANGUAGES {
            assert_ne!(text(language, "errors.invalidLanguage", &[]), "errors.invalidLanguage");
        }
    }
}
