//! O erro que a interface mostra: a mensagem, já no idioma do app (os comandos devolvem este erro, e
//! a tela recebe só o texto).

use std::fmt;

use serde::{Serialize, Serializer};

use crate::i18n::{Language, text};

#[derive(Debug)]
pub struct AppError(String);

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    /// Um erro do dicionário (ex.: "errors.gameNotFound"), no idioma, com os valores no lugar de {0}, {1}...
    pub fn text(language: Language, path: &str, values: &[&str]) -> AppError {
        AppError(text(language, path, values))
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> AppError {
        AppError(error.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> AppError {
        AppError(error.to_string())
    }
}

impl From<crate::metadata::http::MetadataError> for AppError {
    fn from(error: crate::metadata::http::MetadataError) -> AppError {
        AppError(error.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> AppError {
        AppError(error.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}
