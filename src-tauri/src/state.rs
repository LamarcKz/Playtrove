//! O que os comandos usam enquanto o app está aberto: a conexão com o banco e o idioma.

use std::sync::{Mutex, MutexGuard, PoisonError};

use rusqlite::Connection;

use crate::i18n::Language;

pub struct AppState {
    db: Mutex<Connection>,
    language: Mutex<Language>,
}

impl AppState {
    pub fn new(db: Connection, language: Language) -> AppState {
        AppState { db: Mutex::new(db), language: Mutex::new(language) }
    }

    /// A conexão com o banco (um comando de cada vez).
    pub fn db(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// O idioma do app agora.
    pub fn language(&self) -> Language {
        *self.language.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn set_language(&self, language: Language) {
        *self.language.lock().unwrap_or_else(PoisonError::into_inner) = language;
    }
}
