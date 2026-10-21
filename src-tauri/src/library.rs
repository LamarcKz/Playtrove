//! A biblioteca que a interface mostra: os jogos, os status e as regras automáticas. Os campos e as
//! regras são os mesmos do app em Electron (src/main/library.ts), e o formato é o de LibrarySnapshot
//! (src/shared/types.ts).

use std::cmp::Ordering;
use std::collections::HashMap;

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;

use crate::achievements::trophy_store::games_waiting_for_trophies;
use crate::achievements::types::AchievementProgress;
use crate::achievements::views::progress_by_game;
use crate::dates::iso;
use crate::emulators::EmulatorId;
use crate::errors::{AppError, AppResult};
use crate::i18n::{LANGUAGES, Language, status_preset_name};
use crate::images::{ImageKind, image_url};
use crate::settings::{get_setting, set_setting};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    games: Vec<Game>,
    statuses: Vec<Status>,
    rules: StatusRules,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    id: i64,
    name: String,
    position: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusRules {
    new_game_status_id: i64,
    first_play_status_id: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Game {
    id: i64,
    title: String,
    status_id: i64,
    favorite: bool,
    playtime_minutes: i64,
    last_played_at: Option<String>,
    added_at: String,
    platform: Option<String>,
    library: Option<String>,
    rom_path: Option<String>,
    emulator_id: Option<String>,
    description: Option<String>,
    genres: Vec<String>,
    developers: Vec<String>,
    publishers: Vec<String>,
    release_date: Option<String>,
    cover_url: Option<String>,
    background_url: Option<String>,
    metadata_updated_at: Option<String>,
    rating: Option<i64>,
    difficulty: Option<i64>,
    review: Option<String>,
    achievements: Option<AchievementProgress>,
    trophies_pending: bool,
}

/// Tudo o que a interface precisa: jogos, status e regras.
pub fn get_library(db: &Connection, language: Language) -> rusqlite::Result<LibrarySnapshot> {
    Ok(LibrarySnapshot { games: list_games(db)?, statuses: list_statuses(db, language)?, rules: status_rules(db, language)? })
}

/// Os jogos, em ordem alfabética (ignorando acentos e maiúsculas).
fn list_games(db: &Connection) -> rusqlite::Result<Vec<Game>> {
    let mut achievements = progress_by_game(db)?;
    let waiting_for_trophies = games_waiting_for_trophies(db)?;
    let mut query = db.prepare(
        "SELECT id, title, status_id, favorite, playtime_seconds, last_played_at, added_at, platform, library,
                rom_path, emulator_id, description, genres, developer, publisher, release_date, cover_image,
                background_image, metadata_updated_at, emulator_playtime_seconds, emulator_last_played_at,
                rating, difficulty, review
         FROM games",
    )?;
    let mut games = query
        .query_map([], |row| {
            let id: i64 = row.get("id")?;
            let metadata_updated_at: Option<String> = row.get("metadata_updated_at")?;
            let image = |file: Option<String>| file.map(|file| image_url(id, &file, metadata_updated_at.as_deref()));
            // Vale o maior tempo entre o contado pelo app e o registrado pelo emulador (que inclui o que
            // foi jogado fora do app), e a última vez mais recente das duas.
            let seconds = row.get::<_, i64>("playtime_seconds")?.max(row.get("emulator_playtime_seconds")?);
            let achievements = achievements.remove(&id);
            Ok(Game {
                id,
                title: row.get("title")?,
                status_id: row.get("status_id")?,
                favorite: row.get::<_, i64>("favorite")? == 1,
                playtime_minutes: playtime_minutes(seconds),
                last_played_at: latest(row.get("last_played_at")?, row.get("emulator_last_played_at")?),
                added_at: row.get("added_at")?,
                platform: row.get("platform")?,
                library: row.get("library")?,
                rom_path: row.get("rom_path")?,
                emulator_id: row.get("emulator_id")?,
                description: row.get("description")?,
                genres: parse_list(row.get("genres")?),
                developers: parse_list(row.get("developer")?),
                publishers: parse_list(row.get("publisher")?),
                release_date: row.get("release_date")?,
                cover_url: image(row.get("cover_image")?),
                background_url: image(row.get("background_image")?),
                rating: row.get("rating")?,
                difficulty: row.get("difficulty")?,
                review: row.get("review")?,
                trophies_pending: achievements.is_none() && waiting_for_trophies.contains(&id),
                achievements,
                metadata_updated_at,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    games.sort_by(|a, b| compare_titles(&a.title, &b.title));
    Ok(games)
}

/// Jogado por menos de um minuto conta como 1 min (e não como "nunca jogado").
fn playtime_minutes(seconds: i64) -> i64 {
    if seconds > 0 { ((seconds as f64 / 60.0).round() as i64).max(1) } else { 0 }
}

/// A data mais recente (ISO) entre duas, ignorando as vazias.
fn latest(a: Option<String>, b: Option<String>) -> Option<String> {
    match (a, b) {
        (Some(a), Some(b)) => match (DateTime::parse_from_rfc3339(&a), DateTime::parse_from_rfc3339(&b)) {
            (Ok(first), Ok(second)) if first >= second => Some(a),
            _ => Some(b),
        },
        (a, b) => a.or(b),
    }
}

/// Lê uma lista guardada como JSON (ex.: ["Racing"]). Qualquer coisa estranha vira lista vazia.
fn parse_list(value: Option<String>) -> Vec<String> {
    let Some(value) = value else { return Vec::new() };
    match serde_json::from_str::<serde_json::Value>(&value) {
        Ok(serde_json::Value::Array(items)) => items.into_iter().filter_map(|item| item.as_str().map(str::to_string)).collect(),
        _ => Vec::new(),
    }
}

/// Compara dois nomes como a ordem alfabética do app: sem diferença entre maiúsculas e minúsculas nem
/// acentos, e com espaços e pontuação antes dos números, e os números antes das letras.
pub fn compare_titles(a: &str, b: &str) -> Ordering {
    sort_key(a).cmp(&sort_key(b))
}

fn sort_key(title: &str) -> Vec<(u8, char)> {
    title
        .nfd()
        .filter(|character| !is_combining_mark(*character))
        .flat_map(char::to_lowercase)
        .map(|character| {
            let group = if character.is_whitespace() {
                0
            } else if character.is_ascii_punctuation() {
                1
            } else if character.is_numeric() {
                2
            } else {
                3
            };
            (group, character)
        })
        .collect()
}

// ---------------------------------------------------------------- jogos

/// O que muda na avaliação: só as partes enviadas (None = não mexe; Some(None) = apaga a parte).
#[derive(Debug)]
pub struct GameEvaluation {
    pub rating: Option<Option<i64>>,
    pub difficulty: Option<Option<i64>>,
    pub review: Option<Option<String>>,
}

/// Marca ou desmarca um jogo como favorito.
pub fn set_game_favorite(db: &Connection, language: Language, game_id: i64, favorite: bool) -> AppResult<()> {
    let changed = db.execute("UPDATE games SET favorite = ?1 WHERE id = ?2", (i64::from(favorite), game_id))?;
    if changed == 0 {
        return Err(AppError::text(language, "errors.gameNotFound", &[]));
    }
    Ok(())
}

/// Muda a avaliação de um jogo: só as partes enviadas; a análise só com espaços também apaga. A data
/// da avaliação some quando não sobra nada.
pub fn save_game_evaluation(
    db: &Connection,
    language: Language,
    game_id: i64,
    changes: GameEvaluation,
    now: DateTime<Utc>,
) -> AppResult<()> {
    let current = db
        .query_row("SELECT rating, difficulty, review FROM games WHERE id = ?1", [game_id], |row| {
            Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, Option<i64>>(1)?, row.get::<_, Option<String>>(2)?))
        })
        .optional()?
        .ok_or_else(|| AppError::text(language, "errors.gameNotFound", &[]))?;
    let rating = changes.rating.unwrap_or(current.0);
    let difficulty = changes.difficulty.unwrap_or(current.1);
    let review = match changes.review {
        None => current.2,
        Some(review) => review.map(|text| text.trim().to_string()).filter(|text| !text.is_empty()),
    };
    let empty = rating.is_none() && difficulty.is_none() && review.is_none();
    db.execute(
        "UPDATE games SET rating = ?1, difficulty = ?2, review = ?3, evaluated_at = ?4 WHERE id = ?5",
        (rating, difficulty, review, (!empty).then(|| iso(now)), game_id),
    )?;
    Ok(())
}

/// Muda o status de um jogo (ex.: ao arrastar no Kanban).
pub fn set_game_status(db: &Connection, language: Language, game_id: i64, status_id: i64) -> AppResult<()> {
    assert_status_exists(db, language, status_id)?;
    if db.execute("UPDATE games SET status_id = ?1 WHERE id = ?2", (status_id, game_id))? == 0 {
        return Err(AppError::text(language, "errors.gameNotFound", &[]));
    }
    Ok(())
}

/// Sessões mais curtas que isto não contam: o emulador nem chegou a abrir. Qualquer abertura de verdade
/// conta, mesmo fechando antes de jogar (pedido do usuário em 2026-09-19).
const MIN_SESSION_SECONDS: f64 = 3.0;

/// Um jogo de emulador encontrado na varredura de uma pasta de ROMs.
pub struct EmulatedGame<'a> {
    pub title: &'a str,
    pub rom_path: &'a str,
    pub platform: &'a str,
    pub library: &'a str,
    pub emulator: EmulatorId,
    pub core: Option<&'a str>,
}

/// Coloca um jogo de emulador na biblioteca, com o status de "jogo novo" (regra automática). Devolve o
/// id do jogo novo, ou None se a ROM já estava na biblioteca.
pub fn add_emulated_game(db: &Connection, language: Language, game: &EmulatedGame) -> rusqlite::Result<Option<i64>> {
    let rules = status_rules(db, language)?;
    let added = db.execute(
        "INSERT INTO games (title, status_id, added_at, platform, library, rom_path, emulator_id, core)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(rom_path) DO NOTHING",
        (
            game.title,
            rules.new_game_status_id,
            iso(Utc::now()),
            game.platform,
            game.library,
            game.rom_path,
            game.emulator.id(),
            game.core,
        ),
    )?;
    Ok((added > 0).then(|| db.last_insert_rowid()))
}

/// Registra uma vez que o jogo foi jogado: soma o tempo, guarda a data e a sessão (para a atividade por
/// dia das Estatísticas). Na primeira vez, se o jogo ainda está no status de "jogo novo", ele vai para o
/// status de "primeiro jogo" (regra automática). Sessões curtas demais (menos de MIN_SESSION_SECONDS)
/// não contam.
pub fn record_play_session(
    db: &Connection,
    language: Language,
    game_id: i64,
    seconds: f64,
    ended_at: DateTime<Utc>,
) -> rusqlite::Result<()> {
    if seconds < MIN_SESSION_SECONDS {
        return Ok(());
    }
    let Some((status_id, last_played_at)) = db
        .query_row("SELECT status_id, last_played_at FROM games WHERE id = ?1", [game_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .optional()?
    else {
        return Ok(());
    };

    let rules = status_rules(db, language)?;
    let first_time = last_played_at.is_none();
    let status_id = if first_time && status_id == rules.new_game_status_id { rules.first_play_status_id } else { status_id };
    let rounded = seconds.round() as i64;
    let started_at = ended_at - chrono::Duration::seconds(rounded);
    let transaction = db.unchecked_transaction()?;
    transaction.execute(
        "UPDATE games SET playtime_seconds = playtime_seconds + ?1, last_played_at = ?2, status_id = ?3 WHERE id = ?4",
        (rounded, iso(ended_at), status_id, game_id),
    )?;
    transaction.execute(
        "INSERT INTO play_sessions (game_id, started_at, ended_at, seconds) VALUES (?1, ?2, ?3, ?4)",
        (game_id, iso(started_at), iso(ended_at), rounded),
    )?;
    transaction.commit()
}

/// O que o app precisa para abrir um jogo de emulador.
pub struct LaunchInfo {
    pub rom_path: Option<String>,
    pub emulator: Option<EmulatorId>,
    pub core: Option<String>,
}

pub fn get_launch_info(db: &Connection, language: Language, game_id: i64) -> AppResult<LaunchInfo> {
    db.query_row("SELECT rom_path, emulator_id, core FROM games WHERE id = ?1", [game_id], |row| {
        Ok(LaunchInfo {
            rom_path: row.get(0)?,
            emulator: row.get::<_, Option<String>>(1)?.as_deref().and_then(EmulatorId::from_id),
            core: row.get(2)?,
        })
    })
    .optional()?
    .ok_or_else(|| AppError::text(language, "errors.gameNotFound", &[]))
}

// ---------------------------------------------------------------- metadados

/// O que a busca de metadados precisa saber do jogo.
#[derive(Debug, PartialEq)]
pub struct MetadataTarget {
    pub title: String,
    pub platform: Option<String>,
    pub rom_path: Option<String>,
}

pub fn get_metadata_target(db: &Connection, language: Language, game_id: i64) -> AppResult<MetadataTarget> {
    db.query_row("SELECT title, platform, rom_path FROM games WHERE id = ?1", [game_id], |row| {
        Ok(MetadataTarget { title: row.get(0)?, platform: row.get(1)?, rom_path: row.get(2)? })
    })
    .optional()?
    .ok_or_else(|| AppError::text(language, "errors.gameNotFound", &[]))
}

/// O que foi encontrado para um jogo nos serviços de metadados. None = não encontrado (o valor antigo fica).
#[derive(Default)]
pub struct GameMetadata {
    pub description: Option<String>,
    pub genres: Option<Vec<String>>,
    pub developers: Option<Vec<String>>,
    pub publishers: Option<Vec<String>>,
    pub release_date: Option<String>,
    pub igdb_id: Option<i64>,
    pub sgdb_id: Option<i64>,
    /// Nomes dos arquivos das imagens baixadas (as que faltam continuam como estavam).
    pub images: HashMap<ImageKind, String>,
}

/// Grava os metadados de um jogo. O que não foi encontrado agora não apaga o que o jogo já tinha. A data
/// do download fica guardada mesmo sem nada encontrado: assim o jogo sai da lista dos "sem metadados".
pub fn save_game_metadata(db: &Connection, game_id: i64, metadata: &GameMetadata, updated_at: &str) -> rusqlite::Result<()> {
    let list = |values: &Option<Vec<String>>| values.as_ref().map(|values| serde_json::to_string(values).unwrap_or_default());
    db.execute(
        "UPDATE games SET
           description = COALESCE(?1, description),
           genres = COALESCE(?2, genres),
           developer = COALESCE(?3, developer),
           publisher = COALESCE(?4, publisher),
           release_date = COALESCE(?5, release_date),
           igdb_id = COALESCE(?6, igdb_id),
           sgdb_id = COALESCE(?7, sgdb_id),
           cover_image = COALESCE(?8, cover_image),
           background_image = COALESCE(?9, background_image),
           metadata_updated_at = ?10
         WHERE id = ?11",
        rusqlite::params![
            metadata.description,
            list(&metadata.genres),
            list(&metadata.developers),
            list(&metadata.publishers),
            metadata.release_date,
            metadata.igdb_id,
            metadata.sgdb_id,
            metadata.images.get(&ImageKind::Cover),
            metadata.images.get(&ImageKind::Background),
            updated_at,
            game_id,
        ],
    )?;
    Ok(())
}

/// Ids dos jogos que nunca tiveram os metadados baixados, em ordem alfabética.
pub fn list_games_without_metadata(db: &Connection) -> rusqlite::Result<Vec<i64>> {
    let mut rows: Vec<(i64, String)> = db
        .prepare("SELECT id, title FROM games WHERE metadata_updated_at IS NULL")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    rows.sort_by(|a, b| compare_titles(&a.1, &b.1));
    Ok(rows.into_iter().map(|(id, _)| id).collect())
}

// ---------------------------------------------------------------- status

/// Tamanho máximo do nome de um status (em caracteres, como a tela conta).
const MAX_STATUS_NAME: usize = 40;

/// Uma linha da tabela statuses. `preset` diz qual status padrão ela é (None nos criados ou renomeados).
struct StatusRow {
    id: i64,
    name: String,
    preset: Option<String>,
    position: i64,
}

fn status_rows(db: &Connection) -> rusqlite::Result<Vec<StatusRow>> {
    db.prepare("SELECT id, name, preset, position FROM statuses ORDER BY position")?
        .query_map([], |row| {
            Ok(StatusRow {
                id: row.get("id")?,
                name: row.get("name")?,
                preset: row.get("preset")?,
                position: row.get("position")?,
            })
        })?
        .collect()
}

/// O nome de um status no idioma do app: o dos status que vêm com o app sai do dicionário (escolha do
/// usuário em 2026-09-27); o dos outros é o que o usuário escreveu.
fn status_name(row: &StatusRow, language: Language) -> String {
    row.preset.as_deref().and_then(|preset| status_preset_name(language, preset)).unwrap_or_else(|| row.name.clone())
}

/// Os nomes que um status tem em todos os idiomas (um status novo não pode repetir nenhum deles).
fn names_in_all_languages(row: &StatusRow) -> Vec<String> {
    let mut names = vec![row.name.clone()];
    if let Some(preset) = &row.preset {
        names.extend(LANGUAGES.iter().filter_map(|language| status_preset_name(*language, preset)));
    }
    names
}

/// Os status, na ordem das colunas do Kanban, com o nome no idioma do app.
fn list_statuses(db: &Connection, language: Language) -> rusqlite::Result<Vec<Status>> {
    Ok(status_rows(db)?
        .iter()
        .map(|row| Status { id: row.id, name: status_name(row, language), position: row.position })
        .collect())
}

/// Cria um status no fim da lista.
pub fn create_status(db: &Connection, language: Language, name: &str) -> AppResult<Status> {
    let name = validate_status_name(db, language, name, None)?;
    let position: i64 = db.query_row("SELECT COALESCE(MAX(position) + 1, 0) FROM statuses", [], |row| row.get(0))?;
    db.execute("INSERT INTO statuses (name, position) VALUES (?1, ?2)", (&name, position))?;
    Ok(Status { id: db.last_insert_rowid(), name, position })
}

/// Troca o nome de um status. Um status padrão renomeado passa a ter o nome que o usuário escreveu,
/// nos dois idiomas.
pub fn rename_status(db: &Connection, language: Language, id: i64, name: &str) -> AppResult<()> {
    let rows = status_rows(db)?;
    let row = rows.iter().find(|row| row.id == id).ok_or_else(|| AppError::text(language, "errors.statusNotFound", &[]))?;
    let name = validate_status_name(db, language, name, Some(id))?;
    // O mesmo nome de agora (ex.: só com espaços a mais): nada muda.
    if name == status_name(row, language) {
        return Ok(());
    }
    db.execute("UPDATE statuses SET name = ?1, preset = NULL WHERE id = ?2", (name, id))?;
    Ok(())
}

/// Muda a ordem dos status. `ids` tem todos os status, na ordem nova.
pub fn reorder_statuses(db: &Connection, language: Language, ids: &[i64]) -> AppResult<()> {
    let transaction = db.unchecked_transaction()?;
    write_order(&transaction, language, ids)?;
    transaction.commit()?;
    Ok(())
}

fn write_order(db: &Connection, language: Language, ids: &[i64]) -> AppResult<()> {
    let current: Vec<i64> = status_rows(db)?.iter().map(|row| row.id).collect();
    let same_set = ids.len() == current.len() && current.iter().all(|id| ids.contains(id));
    if !same_set {
        return Err(AppError::text(language, "errors.statusOrder", &[]));
    }
    for (position, id) in ids.iter().enumerate() {
        db.execute("UPDATE statuses SET position = ?1 WHERE id = ?2", (position as i64, id))?;
    }
    Ok(())
}

/// Apaga um status. Os jogos dele (e as regras que usavam ele) passam para `move_to_id`. O último
/// status que sobrar não pode ser apagado.
pub fn delete_status(db: &Connection, language: Language, id: i64, move_to_id: i64) -> AppResult<()> {
    assert_status_exists(db, language, id)?;
    assert_status_exists(db, language, move_to_id)?;
    if id == move_to_id {
        return Err(AppError::text(language, "errors.chooseOtherStatus", &[]));
    }

    let transaction = db.unchecked_transaction()?;
    transaction.execute("UPDATE games SET status_id = ?1 WHERE status_id = ?2", (move_to_id, id))?;
    let rules = status_rules(&transaction, language)?;
    let replace = |rule: i64| if rule == id { move_to_id } else { rule };
    write_status_rules(&transaction, replace(rules.new_game_status_id), replace(rules.first_play_status_id))?;
    transaction.execute("DELETE FROM statuses WHERE id = ?1", [id])?;
    // Refaz as posições (0, 1, 2...) para não ficar um buraco na ordem.
    let remaining: Vec<i64> = status_rows(&transaction)?.iter().map(|row| row.id).collect();
    write_order(&transaction, language, &remaining)?;
    transaction.commit()?;
    Ok(())
}

/// As regras automáticas de status (sem regra gravada, vale o primeiro status).
fn status_rules(db: &Connection, language: Language) -> rusqlite::Result<StatusRules> {
    let first = list_statuses(db, language)?.first().map_or(0, |status| status.id);
    let rule = |key: &str| -> rusqlite::Result<i64> {
        let saved = get_setting(db, key)?.and_then(|value| value.parse::<i64>().ok());
        Ok(saved.filter(|id| *id != 0).unwrap_or(first))
    };
    Ok(StatusRules { new_game_status_id: rule("newGameStatusId")?, first_play_status_id: rule("firstPlayStatusId")? })
}

/// Troca as regras automáticas de status.
pub fn set_status_rules(
    db: &Connection,
    language: Language,
    new_game_status_id: i64,
    first_play_status_id: i64,
) -> AppResult<()> {
    assert_status_exists(db, language, new_game_status_id)?;
    assert_status_exists(db, language, first_play_status_id)?;
    write_status_rules(db, new_game_status_id, first_play_status_id)?;
    Ok(())
}

fn write_status_rules(db: &Connection, new_game_status_id: i64, first_play_status_id: i64) -> rusqlite::Result<()> {
    set_setting(db, "newGameStatusId", Some(&new_game_status_id.to_string()))?;
    set_setting(db, "firstPlayStatusId", Some(&first_play_status_id.to_string()))
}

fn assert_status_exists(db: &Connection, language: Language, id: i64) -> AppResult<()> {
    let exists = db.query_row("SELECT 1 FROM statuses WHERE id = ?1", [id], |_| Ok(())).optional()?.is_some();
    if !exists {
        return Err(AppError::text(language, "errors.statusNotFound", &[]));
    }
    Ok(())
}

/// Confere o nome de um status: não pode ser vazio, longo demais nem repetir o de outro status, em
/// nenhum dos idiomas (senão, trocando o idioma, duas colunas do Kanban ficariam com o mesmo nome).
/// Devolve o nome sem os espaços a mais.
fn validate_status_name(db: &Connection, language: Language, name: &str, ignore_id: Option<i64>) -> AppResult<String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(AppError::text(language, "errors.statusNameEmpty", &[]));
    }
    if name.encode_utf16().count() > MAX_STATUS_NAME {
        return Err(AppError::text(language, "errors.statusNameTooLong", &[&MAX_STATUS_NAME.to_string()]));
    }
    let key = sort_key(&name);
    let repeated = status_rows(db)?
        .iter()
        .filter(|row| Some(row.id) != ignore_id)
        .any(|row| names_in_all_languages(row).iter().any(|other| sort_key(other) == key));
    if repeated {
        return Err(AppError::text(language, "errors.statusNameTaken", &[&name]));
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::run_migrations;

    fn library_database() -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        db
    }

    fn add_game(db: &Connection, title: &str) -> i64 {
        db.execute("INSERT INTO games (title, status_id, added_at) VALUES (?1, 1, '2026-10-01T12:00:00.000Z')", [title]).unwrap();
        db.last_insert_rowid()
    }

    #[test]
    fn os_status_padrao_mudam_de_nome_com_o_idioma_e_os_renomeados_nao() {
        let db = library_database();
        db.execute("UPDATE statuses SET name = 'Na fila', preset = NULL WHERE position = 0", []).unwrap();
        let names = |language| list_statuses(&db, language).unwrap().into_iter().map(|status| status.name).collect::<Vec<_>>();
        assert_eq!(names(Language::PtBr)[..2], ["Na fila", "Parei por um tempo"]);
        assert_eq!(names(Language::En)[..2], ["Na fila", "On hold"]);
    }

    #[test]
    fn os_jogos_saem_em_ordem_alfabetica_sem_contar_acentos_nem_maiusculas() {
        let db = library_database();
        for title in ["zelda", "Ávalon", "Crash Bandicoot", "Burnout 3", "Burnout"] {
            add_game(&db, title);
        }
        let titles: Vec<_> = list_games(&db).unwrap().into_iter().map(|game| game.title).collect();
        assert_eq!(titles, ["Ávalon", "Burnout", "Burnout 3", "Crash Bandicoot", "zelda"]);
    }

    #[test]
    fn vale_o_maior_tempo_e_a_ultima_vez_mais_recente() {
        let db = library_database();
        let id = add_game(&db, "Jogo");
        db.execute(
            "UPDATE games SET playtime_seconds = 600, emulator_playtime_seconds = 1500,
               last_played_at = '2026-10-02T10:00:00.000Z', emulator_last_played_at = '2026-10-05T08:30:00.000Z',
               genres = '[\"Racing\",3]', cover_image = 'cover.png', metadata_updated_at = '2026-10-03T00:00:00.000Z'
             WHERE id = ?1",
            [id],
        )
        .unwrap();
        let game = list_games(&db).unwrap().remove(0);
        assert_eq!(game.playtime_minutes, 25);
        assert_eq!(game.last_played_at.as_deref(), Some("2026-10-05T08:30:00.000Z"));
        assert_eq!(game.genres, ["Racing"]);
        assert_eq!(
            game.cover_url.as_deref(),
            Some(format!("http://playtrove-img.localhost/{id}/cover.png?v=2026-10-03T00%3A00%3A00.000Z").as_str())
        );
        assert_eq!(game.background_url, None);
    }

    #[test]
    fn menos_de_um_minuto_conta_como_um() {
        assert_eq!(playtime_minutes(0), 0);
        assert_eq!(playtime_minutes(5), 1);
        assert_eq!(playtime_minutes(90), 2);
    }

    #[test]
    fn o_progresso_vem_dos_trofeus_e_do_retroachievements() {
        let db = library_database();
        let ps3 = add_game(&db, "Jogo de PS3");
        let gba = add_game(&db, "Jogo de GBA");
        let waiting = add_game(&db, "Jogo de PS3 sem abrir");
        db.execute("UPDATE games SET trophy_set = 'NPWR00001_00' WHERE id = ?1", [ps3]).unwrap();
        db.execute("UPDATE games SET trophy_set = 'NPWR00002_00' WHERE id = ?1", [waiting]).unwrap();
        db.execute_batch(
            "INSERT INTO trophies (set_id, id, name, grade, unlocked_at) VALUES
               ('NPWR00001_00', 0, 'Platina', 'platina', '2026-10-01T00:00:00.000Z'),
               ('NPWR00001_00', 1, 'Bronze', 'bronze', NULL);
             INSERT INTO ra_games (id, title, synced_at) VALUES (77, 'Jogo de GBA', '2026-10-01T00:00:00.000Z');
             INSERT INTO achievements (id, ra_game_id, title, earned_at) VALUES
               (1, 77, 'Primeira', '2026-10-01T00:00:00.000Z'), (2, 77, 'Segunda', '2026-10-02T00:00:00.000Z');",
        )
        .unwrap();
        db.execute("UPDATE games SET ra_game_id = 77 WHERE id = ?1", [gba]).unwrap();

        let games: HashMap<i64, Game> = list_games(&db).unwrap().into_iter().map(|game| (game.id, game)).collect();
        let trophies = games[&ps3].achievements.as_ref().unwrap();
        assert_eq!(
            (trophies.unlocked, trophies.total, trophies.platinum, trophies.source),
            (1, 2, true, crate::achievements::types::AchievementSource::Rpcs3)
        );
        let retro = games[&gba].achievements.as_ref().unwrap();
        assert_eq!(
            (retro.unlocked, retro.total, retro.platinum, retro.source),
            (2, 2, true, crate::achievements::types::AchievementSource::Retroachievements)
        );
        assert!(games[&waiting].trophies_pending);
        assert!(!games[&ps3].trophies_pending);
    }

    #[test]
    fn sem_regra_gravada_vale_o_primeiro_status() {
        let db = library_database();
        db.execute("DELETE FROM settings WHERE key = 'firstPlayStatusId'", []).unwrap();
        let rules = status_rules(&db, Language::PtBr).unwrap();
        let first = list_statuses(&db, Language::PtBr).unwrap()[0].id;
        assert_eq!(rules.first_play_status_id, first);
        assert_ne!(rules.new_game_status_id, 0);
    }

    const PT: Language = Language::PtBr;

    fn status_id(db: &Connection, name: &str) -> i64 {
        list_statuses(db, PT).unwrap().into_iter().find(|status| status.name == name).unwrap().id
    }

    fn status_names(db: &Connection) -> Vec<String> {
        list_statuses(db, PT).unwrap().into_iter().map(|status| status.name).collect()
    }

    fn error(result: AppResult<impl Sized>) -> String {
        match result {
            Ok(_) => panic!("deveria ter dado erro"),
            Err(error) => error.to_string(),
        }
    }

    #[test]
    fn muda_o_status_de_um_jogo() {
        let db = library_database();
        let id = add_game(&db, "Jogo");
        let zerado = status_id(&db, "Zerado");
        set_game_status(&db, PT, id, zerado).unwrap();
        assert_eq!(list_games(&db).unwrap()[0].status_id, zerado);
        assert_eq!(error(set_game_status(&db, PT, 999, zerado)), "Jogo não encontrado.");
        assert_eq!(error(set_game_status(&db, PT, id, 999)), "Status não encontrado.");
    }

    #[test]
    fn marca_e_desmarca_o_favorito() {
        let db = library_database();
        let id = add_game(&db, "Jogo");
        set_game_favorite(&db, PT, id, true).unwrap();
        assert!(list_games(&db).unwrap()[0].favorite);
        set_game_favorite(&db, PT, id, false).unwrap();
        assert!(!list_games(&db).unwrap()[0].favorite);
        assert_eq!(error(set_game_favorite(&db, PT, 999, true)), "Jogo não encontrado.");
    }

    #[test]
    fn cria_no_fim_tirando_espacos_extras() {
        let db = library_database();
        let status = create_status(&db, PT, "  Quero   rejogar ").unwrap();
        assert_eq!((status.name.as_str(), status.position), ("Quero rejogar", 9));
        assert_eq!(status_names(&db).last().unwrap(), "Quero rejogar");
    }

    #[test]
    fn nao_aceita_nome_vazio_longo_demais_ou_repetido() {
        let db = library_database();
        assert!(error(create_status(&db, PT, "   ")).contains("precisa de um nome"));
        assert!(error(create_status(&db, PT, &"x".repeat(41))).contains("até 40 letras"));
        assert!(error(create_status(&db, PT, "ZERADO")).contains("Já existe um status chamado \"ZERADO\""));
        // Repetido em outro idioma também não vale (o "Zerado" se chama "Beaten" em inglês).
        assert!(error(create_status(&db, PT, "beaten")).contains("Já existe"));
        assert!(error(rename_status(&db, PT, status_id(&db, "Jogando"), "zerado")).contains("Já existe"));
        assert!(error(create_status(&db, PT, "ABANDONÉI")).contains("Já existe"));
    }

    #[test]
    fn renomeia_inclusive_so_mudando_maiusculas_do_proprio_nome() {
        let db = library_database();
        let id = status_id(&db, "Planejo jogar");
        rename_status(&db, PT, id, "Planejo Jogar").unwrap();
        rename_status(&db, PT, id, "Quero jogar").unwrap();
        assert_eq!(status_names(&db)[0], "Quero jogar");
        // Renomeado, o nome fica o mesmo nos dois idiomas.
        assert_eq!(list_statuses(&db, Language::En).unwrap()[0].name, "Quero jogar");
    }

    #[test]
    fn muda_a_ordem_exigindo_todos_os_status_uma_vez_cada() {
        let db = library_database();
        let ids: Vec<i64> = list_statuses(&db, PT).unwrap().iter().map(|status| status.id).collect();
        let reversed: Vec<i64> = ids.iter().rev().copied().collect();
        reorder_statuses(&db, PT, &reversed).unwrap();
        assert_eq!(status_names(&db)[0], "Platinado");
        assert!(error(reorder_statuses(&db, PT, &ids[1..])).contains("todos os status"));
        let repeated = [&ids[..1], &ids[..ids.len() - 1]].concat();
        assert!(error(reorder_statuses(&db, PT, &repeated)).contains("todos os status"));
    }

    #[test]
    fn apagar_passa_os_jogos_e_as_regras_para_outro_status_e_refaz_as_posicoes() {
        let db = library_database();
        crate::sample_games::seed_sample_games(&db).unwrap();
        let planejo = status_id(&db, "Planejo jogar");
        let jogando = status_id(&db, "Jogando");
        let count = |id: i64| list_games(&db).unwrap().iter().filter(|game| game.status_id == id).count();
        assert_eq!((count(planejo), count(jogando)), (2, 3));

        delete_status(&db, PT, planejo, jogando).unwrap();

        assert!(!status_names(&db).contains(&"Planejo jogar".to_string()));
        let positions: Vec<i64> = list_statuses(&db, PT).unwrap().iter().map(|status| status.position).collect();
        assert_eq!(positions, (0..8).collect::<Vec<_>>());
        assert_eq!(count(jogando), 5);
        assert_eq!(status_rules(&db, PT).unwrap().new_game_status_id, jogando);
    }

    #[test]
    fn nao_apaga_para_ele_mesmo_nem_o_ultimo_status() {
        let db = library_database();
        let ids: Vec<i64> = list_statuses(&db, PT).unwrap().iter().map(|status| status.id).collect();
        assert!(error(delete_status(&db, PT, ids[0], ids[0])).contains("Escolha outro status"));
        for id in &ids[1..] {
            delete_status(&db, PT, *id, ids[0]).unwrap();
        }
        assert_eq!(list_statuses(&db, PT).unwrap().len(), 1);
        assert_eq!(error(delete_status(&db, PT, ids[0], 999)), "Status não encontrado.");
    }

    #[test]
    fn regras_automaticas_so_aceitam_status_que_existem() {
        let db = library_database();
        let zerado = status_id(&db, "Zerado");
        set_status_rules(&db, PT, zerado, zerado).unwrap();
        let rules = status_rules(&db, PT).unwrap();
        assert_eq!((rules.new_game_status_id, rules.first_play_status_id), (zerado, zerado));
        assert_eq!(error(set_status_rules(&db, PT, 999, zerado)), "Status não encontrado.");
    }

    fn evaluation(rating: Option<Option<i64>>, difficulty: Option<Option<i64>>, review: Option<Option<&str>>) -> GameEvaluation {
        GameEvaluation { rating, difficulty, review: review.map(|review| review.map(str::to_string)) }
    }

    fn evaluated_at(db: &Connection, id: i64) -> Option<String> {
        db.query_row("SELECT evaluated_at FROM games WHERE id = ?1", [id], |row| row.get(0)).unwrap()
    }

    #[test]
    fn guarda_a_nota_a_dificuldade_e_a_analise_sem_os_espacos_das_pontas() {
        let db = library_database();
        let id = add_game(&db, "Jogo");
        let now = DateTime::parse_from_rfc3339("2026-09-24T23:00:00.000Z").unwrap().with_timezone(&Utc);
        save_game_evaluation(
            &db,
            PT,
            id,
            evaluation(Some(Some(9)), Some(Some(7)), Some(Some("  Muito bom.\nRecomendo.  "))),
            now,
        )
        .unwrap();
        let game = list_games(&db).unwrap().remove(0);
        assert_eq!((game.rating, game.difficulty, game.review.as_deref()), (Some(9), Some(7), Some("Muito bom.\nRecomendo.")));
        assert_eq!(evaluated_at(&db, id).as_deref(), Some("2026-09-24T23:00:00.000Z"));
    }

    #[test]
    fn null_apaga_cada_parte_e_a_analise_so_de_espacos_vira_vazia() {
        let db = library_database();
        let id = add_game(&db, "Jogo");
        save_game_evaluation(&db, PT, id, evaluation(Some(Some(9)), Some(Some(7)), Some(Some("Texto"))), Utc::now()).unwrap();
        save_game_evaluation(&db, PT, id, evaluation(Some(None), Some(Some(3)), Some(Some("   "))), Utc::now()).unwrap();
        let game = list_games(&db).unwrap().remove(0);
        assert_eq!((game.rating, game.difficulty, game.review), (None, Some(3), None));

        save_game_evaluation(&db, PT, id, evaluation(Some(None), Some(None), Some(None)), Utc::now()).unwrap();
        // Sem nada avaliado, também não fica a data.
        assert_eq!(evaluated_at(&db, id), None);
    }

    #[test]
    fn cada_janela_muda_so_a_sua_parte() {
        let db = library_database();
        let id = add_game(&db, "Jogo");
        save_game_evaluation(&db, PT, id, evaluation(Some(Some(9)), Some(Some(7)), None), Utc::now()).unwrap();
        save_game_evaluation(&db, PT, id, evaluation(None, None, Some(Some("Texto"))), Utc::now()).unwrap();
        let game = list_games(&db).unwrap().remove(0);
        assert_eq!((game.rating, game.difficulty, game.review.as_deref()), (Some(9), Some(7), Some("Texto")));

        save_game_evaluation(&db, PT, id, evaluation(Some(None), Some(None), None), Utc::now()).unwrap();
        assert_eq!(list_games(&db).unwrap()[0].review.as_deref(), Some("Texto"));
        // Ainda tem a análise: a data continua.
        assert!(evaluated_at(&db, id).is_some());
        assert_eq!(
            error(save_game_evaluation(&db, PT, 999, evaluation(Some(Some(5)), None, None), Utc::now())),
            "Jogo não encontrado."
        );
    }
}
