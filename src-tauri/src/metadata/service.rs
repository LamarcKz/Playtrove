//! Os serviços de metadados do app: quem faz os pedidos, os endereços (os de verdade ou os do servidor de
//! mentira dos testes), a conexão com o IGDB guardada entre os downloads (para reaproveitar o token) e a
//! fila, que avisa a interface do andamento.

use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Manager};

use super::credentials::read_metadata_credentials;
use super::download::MetadataServices;
use super::http::{Fetch, HttpClient, MetadataEndpoints};
use super::igdb::{IgdbCredentials, IgdbSession};
use super::queue::{MetadataProgress, MetadataQueue, QueueContext};
use super::steam_grid_db::SteamGridDbSession;
use crate::commands::notify_library_changed;
use crate::i18n::Language;
use crate::images::ImagesDir;
use crate::secrets::Secrets;
use crate::state::AppState;
use crate::test_mode::test_mode;

/// O aviso do andamento dos downloads (o canal metadata:progress da interface).
const PROGRESS_EVENT: &str = "metadata:progress";

/// Pausa entre um jogo e outro, para não sobrecarregar os serviços.
const QUEUE_DELAY: Duration = Duration::from_millis(250);

pub struct MetadataService {
    fetch: Arc<dyn Fetch>,
    endpoints: MetadataEndpoints,
    igdb: Mutex<Option<Arc<IgdbSession>>>,
    pub queue: MetadataQueue,
}

impl MetadataService {
    pub fn new(app: AppHandle) -> MetadataService {
        // Os testes do app trocam os serviços por um servidor de mentira (nunca no app de verdade).
        let endpoints = test_mode().metadata_server.as_deref().map_or_else(MetadataEndpoints::real, MetadataEndpoints::test);
        MetadataService {
            fetch: Arc::new(HttpClient::new()),
            endpoints,
            igdb: Mutex::new(None),
            queue: MetadataQueue::new(Arc::new(AppContext { app }), QUEUE_DELAY),
        }
    }

    /// Uma conexão nova com o IGDB (para conferir chaves antes de salvar).
    pub fn igdb_session(&self, credentials: IgdbCredentials, language: Language) -> IgdbSession {
        IgdbSession::new(Arc::clone(&self.fetch), self.endpoints.clone(), credentials, language)
    }

    /// Uma conexão com o SteamGridDB.
    pub fn steam_grid_db_session(&self, key: String, language: Language) -> SteamGridDbSession {
        SteamGridDbSession::new(Arc::clone(&self.fetch), self.endpoints.clone(), key, language)
    }

    /// Os serviços com as chaves salvas agora. O libretro-thumbnails (capas dos jogos de emulador) não
    /// precisa de chave, então sempre há o que baixar.
    fn services(&self, db: &Connection, secrets: &Secrets, language: Language, images: &ImagesDir) -> MetadataServices {
        let credentials = read_metadata_credentials(db, secrets);
        let igdb = credentials.igdb.map(|credentials| {
            let mut saved = self.igdb.lock().unwrap_or_else(PoisonError::into_inner);
            match saved.as_ref() {
                Some(session) if *session.credentials() == credentials => Arc::clone(session),
                _ => {
                    let session = Arc::new(self.igdb_session(credentials, language));
                    *saved = Some(Arc::clone(&session));
                    session
                }
            }
        });
        MetadataServices {
            fetch: Arc::clone(&self.fetch),
            endpoints: self.endpoints.clone(),
            igdb,
            steam_grid_db: credentials.steam_grid_db_key.map(|key| self.steam_grid_db_session(key, language)),
            images_dir: images.0.clone(),
        }
    }
}

/// O que a fila usa do app de verdade.
struct AppContext {
    app: AppHandle,
}

impl QueueContext for AppContext {
    fn database(&self) -> &Mutex<Connection> {
        self.app.state::<AppState>().inner().database()
    }

    fn language(&self) -> Language {
        self.app.state::<AppState>().language()
    }

    fn services(&self) -> Option<MetadataServices> {
        let state = self.app.state::<AppState>();
        let service = self.app.state::<MetadataService>();
        Some(service.services(&state.db(), &self.app.state::<Secrets>(), state.language(), &self.app.state::<ImagesDir>()))
    }

    fn on_progress(&self, progress: &MetadataProgress) {
        let _ = self.app.emit(PROGRESS_EVENT, progress);
    }

    fn on_game_updated(&self) {
        notify_library_changed(&self.app);
    }
}
