//! Prévias sob demanda: uma transferência, duas cópias e autorização por token.
use crate::errors::AppResult;
use crate::i18n::Language;
use crate::metadata::theme_downloader::ThemeDownloader;
use crate::music;
use crate::music_search::{self, MusicPreview, failure};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use tauri::http::{Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};
pub const PREVIEW_PROTOCOL: &str = "playtrove-music-preview";
const MAX_PREVIEW: u64 = 32 * 1024 * 1024;
#[derive(Clone)]
struct Entry {
    game_id: i64,
    generation: String,
    video_id: String,
    token: String,
    path: PathBuf,
}
struct Active {
    cancel: Arc<AtomicBool>,
}
#[derive(Default)]
struct CacheState {
    entries: Vec<Entry>,
    active: Option<Active>,
    epoch: u64,
    operation_epoch: u64,
}
pub struct MusicPreviewCache {
    root: PathBuf,
    state: Mutex<CacheState>,
    finished: Condvar,
}
impl MusicPreviewCache {
    pub fn new(root: PathBuf) -> std::io::Result<Self> {
        std::fs::create_dir_all(&root)?;
        if std::fs::symlink_metadata(&root)?.file_type().is_symlink() {
            return Err(std::io::Error::other("cache redirecionado"));
        }
        let root = root.canonicalize()?;
        // Apenas nomes pertencentes ao cache; nunca percorre pastas nem links.
        for file in std::fs::read_dir(&root)? {
            let file = file?;
            let name = file.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("preview-") && file.file_type()?.is_file() {
                let _ = std::fs::remove_file(file.path());
            }
        }
        Ok(Self { root, state: Mutex::new(CacheState::default()), finished: Condvar::new() })
    }
    pub fn cancel(&self) -> String {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.epoch = state.epoch.wrapping_add(1);
        state.operation_epoch = state.operation_epoch.wrapping_add(1);
        if let Some(active) = &state.active {
            active.cancel.store(true, Ordering::Release);
        }
        for entry in state.entries.drain(..) {
            let _ = std::fs::remove_file(entry.path);
        }
        self.finished.notify_all();
        state.operation_epoch.to_string()
    }
    #[allow(clippy::too_many_arguments)] // O token de operação também protege comandos ainda não iniciados.
    pub fn preview(
        &self,
        db: &Mutex<Connection>,
        language: Language,
        downloader: &dyn ThemeDownloader,
        game_id: i64,
        generation: &str,
        video_id: &str,
        operation_id: Option<&str>,
    ) -> AppResult<MusicPreview> {
        music_search::authorize(&db.lock().unwrap_or_else(PoisonError::into_inner), language, game_id, generation, video_id)?;
        let (epoch, cancel, path, token) = {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            if operation_id.is_some_and(|id| id != state.operation_epoch.to_string()) {
                return Err(failure(language));
            }
            state.epoch = state.epoch.wrapping_add(1);
            let epoch = state.epoch;
            while state.active.is_some() {
                state.active.as_ref().unwrap().cancel.store(true, Ordering::Release);
                state = self.finished.wait(state).unwrap_or_else(PoisonError::into_inner);
                if state.epoch != epoch {
                    return Err(failure(language));
                }
            }
            if let Some(entry) =
                state.entries.iter().find(|e| e.game_id == game_id && e.generation == generation && e.video_id == video_id)
            {
                return Ok(Self::dto(entry));
            }
            while state.entries.len() >= 2 {
                let entry = state.entries.remove(0);
                let _ = std::fs::remove_file(entry.path);
            }
            let token = music_search::token();
            let path = self.root.join(format!("preview-{token}.m4a"));
            let cancel = Arc::new(AtomicBool::new(false));
            state.active = Some(Active { cancel: cancel.clone() });
            (epoch, cancel, path, token)
        };
        // Laços de cancelamento e escrita limitada pertencem ao downloader, sem nenhuma trava aqui.
        let result = downloader.download_video(video_id, &path, &cancel);
        let valid = result.is_ok()
            && !cancel.load(Ordering::Acquire)
            && music::valid_music_file(&path, "m4a")
            && path.canonicalize().ok().as_deref() == Some(path.as_path())
            && std::fs::metadata(&path).is_ok_and(|m| m.len() <= MAX_PREVIEW);
        let db = db.lock().unwrap_or_else(PoisonError::into_inner);
        let authorized = music_search::authorize(&db, language, game_id, generation, video_id).is_ok();
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.active = None;
        self.finished.notify_all();
        if !valid || !authorized || state.epoch != epoch {
            let _ = std::fs::remove_file(&path);
            return Err(failure(language));
        }
        let entry = Entry { game_id, generation: generation.into(), video_id: video_id.into(), token, path };
        let dto = Self::dto(&entry);
        state.entries.push(entry);
        Ok(dto)
    }
    fn dto(entry: &Entry) -> MusicPreview {
        MusicPreview { url: format!("http://{PREVIEW_PROTOCOL}.localhost/{}", entry.token), token: entry.token.clone() }
    }
    #[allow(clippy::too_many_arguments)] // Mantém o contrato IPC com jogo, geração e candidato explícitos.
    pub fn choose(
        &self,
        db: &Mutex<Connection>,
        language: Language,
        images_dir: &Path,
        downloader: &dyn ThemeDownloader,
        game_id: i64,
        generation: &str,
        video_id: &str,
        operation_id: Option<&str>,
    ) -> AppResult<()> {
        let preview = self.preview(db, language, downloader, game_id, generation, video_id, operation_id)?;
        let db = db.lock().unwrap_or_else(PoisonError::into_inner);
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let entry = state.entries.iter().find(|e| e.token == preview.token).cloned().ok_or_else(|| failure(language))?;
        music_search::install(&db, language, images_dir, game_id, generation, video_id, &entry.path, true)?;
        state.epoch = state.epoch.wrapping_add(1);
        if let Some(active) = &state.active {
            active.cancel.store(true, Ordering::Release);
        }
        for entry in state.entries.drain(..) {
            let _ = std::fs::remove_file(entry.path);
        }
        Ok(())
    }
    fn authorized_response(&self, db: &Connection, language: Language, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
        let entry = {
            let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            state.entries.iter().find(|e| request.uri().path() == format!("/{}", e.token)).cloned()
        };
        let Some(entry) = entry else { return music::empty_response(StatusCode::NOT_FOUND) };
        if music_search::authorize(db, language, entry.game_id, &entry.generation, &entry.video_id).is_err() {
            return music::empty_response(StatusCode::NOT_FOUND);
        }
        self.response(request)
    }
    fn response(&self, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
        let token = request.uri().path().strip_prefix('/').unwrap_or_default();
        if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) || request.uri().query().is_some() {
            return music::empty_response(StatusCode::NOT_FOUND);
        }
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(entry) = state.entries.iter().find(|e| e.token == token) else {
            return music::empty_response(StatusCode::NOT_FOUND);
        };
        if entry.path.canonicalize().ok().as_deref() != Some(entry.path.as_path())
            || entry.path.parent() != Some(self.root.as_path())
        {
            return music::empty_response(StatusCode::NOT_FOUND);
        }
        music::file_response(&entry.path, "audio/mp4", request)
    }
}
pub fn handle_request<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = context.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<crate::state::AppState>();
        responder.respond(app.state::<MusicPreviewCache>().authorized_response(&state.db(), state.language(), request));
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata::theme_downloader::{ThemeCandidate, ThemeSearchResult};
    use crate::music_search::search_choices;
    use crate::test_support::{memory_database, temp_folder};
    use std::sync::atomic::AtomicUsize;
    const AUDIO: &[u8] = b"\0\0\0\x18ftypM4A \0\0\0\0M4A isomconteudo";
    struct Fake {
        downloads: AtomicUsize,
    }
    impl ThemeDownloader for Fake {
        fn search(&self, _: &str, _: Option<&str>, _: Option<&str>) -> Result<ThemeSearchResult, String> {
            Ok(ThemeSearchResult {
                candidates: (0..3)
                    .map(|i| ThemeCandidate {
                        video_id: format!("abcdefghij{i}"),
                        title: "Jogo Theme".into(),
                        channel: None,
                        duration: Some(60.0),
                        view_count: None,
                    })
                    .collect(),
                automatic_video_id: None,
            })
        }
        fn download_video(&self, _: &str, path: &Path, cancel: &AtomicBool) -> Result<(), String> {
            assert!(!cancel.load(Ordering::Acquire));
            self.downloads.fetch_add(1, Ordering::Relaxed);
            std::fs::write(path, AUDIO).map_err(|e| e.to_string())
        }
    }
    fn setup() -> (Mutex<Connection>, Fake, MusicPreviewCache, PathBuf, String) {
        let db = memory_database();
        db.execute("INSERT INTO games(id,title,status_id,added_at) VALUES(1,'Jogo',1,'2026-01-01')", []).unwrap();
        let db = Mutex::new(db);
        let fake = Fake { downloads: AtomicUsize::new(0) };
        let folder = temp_folder("previa-musica");
        let cache = MusicPreviewCache::new(folder.join("cache")).unwrap();
        let review = search_choices(&db, Language::En, &fake, 1, None).unwrap();
        (db, fake, cache, folder.join("images"), review.generation)
    }
    #[test]
    fn previa_e_sob_demanda_e_confirmacao_reutiliza_bytes() {
        let (db, fake, cache, images, generation) = setup();
        assert_eq!(fake.downloads.load(Ordering::Relaxed), 0);
        let preview = cache.preview(&db, Language::En, &fake, 1, &generation, "abcdefghij0", None).unwrap();
        let response = cache.response(Request::builder().uri(&preview.url).body(vec![]).unwrap());
        assert_eq!(response.body(), AUDIO);
        cache.choose(&db, Language::En, &images, &fake, 1, &generation, "abcdefghij0", None).unwrap();
        assert_eq!(fake.downloads.load(Ordering::Relaxed), 1);
        let (name, mode): (String, String) = db
            .lock()
            .unwrap()
            .query_row("SELECT theme_music,theme_music_mode FROM games", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(mode, "manual");
        assert_eq!(std::fs::read(images.join("1").join(name)).unwrap(), AUDIO);
        assert_eq!(cache.response(Request::builder().uri(&preview.url).body(vec![]).unwrap()).status(), StatusCode::NOT_FOUND);
    }
    #[test]
    fn cancelar_antes_do_comando_iniciar_revoga_previa_e_confirmacao() {
        let (db, fake, cache, images, generation) = setup();
        let operation = cache.cancel();
        let current = cache.cancel();
        assert_ne!(operation, current);
        assert!(cache.choose(&db, Language::En, &images, &fake, 1, &generation, "abcdefghij0", Some(&operation)).is_err());
        assert!(cache.preview(&db, Language::En, &fake, 1, &generation, "abcdefghij0", Some(&operation)).is_err());
        assert_eq!(fake.downloads.load(Ordering::Relaxed), 0);
        cache.preview(&db, Language::En, &fake, 1, &generation, "abcdefghij0", Some(&current)).unwrap();
        cache.choose(&db, Language::En, &images, &fake, 1, &generation, "abcdefghij0", Some(&current)).unwrap();
        assert_eq!(fake.downloads.load(Ordering::Relaxed), 1);
    }
    #[test]
    fn cache_limita_arquivos_e_cancelar_revoga_tokens() {
        let (db, fake, cache, _, generation) = setup();
        let mut previews = vec![];
        for i in 0..3 {
            previews.push(cache.preview(&db, Language::En, &fake, 1, &generation, &format!("abcdefghij{i}"), None).unwrap());
        }
        assert!(std::fs::read_dir(&cache.root).unwrap().count() <= 2);
        assert_eq!(
            cache.response(Request::builder().uri(&previews[0].url).body(vec![]).unwrap()).status(),
            StatusCode::NOT_FOUND
        );
        for path in ["/../other.m4a", "/%2e%2e/other.m4a", "/unknown", "/token/extra"] {
            assert_eq!(cache.response(Request::builder().uri(path).body(vec![]).unwrap()).status(), StatusCode::NOT_FOUND);
        }
        cache.cancel();
        assert_eq!(std::fs::read_dir(&cache.root).unwrap().count(), 0);
        assert_eq!(
            cache.response(Request::builder().uri(&previews[2].url).body(vec![]).unwrap()).status(),
            StatusCode::NOT_FOUND
        );
    }

    type DownloadCallback<'a> = dyn Fn(&Path, &AtomicBool) -> Result<(), String> + Send + Sync + 'a;
    struct DownloadHook<'a> {
        hook: Box<DownloadCallback<'a>>,
    }
    impl ThemeDownloader for DownloadHook<'_> {
        fn search(&self, _: &str, _: Option<&str>, _: Option<&str>) -> Result<ThemeSearchResult, String> {
            panic!("a prévia usa os candidatos persistidos")
        }
        fn download_video(&self, _: &str, path: &Path, cancel: &AtomicBool) -> Result<(), String> {
            (self.hook)(path, cancel)
        }
    }
    #[test]
    fn cancelamento_interrompe_transferencia_sem_travar_banco_ou_cache() {
        let (db, _, cache, _, generation) = setup();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let downloader = DownloadHook {
            hook: Box::new(|path, cancel| {
                assert!(db.try_lock().is_ok());
                assert!(cache.state.try_lock().is_ok());
                std::fs::write(path, AUDIO).unwrap();
                started_tx.send(()).unwrap();
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
                while !cancel.load(Ordering::Acquire) {
                    assert!(std::time::Instant::now() < deadline, "cancelamento não chegou");
                    std::thread::yield_now();
                }
                Err("cancelado".into())
            }),
        };
        std::thread::scope(|scope| {
            let pending = scope.spawn(|| cache.preview(&db, Language::En, &downloader, 1, &generation, "abcdefghij0", None));
            started_rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap();
            cache.cancel();
            assert!(pending.join().unwrap().is_err());
        });
        assert_eq!(std::fs::read_dir(&cache.root).unwrap().count(), 0);
    }
    #[test]
    fn cancelar_confirmacao_sem_previa_preserva_arquivo_e_origem_anteriores() {
        let (db, fake, cache, images, generation) = setup();
        cache.choose(&db, Language::En, &images, &fake, 1, &generation, "abcdefghij0", None).unwrap();
        let previous: String = db.lock().unwrap().query_row("SELECT theme_music FROM games", [], |r| r.get(0)).unwrap();
        let next = search_choices(&db, Language::En, &fake, 1, None).unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let downloader = DownloadHook {
            hook: Box::new(|path, cancel| {
                std::fs::write(path, AUDIO).unwrap();
                started_tx.send(()).unwrap();
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
                while !cancel.load(Ordering::Acquire) {
                    assert!(std::time::Instant::now() < deadline, "cancelamento não chegou à confirmação");
                    std::thread::yield_now();
                }
                // Mesmo uma resposta tardia válida não pode promover a faixa cancelada.
                Ok(())
            }),
        };
        std::thread::scope(|scope| {
            let pending =
                scope.spawn(|| cache.choose(&db, Language::En, &images, &downloader, 1, &next.generation, "abcdefghij1", None));
            started_rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap();
            cache.cancel();
            assert!(pending.join().unwrap().is_err());
        });
        assert_eq!(
            db.lock().unwrap().query_row("SELECT theme_music FROM games", [], |r| r.get::<_, String>(0)).unwrap(),
            previous
        );
        assert_eq!(
            db.lock().unwrap().query_row("SELECT video_id FROM music_sources", [], |r| r.get::<_, String>(0)).unwrap(),
            "abcdefghij0"
        );
        assert_eq!(std::fs::read(images.join("1").join(previous)).unwrap(), AUDIO);
        assert_eq!(std::fs::read_dir(&cache.root).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(images.join("1")).unwrap().count(), 1);
    }
    #[test]
    fn importar_durante_previa_invalida_resultado_e_escolha() {
        let (db, _, cache, images, generation) = setup();
        std::fs::create_dir_all(&images).unwrap();
        let source = images.join("original.mp3");
        std::fs::write(&source, b"ID3\x04\0\0\0\0\0\0audio").unwrap();
        let downloader = DownloadHook {
            hook: Box::new(|path, _| {
                music::pick_theme_music(&db, Language::En, &images, 1, Some(&source)).unwrap();
                std::fs::write(path, AUDIO).unwrap();
                Ok(())
            }),
        };
        assert!(cache.preview(&db, Language::En, &downloader, 1, &generation, "abcdefghij0", None).is_err());
        assert!(cache.choose(&db, Language::En, &images, &downloader, 1, &generation, "abcdefghij0", None).is_err());
        assert_eq!(std::fs::read_dir(&cache.root).unwrap().count(), 0);
    }
    #[test]
    fn rejeita_assinatura_e_excesso_de_bytes_preservando_musica_anterior() {
        for oversized in [false, true] {
            let (db, _, cache, images, generation) = setup();
            let downloader = DownloadHook {
                hook: Box::new(|path, _| {
                    std::fs::write(path, if oversized { AUDIO } else { b"invalido" }).unwrap();
                    if oversized {
                        std::fs::OpenOptions::new().write(true).open(path).unwrap().set_len(MAX_PREVIEW + 1).unwrap();
                    }
                    Ok(())
                }),
            };
            assert!(cache.choose(&db, Language::En, &images, &downloader, 1, &generation, "abcdefghij0", None).is_err());
            assert_eq!(std::fs::read_dir(&cache.root).unwrap().count(), 0);
            assert_eq!(
                db.lock().unwrap().query_row("SELECT theme_music FROM games", [], |r| r.get::<_, Option<String>>(0)).unwrap(),
                None
            );
        }
    }
    #[test]
    fn falha_no_banco_conserva_faixa_e_previa_para_repetir() {
        let (db, fake, cache, images, generation) = setup();
        cache.preview(&db, Language::En, &fake, 1, &generation, "abcdefghij0", None).unwrap();
        db.lock()
            .unwrap()
            .execute_batch("CREATE TRIGGER falha BEFORE UPDATE OF theme_music ON games BEGIN SELECT RAISE(ABORT,'falha');END;")
            .unwrap();
        assert!(cache.choose(&db, Language::En, &images, &fake, 1, &generation, "abcdefghij0", None).is_err());
        assert_eq!(std::fs::read_dir(&cache.root).unwrap().count(), 1);
        assert_eq!(std::fs::read_dir(images.join("1")).unwrap().count(), 0);
        db.lock().unwrap().execute_batch("DROP TRIGGER falha;").unwrap();
        cache.choose(&db, Language::En, &images, &fake, 1, &generation, "abcdefghij0", None).unwrap();
        assert_eq!(fake.downloads.load(Ordering::Relaxed), 1);
    }
    #[test]
    fn protocolo_revalida_revisao_e_serve_intervalos_limitados() {
        let (db, fake, cache, _, generation) = setup();
        let preview = cache.preview(&db, Language::En, &fake, 1, &generation, "abcdefghij0", None).unwrap();
        let request = || Request::builder().uri(&preview.url).header("Range", "bytes=4-7").body(vec![]).unwrap();
        let response = cache.authorized_response(&db.lock().unwrap(), Language::En, request());
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body(), b"ftyp");
        music::use_automatic_theme_music(&db.lock().unwrap(), Language::En, 1).unwrap();
        assert_eq!(cache.authorized_response(&db.lock().unwrap(), Language::En, request()).status(), StatusCode::NOT_FOUND);
    }
    #[test]
    fn inicializacao_limpa_apenas_arquivos_do_cache() {
        let folder = temp_folder("previa-limpeza");
        std::fs::write(folder.join("preview-old.m4a"), AUDIO).unwrap();
        std::fs::write(folder.join("original.m4a"), AUDIO).unwrap();
        std::fs::create_dir(folder.join("preview-folder")).unwrap();
        let _cache = MusicPreviewCache::new(folder.clone()).unwrap();
        assert!(!folder.join("preview-old.m4a").exists());
        assert!(folder.join("original.m4a").is_file());
        assert!(folder.join("preview-folder").is_dir());
    }
    #[test]
    fn trocar_previa_cancela_anterior_e_limita_a_uma_transferencia() {
        let (db, fake, cache, _, generation) = setup();
        cache.preview(&db, Language::En, &fake, 1, &generation, "abcdefghij0", None).unwrap();
        let (start_tx, start_rx) = std::sync::mpsc::channel();
        let calls = AtomicUsize::new(0);
        let active = AtomicUsize::new(0);
        let downloader = DownloadHook {
            hook: Box::new(|path, cancel| {
                assert_eq!(active.fetch_add(1, Ordering::SeqCst), 0);
                let call = calls.fetch_add(1, Ordering::SeqCst);
                std::fs::write(path, AUDIO).unwrap();
                assert!(std::fs::read_dir(&cache.root).unwrap().count() <= 2);
                if call == 0 {
                    start_tx.send(()).unwrap();
                    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
                    while !cancel.load(Ordering::Acquire) {
                        assert!(std::time::Instant::now() < deadline);
                        std::thread::yield_now();
                    }
                    active.fetch_sub(1, Ordering::SeqCst);
                    Err("cancelado".into())
                } else {
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok(())
                }
            }),
        };
        std::thread::scope(|scope| {
            let first = scope.spawn(|| cache.preview(&db, Language::En, &downloader, 1, &generation, "abcdefghij1", None));
            start_rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap();
            let latest = cache.preview(&db, Language::En, &downloader, 1, &generation, "abcdefghij2", None).unwrap();
            assert!(first.join().unwrap().is_err());
            assert_eq!(cache.response(Request::builder().uri(latest.url).body(vec![]).unwrap()).body(), AUDIO);
        });
        assert_eq!(std::fs::read_dir(&cache.root).unwrap().count(), 2);
    }
    #[test]
    fn candidato_fora_da_lista_nao_dispara_download() {
        let (db, fake, cache, images, generation) = setup();
        assert!(cache.preview(&db, Language::En, &fake, 1, &generation, "zzzzzzzzzzz", None).is_err());
        assert!(cache.choose(&db, Language::En, &images, &fake, 1, &generation, "zzzzzzzzzzz", None).is_err());
        assert_eq!(fake.downloads.load(Ordering::Relaxed), 0);
    }
}
