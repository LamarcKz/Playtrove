//! Consultas persistentes de música, protegidas por geração e revisão do jogo.
use crate::errors::{AppError, AppResult};
use crate::i18n::Language;
pub use crate::metadata::theme_downloader::ThemeCandidate as MusicCandidate;
use crate::metadata::theme_downloader::ThemeDownloader;
use crate::music;
use aes_gcm::{
    Aes256Gcm,
    aead::{Generate, Key},
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, PoisonError};

const SEARCH_VERSION: i64 = 1;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicReview {
    pub game_id: i64,
    pub game_title: String,
    pub generation: String,
    pub query: String,
    pub state: String,
    pub candidates: Vec<MusicCandidate>,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicPreview {
    pub url: String,
    pub token: String,
}
pub struct MusicSearchOutcome {
    pub found: bool,
    pub needs_choice: bool,
}

pub(crate) fn token() -> String {
    Key::<Aes256Gcm>::generate().iter().map(|b| format!("{b:02x}")).collect()
}
pub(crate) fn failure(language: Language) -> AppError {
    AppError::text(language, "errors.themeMusicDownloadFailed", &[])
}

pub fn needs_search(db: &Connection, game_id: i64) -> rusqlite::Result<bool> {
    db.query_row(
        "SELECT g.theme_music_mode='auto' AND (g.theme_music IS NULL OR g.theme_music_checked_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM music_searches s WHERE s.game_id=g.id AND s.revision=g.theme_music_revision
        AND s.version=?2 AND s.state IN ('needsChoice','notFound','installed')) FROM games g WHERE g.id=?1",
        (game_id, SEARCH_VERSION),
        |r| r.get(0),
    )
    .optional()
    .map(|v| v.unwrap_or(false))
}
pub fn retry_missing(db: &Connection, game_id: i64) -> rusqlite::Result<()> {
    let tx = db.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM music_searches WHERE game_id=?1 AND state IN ('notFound','failed') AND EXISTS
        (SELECT 1 FROM games g WHERE g.id=?1 AND g.theme_music_mode='auto' AND g.theme_music IS NULL)",
        [game_id],
    )?;
    tx.execute("UPDATE games SET theme_music_checked_at=NULL WHERE id=?1 AND theme_music_mode='auto' AND theme_music IS NULL
        AND NOT EXISTS(SELECT 1 FROM music_searches s WHERE s.game_id=games.id AND s.revision=games.theme_music_revision AND s.state='needsChoice')",[game_id])?;
    tx.commit()
}
pub fn list_reviews(db: &Connection, language: Language) -> AppResult<Vec<MusicReview>> {
    let mut stmt = db
        .prepare(
            "SELECT g.id,g.title,s.generation,s.query,s.state,s.candidates,s.error FROM music_searches s
        JOIN games g ON g.id=s.game_id WHERE s.revision=g.theme_music_revision AND s.version=?1
        AND s.state IN ('needsChoice','notFound','failed') ORDER BY g.title COLLATE NOCASE,g.id",
        )
        .map_err(|_| failure(language))?;
    stmt.query_map([SEARCH_VERSION], |r| {
        let json: String = r.get(5)?;
        let error: Option<String> = r.get(6)?;
        Ok(MusicReview {
            game_id: r.get(0)?,
            game_title: r.get(1)?,
            generation: r.get(2)?,
            query: r.get(3)?,
            state: r.get(4)?,
            candidates: serde_json::from_str(&json).unwrap_or_default(),
            error: error.map(|_| failure(language).to_string()),
        })
    })
    .map_err(|_| failure(language))?
    .collect::<rusqlite::Result<_>>()
    .map_err(|_| failure(language))
}
pub fn search_choices(
    db: &Mutex<Connection>,
    language: Language,
    downloader: &dyn ThemeDownloader,
    game_id: i64,
    query: Option<&str>,
) -> AppResult<MusicReview> {
    run_search(db, language, downloader, game_id, query, false).map(|(review, _)| review)
}
fn run_search(
    db: &Mutex<Connection>,
    language: Language,
    downloader: &dyn ThemeDownloader,
    game_id: i64,
    query: Option<&str>,
    automatic: bool,
) -> AppResult<(MusicReview, Option<String>)> {
    if query.is_some_and(|q| q.trim().is_empty() || q.len() > 300 || q.chars().any(char::is_control)) {
        return Err(failure(language));
    }
    let generation = token();
    let (title, platform, revision, query_text) = {
        let db = db.lock().unwrap_or_else(PoisonError::into_inner);
        if automatic && !needs_search(&db, game_id).map_err(|_| failure(language))? {
            return Err(failure(language));
        }
        let (title, platform, revision): (String, Option<String>, i64) = db
            .query_row("SELECT title,platform,theme_music_revision FROM games WHERE id=?1", [game_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .map_err(|_| failure(language))?;
        let query_text = query.map(str::trim).map(str::to_owned).unwrap_or_else(|| title.clone());
        // A tentativa só troca seu token; a última lista concluída continua disponível no disco.
        db.execute("INSERT INTO music_searches(game_id,generation,revision,version,query,state,attempt_generation) VALUES(?1,?2,?3,?4,?5,'searching',?2)
            ON CONFLICT(game_id) DO UPDATE SET attempt_generation=excluded.attempt_generation",
            (game_id,&generation,revision,SEARCH_VERSION,&query_text)).map_err(|_|failure(language))?;
        (title, platform, revision, query_text)
    };
    // Nenhuma trava do banco permanece durante a consulta externa.
    let result = downloader.search(&title, platform.as_deref(), query.map(str::trim));
    let (candidates, automatic_id, state, error) = match result {
        Ok(result) => {
            let state = if result.candidates.is_empty() { "notFound" } else { "needsChoice" };
            (result.candidates, result.automatic_video_id, state, None)
        }
        Err(_) => (vec![], None, "failed", Some("downloadFailed")),
    };
    let json = serde_json::to_string(&candidates).map_err(|_| failure(language))?;
    let db = db.lock().unwrap_or_else(PoisonError::into_inner);
    let tx = db.unchecked_transaction().map_err(|_| failure(language))?;
    let changed = if state == "failed" {
        tx.execute(
            "UPDATE music_searches SET state=CASE WHEN state='searching' THEN 'failed' ELSE state END,
            error=?1,attempt_generation=NULL WHERE game_id=?2 AND attempt_generation=?3 AND revision=?4
            AND EXISTS(SELECT 1 FROM games g WHERE g.id=?2 AND g.theme_music_revision=?4)",
            (error, game_id, &generation, revision),
        )
    } else {
        tx.execute(
            "UPDATE music_searches SET state=?1,candidates=?2,error=NULL,generation=?3,query=?4,version=?5,attempt_generation=NULL
            WHERE game_id=?6 AND attempt_generation=?3 AND revision=?7
            AND EXISTS(SELECT 1 FROM games g WHERE g.id=?6 AND g.theme_music_revision=?7)",
            (state, &json, &generation, &query_text, SEARCH_VERSION, game_id, revision),
        )
    }
    .map_err(|_| failure(language))?;
    if changed != 1 {
        return Err(failure(language));
    }
    if state != "failed" {
        tx.execute(
            "UPDATE games SET theme_music_checked_at=?1 WHERE id=?2 AND theme_music_revision=?3",
            (crate::dates::iso(chrono::Utc::now()), game_id, revision),
        )
        .map_err(|_| failure(language))?;
    }
    tx.commit().map_err(|_| failure(language))?;
    if state == "failed" {
        let review =
            list_reviews(&db, language)?.into_iter().find(|review| review.game_id == game_id).ok_or_else(|| failure(language))?;
        return Ok((review, None));
    }
    Ok((
        MusicReview {
            game_id,
            game_title: title,
            generation,
            query: query_text,
            state: state.into(),
            candidates,
            error: error.map(|_| failure(language).to_string()),
        },
        automatic_id,
    ))
}

pub(crate) struct AuthorizedChoice {
    pub revision: i64,
    pub candidate: MusicCandidate,
}
pub(crate) fn authorize(
    db: &Connection,
    language: Language,
    game_id: i64,
    generation: &str,
    video_id: &str,
) -> AppResult<AuthorizedChoice> {
    let row: Option<(i64, String)> = db
        .query_row(
            "SELECT s.revision,s.candidates FROM music_searches s JOIN games g ON g.id=s.game_id
        WHERE s.game_id=?1 AND s.generation=?2 AND s.revision=g.theme_music_revision AND s.version=?3 AND s.state='needsChoice'",
            (game_id, generation, SEARCH_VERSION),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|_| failure(language))?;
    let (revision, json) = row.ok_or_else(|| failure(language))?;
    let candidates: Vec<MusicCandidate> = serde_json::from_str(&json).map_err(|_| failure(language))?;
    let candidate = candidates.into_iter().find(|c| c.video_id == video_id).ok_or_else(|| failure(language))?;
    Ok(AuthorizedChoice { revision, candidate })
}

/// Chamado com a trava do banco: associação e origem são atômicas. O arquivo antigo só sai após commit.
#[allow(clippy::too_many_arguments)] // A fronteira de instalação recebe explicitamente a geração e a revisão autorizada.
pub(crate) fn install(
    db: &Connection,
    language: Language,
    images_dir: &Path,
    game_id: i64,
    generation: &str,
    video_id: &str,
    source: &Path,
    manual: bool,
) -> AppResult<()> {
    let choice = authorize(db, language, game_id, generation, video_id)?;
    if !music::valid_music_file(source, "m4a") {
        return Err(failure(language));
    }
    let tx = db.unchecked_transaction().map_err(|_| failure(language))?;
    let previous: Option<String> =
        tx.query_row("SELECT theme_music FROM games WHERE id=?1", [game_id], |r| r.get(0)).map_err(|_| failure(language))?;
    let directory = music::internal_directory(images_dir, game_id).map_err(|_| failure(language))?;
    let filename = music::new_filename("m4a");
    let target = directory.join(&filename);
    std::fs::rename(source, &target).map_err(|_| failure(language))?;
    let saved = (|| -> AppResult<()> {
        let changed=tx.execute("UPDATE games SET theme_music=?1,theme_music_mode=?2,theme_music_checked_at=?3,theme_music_revision=theme_music_revision+1
            WHERE id=?4 AND theme_music_revision=?5",(&filename,if manual{"manual"}else{"auto"},crate::dates::iso(chrono::Utc::now()),game_id,choice.revision)).map_err(|_|failure(language))?;
        if changed != 1 {
            return Err(failure(language));
        }
        tx.execute(
            "INSERT INTO music_sources(game_id,revision,origin,video_id,title,channel) VALUES(?1,?2,?3,?4,?5,?6)",
            (
                game_id,
                choice.revision + 1,
                if manual { "choice" } else { "automatic" },
                video_id,
                &choice.candidate.title,
                &choice.candidate.channel,
            ),
        )
        .map_err(|_| failure(language))?;
        tx.commit().map_err(|_| failure(language))
    })();
    match saved {
        Ok(()) => {
            music::remove_internal_file(images_dir, game_id, previous.as_deref());
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::rename(&target, source);
            let _ = std::fs::remove_file(&target);
            Err(error)
        }
    }
}

pub fn search_automatic(
    db: &Mutex<Connection>,
    language: Language,
    images_dir: &Path,
    downloader: &dyn ThemeDownloader,
    game_id: i64,
) -> AppResult<MusicSearchOutcome> {
    if !needs_search(&db.lock().unwrap_or_else(PoisonError::into_inner), game_id).map_err(|_| failure(language))? {
        let needs_choice = db
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM music_searches s JOIN games g ON g.id=s.game_id
            WHERE s.game_id=?1 AND s.revision=g.theme_music_revision AND s.version=?2 AND s.state='needsChoice')",
                (game_id, SEARCH_VERSION),
                |row| row.get(0),
            )
            .map_err(|_| failure(language))?;
        return Ok(MusicSearchOutcome { found: false, needs_choice });
    }
    let (review, automatic) = run_search(db, language, downloader, game_id, None, true)?;
    if review.state == "failed" {
        return Err(failure(language));
    }
    let Some(video_id) = automatic.filter(|id| review.candidates.iter().any(|c| c.video_id == *id)) else {
        return Ok(MusicSearchOutcome { found: false, needs_choice: review.state == "needsChoice" });
    };
    let directory = music::internal_directory(images_dir, game_id).map_err(|_| failure(language))?;
    let path = directory.join(music::new_filename("m4a"));
    let result = downloader.download_video(&video_id, &path, &AtomicBool::new(false));
    let saved = match result {
        Ok(()) => install(
            &db.lock().unwrap_or_else(PoisonError::into_inner),
            language,
            images_dir,
            game_id,
            &review.generation,
            &video_id,
            &path,
            false,
        ),
        Err(_) => Err(failure(language)),
    };
    let _ = std::fs::remove_file(path);
    if saved.is_err() {
        let db = db.lock().unwrap_or_else(PoisonError::into_inner);
        let _ = db.execute(
            "UPDATE music_searches SET state='failed',error='downloadFailed' WHERE game_id=?1 AND generation=?2",
            (game_id, &review.generation),
        );
        let _ = db.execute(
            "UPDATE games SET theme_music_checked_at=NULL WHERE id=?1 AND EXISTS
            (SELECT 1 FROM music_searches s WHERE s.game_id=games.id AND s.generation=?2
            AND s.revision=games.theme_music_revision AND s.state='failed')",
            (game_id, &review.generation),
        );
    }
    saved.map(|_| MusicSearchOutcome { found: true, needs_choice: false })
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata::theme_downloader::{ThemeCandidate, ThemeSearchResult};
    use crate::test_support::{memory_database, temp_folder};

    pub(super) struct Fake {
        pub result: Result<ThemeSearchResult, String>,
    }
    impl ThemeDownloader for Fake {
        fn search(&self, _: &str, _: Option<&str>, _: Option<&str>) -> Result<ThemeSearchResult, String> {
            self.result.clone()
        }
        fn download_video(&self, _: &str, path: &Path, _: &AtomicBool) -> Result<(), String> {
            std::fs::write(path, b"\0\0\0\x18ftypM4A \0\0\0\0M4A isomconteudo").map_err(|e| e.to_string())
        }
    }
    fn database() -> Mutex<Connection> {
        let db = memory_database();
        db.execute("INSERT INTO games(id,title,status_id,added_at) VALUES(1,'Jogo',1,'2026-01-01')", []).unwrap();
        Mutex::new(db)
    }
    fn candidate() -> ThemeCandidate {
        ThemeCandidate {
            video_id: "abcdefghijk".into(),
            title: "Jogo Theme".into(),
            channel: None,
            duration: Some(60.0),
            view_count: None,
        }
    }
    fn fake(automatic: bool) -> Fake {
        Fake {
            result: Ok(ThemeSearchResult {
                candidates: vec![candidate()],
                automatic_video_id: automatic.then(|| "abcdefghijk".into()),
            }),
        }
    }

    #[test]
    fn consulta_manual_persiste_escolhas_e_nao_instala() {
        let db = database();
        let review = search_choices(&db, Language::En, &fake(true), 1, None).unwrap();
        assert_eq!(review.state, "needsChoice");
        assert_eq!(review.candidates, vec![candidate()]);
        assert_eq!(list_reviews(&db.lock().unwrap(), Language::En).unwrap()[0].generation, review.generation);
        assert!(!needs_search(&db.lock().unwrap(), 1).unwrap());
        retry_missing(&db.lock().unwrap(), 1).unwrap();
        assert_eq!(list_reviews(&db.lock().unwrap(), Language::En).unwrap()[0].generation, review.generation);
        assert_eq!(
            db.lock().unwrap().query_row("SELECT theme_music FROM games", [], |r| r.get::<_, Option<String>>(0)).unwrap(),
            None
        );
    }
    #[test]
    fn ausencia_e_erro_sao_distintos_e_pedido_explicito_reabre_ausencia() {
        let db = database();
        db.lock().unwrap().execute("UPDATE games SET theme_music_checked_at='legado'", []).unwrap();
        assert!(needs_search(&db.lock().unwrap(), 1).unwrap());
        let empty = Fake { result: Ok(ThemeSearchResult { candidates: vec![], automatic_video_id: None }) };
        let review = search_choices(&db, Language::En, &empty, 1, None).unwrap();
        assert_eq!(review.state, "notFound");
        assert!(!needs_search(&db.lock().unwrap(), 1).unwrap());
        retry_missing(&db.lock().unwrap(), 1).unwrap();
        assert!(needs_search(&db.lock().unwrap(), 1).unwrap());
        let error = Fake { result: Err("segredo interno".into()) };
        let review = search_choices(&db, Language::En, &error, 1, None).unwrap();
        assert_eq!(review.state, "failed");
        assert!(!review.error.unwrap().contains("segredo"));
        assert!(needs_search(&db.lock().unwrap(), 1).unwrap());
    }
    #[test]
    fn geracao_anterior_e_revisao_modificada_nao_autorizam_candidato() {
        let db = database();
        let first = search_choices(&db, Language::En, &fake(false), 1, None).unwrap();
        let latest = search_choices(&db, Language::En, &fake(false), 1, Some("outra consulta")).unwrap();
        assert!(authorize(&db.lock().unwrap(), Language::En, 1, &first.generation, "abcdefghijk").is_err());
        assert!(authorize(&db.lock().unwrap(), Language::En, 1, &latest.generation, "zzzzzzzzzzz").is_err());
        crate::music::use_automatic_theme_music(&db.lock().unwrap(), Language::En, 1).unwrap();
        assert!(authorize(&db.lock().unwrap(), Language::En, 1, &latest.generation, "abcdefghijk").is_err());
        assert!(list_reviews(&db.lock().unwrap(), Language::En).unwrap().is_empty());
    }
    #[test]
    fn automatico_instala_so_recomendacao_forte() {
        let db = database();
        let root = temp_folder("busca-musica");
        let result = search_automatic(&db, Language::En, &root, &fake(false), 1).unwrap();
        assert!(result.needs_choice && !result.found);
        let db = database();
        let result = search_automatic(&db, Language::En, &root, &fake(true), 1).unwrap();
        assert!(result.found && !result.needs_choice);
        assert!(!needs_search(&db.lock().unwrap(), 1).unwrap());
        assert_eq!(
            db.lock().unwrap().query_row("SELECT video_id FROM music_sources", [], |r| r.get::<_, String>(0)).unwrap(),
            "abcdefghijk"
        );
    }

    struct SearchHook<'a> {
        hook: Box<dyn Fn() + Send + Sync + 'a>,
    }
    impl ThemeDownloader for SearchHook<'_> {
        fn download_video(&self, _: &str, _: &Path, _: &AtomicBool) -> Result<(), String> {
            panic!("a consulta manual não baixa áudio")
        }
        fn search(&self, _: &str, _: Option<&str>, _: Option<&str>) -> Result<ThemeSearchResult, String> {
            (self.hook)();
            fake(false).result
        }
    }
    #[test]
    fn resposta_antiga_nao_substitui_busca_nova_importacao_ou_disabled() {
        for action in 0..3 {
            let db = database();
            let root = temp_folder("busca-musica-concorrente");
            let source = root.join("manual.mp3");
            std::fs::write(&source, b"ID3\x04\0\0\0\0\0\0conteudo").unwrap();
            let downloader = SearchHook {
                hook: Box::new(|| {
                    assert!(db.try_lock().is_ok());
                    match action {
                        0 => {
                            search_choices(&db, Language::En, &fake(false), 1, Some("mais recente")).unwrap();
                        }
                        1 => {
                            music::pick_theme_music(&db, Language::En, &root, 1, Some(&source)).unwrap();
                        }
                        _ => {
                            music::remove_theme_music(&db, Language::En, &root, 1).unwrap();
                            music::use_automatic_theme_music(&db.lock().unwrap(), Language::En, 1).unwrap();
                        }
                    }
                }),
            };
            assert!(search_choices(&db, Language::En, &downloader, 1, None).is_err());
            let reviews = list_reviews(&db.lock().unwrap(), Language::En).unwrap();
            if action == 0 {
                assert_eq!(reviews[0].query, "mais recente");
            } else {
                assert!(reviews.is_empty());
            }
        }
    }
    #[test]
    fn revisao_sobrevive_reabertura_do_banco() {
        let folder = temp_folder("busca-musica-persistente");
        let path = folder.join("teste.db");
        let mut connection = Connection::open(&path).unwrap();
        crate::migrations::run_migrations(&mut connection).unwrap();
        connection.execute("INSERT INTO games(id,title,status_id,added_at) VALUES(1,'Jogo',1,'2026-01-01')", []).unwrap();
        let db = Mutex::new(connection);
        let review = search_choices(&db, Language::En, &fake(false), 1, None).unwrap();
        drop(db);
        let db = Connection::open(path).unwrap();
        let pending = list_reviews(&db, Language::En).unwrap();
        assert_eq!(pending[0].generation, review.generation);
        assert_eq!(pending[0].candidates, review.candidates);
    }
    #[test]
    fn consulta_falha_preserva_ultima_lista_util_e_sua_autorizacao() {
        let db = database();
        let previous = search_choices(&db, Language::En, &fake(false), 1, Some("consulta útil")).unwrap();
        let error = Fake { result: Err("falha externa".into()) };
        let result = search_choices(&db, Language::En, &error, 1, Some("consulta nova")).unwrap();
        assert_eq!(result.generation, previous.generation);
        assert_eq!(result.query, previous.query);
        assert_eq!(result.candidates, previous.candidates);
        assert_eq!(result.state, "needsChoice");
        assert!(result.error.is_some());
        assert!(authorize(&db.lock().unwrap(), Language::En, 1, &previous.generation, "abcdefghijk").is_ok());
    }
    #[test]
    fn consulta_interrompida_preserva_lista_no_disco_antes_de_qualquer_resposta() {
        let folder = temp_folder("busca-musica-interrompida");
        let path = folder.join("teste.db");
        let mut connection = Connection::open(&path).unwrap();
        crate::migrations::run_migrations(&mut connection).unwrap();
        connection.execute("INSERT INTO games(id,title,status_id,added_at) VALUES(1,'Jogo',1,'2026-01-01')", []).unwrap();
        let db = Mutex::new(connection);
        let previous = search_choices(&db, Language::En, &fake(false), 1, None).unwrap();
        let pending = SearchHook {
            hook: Box::new(|| {
                let reopened = Connection::open(&path).unwrap();
                let reviews = list_reviews(&reopened, Language::En).unwrap();
                assert_eq!(reviews.len(), 1);
                assert_eq!(reviews[0].generation, previous.generation);
                assert_eq!(reviews[0].candidates, previous.candidates);
                panic!("interrupção simulada fora da trava do banco");
            }),
        };
        let interrupted = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            search_choices(&db, Language::En, &pending, 1, Some("interrompida"))
        }));
        assert!(interrupted.is_err());
        drop(db);
        let reopened = Connection::open(&path).unwrap();
        let reviews = list_reviews(&reopened, Language::En).unwrap();
        assert_eq!(reviews.len(), 1);
        assert_eq!(reviews[0].generation, previous.generation);
        assert_eq!(reviews[0].candidates, previous.candidates);
        let restarted = Mutex::new(reopened);
        let next = search_choices(&restarted, Language::En, &fake(false), 1, Some("após reiniciar")).unwrap();
        assert_ne!(next.generation, previous.generation);
        assert_eq!(next.query, "após reiniciar");
    }
    #[test]
    fn tentativa_antiga_nao_vence_ultima_tentativa_falha() {
        let db = database();
        let previous = search_choices(&db, Language::En, &fake(false), 1, None).unwrap();
        let pending = SearchHook {
            hook: Box::new(|| {
                let error = Fake { result: Err("falha externa".into()) };
                search_choices(&db, Language::En, &error, 1, Some("mais recente")).unwrap();
            }),
        };
        assert!(search_choices(&db, Language::En, &pending, 1, Some("antiga")).is_err());
        let reviews = list_reviews(&db.lock().unwrap(), Language::En).unwrap();
        assert_eq!(reviews[0].generation, previous.generation);
        assert_eq!(reviews[0].candidates, previous.candidates);
    }
    #[test]
    fn falha_automatica_preserva_arquivo_e_permite_tentar_novamente() {
        struct Broken;
        impl ThemeDownloader for Broken {
            fn search(&self, _: &str, _: Option<&str>, _: Option<&str>) -> Result<ThemeSearchResult, String> {
                fake(true).result
            }
            fn download_video(&self, _: &str, path: &Path, _: &AtomicBool) -> Result<(), String> {
                std::fs::write(path, b"parcial").unwrap();
                Err("falhou".into())
            }
        }
        let db = database();
        let root = temp_folder("busca-musica-falha");
        search_automatic(&db, Language::En, &root, &fake(true), 1).unwrap();
        let before: String = db.lock().unwrap().query_row("SELECT theme_music FROM games", [], |r| r.get(0)).unwrap();
        music::use_automatic_theme_music(&db.lock().unwrap(), Language::En, 1).unwrap();
        assert!(search_automatic(&db, Language::En, &root, &Broken, 1).is_err());
        assert!(root.join("1").join(&before).is_file());
        assert_eq!(std::fs::read_dir(root.join("1")).unwrap().count(), 1);
        assert!(needs_search(&db.lock().unwrap(), 1).unwrap());
    }
    #[test]
    fn repeticao_automatica_conserva_pendencia_sem_consultar_novamente() {
        let db = database();
        let root = temp_folder("busca-musica-pendente");
        let first = search_automatic(&db, Language::En, &root, &fake(false), 1).unwrap();
        assert!(first.needs_choice);
        let no_search = SearchHook { hook: Box::new(|| panic!("lista atual não deve ser buscada novamente")) };
        let repeated = search_automatic(&db, Language::En, &root, &no_search, 1).unwrap();
        assert!(repeated.needs_choice);
        assert!(!repeated.found);
    }
    #[test]
    fn download_automatico_antigo_nao_vence_importacao_ou_reativacao() {
        struct Racing<'a> {
            db: &'a Mutex<Connection>,
            root: &'a Path,
            action: u8,
        }
        impl ThemeDownloader for Racing<'_> {
            fn search(&self, _: &str, _: Option<&str>, _: Option<&str>) -> Result<ThemeSearchResult, String> {
                fake(true).result
            }
            fn download_video(&self, _: &str, path: &Path, _: &AtomicBool) -> Result<(), String> {
                if self.action == 0 {
                    let source = self.root.join("original.mp3");
                    std::fs::write(&source, b"ID3\x04\0\0\0\0\0\0audio").unwrap();
                    music::pick_theme_music(self.db, Language::En, self.root, 1, Some(&source)).unwrap();
                } else {
                    music::remove_theme_music(self.db, Language::En, self.root, 1).unwrap();
                    music::use_automatic_theme_music(&self.db.lock().unwrap(), Language::En, 1).unwrap();
                }
                std::fs::write(path, b"\0\0\0\x18ftypM4A \0\0\0\0M4A isomconteudo").unwrap();
                Ok(())
            }
        }
        for action in 0..2 {
            let db = database();
            let root = temp_folder("musica-download-antigo");
            let downloader = Racing { db: &db, root: &root, action };
            assert!(search_automatic(&db, Language::En, &root, &downloader, 1).is_err());
            let (mode, file): (String, Option<String>) = db
                .lock()
                .unwrap()
                .query_row("SELECT theme_music_mode,theme_music FROM games", [], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap();
            assert!(list_reviews(&db.lock().unwrap(), Language::En).unwrap().is_empty());
            if action == 0 {
                assert_eq!(mode, "manual");
                assert!(file.is_some());
                assert_eq!(std::fs::read_dir(root.join("1")).unwrap().count(), 1);
            } else {
                assert_eq!(mode, "auto");
                assert_eq!(file, None);
                assert_eq!(std::fs::read_dir(root.join("1")).unwrap().count(), 0);
            }
        }
    }
    fn install_choice(db: &Mutex<Connection>, root: &Path) {
        let review = search_choices(db, Language::En, &fake(false), 1, None).unwrap();
        let cache = crate::music_previews::MusicPreviewCache::new(root.join("cache")).unwrap();
        cache.choose(db, Language::En, &root.join("images"), &fake(false), 1, &review.generation, "abcdefghijk", None).unwrap();
    }
    fn source(db: &Mutex<Connection>) -> Option<(String, String, String, i64)> {
        db.lock()
            .unwrap()
            .query_row("SELECT origin,video_id,title,revision FROM music_sources WHERE game_id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .optional()
            .unwrap()
    }
    #[test]
    fn origem_da_faixa_preservada_sobrevive_reativacao_e_busca_sem_substituicao() {
        for result in
            [Ok(ThemeSearchResult { candidates: vec![], automatic_video_id: None }), Err("falha".into()), fake(false).result]
        {
            let db = database();
            let root = temp_folder("musica-origem-preservada");
            install_choice(&db, &root);
            let previous = source(&db).unwrap();
            assert_eq!(previous.0, "choice");
            assert_eq!(previous.1, "abcdefghijk");
            let filename: String = db.lock().unwrap().query_row("SELECT theme_music FROM games", [], |r| r.get(0)).unwrap();
            music::use_automatic_theme_music(&db.lock().unwrap(), Language::En, 1).unwrap();
            let updated = source(&db).expect("reativar mantém a origem da faixa ainda associada");
            assert_eq!(updated, (previous.0, previous.1, previous.2, previous.3 + 1));
            let _ = search_automatic(&db, Language::En, &root.join("images"), &Fake { result }, 1);
            assert_eq!(source(&db), Some(updated));
            assert!(root.join("images/1").join(filename).is_file());
        }
    }
    #[test]
    fn importar_ou_remover_faixa_descarta_origem_da_copia_anterior() {
        for import in [false, true] {
            let db = database();
            let root = temp_folder("musica-origem-trocada");
            install_choice(&db, &root);
            assert!(source(&db).is_some());
            if import {
                let local = root.join("original.mp3");
                std::fs::write(&local, b"ID3\x04\0\0\0\0\0\0audio").unwrap();
                music::pick_theme_music(&db, Language::En, &root.join("images"), 1, Some(&local)).unwrap();
            } else {
                music::remove_theme_music(&db, Language::En, &root.join("images"), 1).unwrap();
            }
            assert_eq!(source(&db), None);
        }
    }
}
