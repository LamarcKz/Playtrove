//! A ponte entre o Playtrove e o Playnite do tema Aniki. A cada entrada, o Playtrove grava o
//! `library.json` que o plugin `PlaytroveBridge` (bridge/) importa, só com os dados do app; e um
//! servidor local, só em 127.0.0.1 e com um token novo a cada entrada, recebe do plugin os pedidos de
//! jogar e as mudanças de favorito, status e nota feitas no Aniki.

use std::hash::{BuildHasher, RandomState};
use std::io::Read;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread::JoinHandle;

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;

use crate::errors::AppResult;
use crate::i18n::Language;
use crate::library::{self, GameEvaluation};

/// O `Id` do plugin no Playnite: é o nome da pasta de dados dele.
pub const PLUGIN_GUID: &str = "7b0d4c1e-2f58-4a3b-9d61-8c5e0a2f7b93";
const TOKEN_HEADER: &str = "X-Playtrove-Token";
const BODY_LIMIT: u64 = 64 * 1024;

/// A pasta de dados do plugin dentro dos dados do Playnite (`library.json` e `bridge.json`).
pub fn plugin_data_dir(playnite_data: &Path) -> PathBuf {
    playnite_data.join("ExtensionsData").join(PLUGIN_GUID)
}

/// Os consoles do Playtrove (os das pastas de ROMs) nos ids oficiais do Playnite, que dão o ícone do tema.
pub fn platform_spec(platform: &str) -> Option<&'static str> {
    Some(match platform {
        "PlayStation 3" => "sony_playstation3",
        "PlayStation 2" => "sony_playstation2",
        "PlayStation" => "sony_playstation",
        "PlayStation Portable" => "sony_psp",
        "GameCube" => "nintendo_gamecube",
        "Wii" => "nintendo_wii",
        "Nintendo 3DS" => "nintendo_3ds",
        "Game Boy Advance" => "nintendo_gameboyadvance",
        "Game Boy Color" => "nintendo_gameboycolor",
        "Game Boy" => "nintendo_gameboy",
        "Nintendo DS" => "nintendo_ds",
        "Super Nintendo" => "nintendo_super_nes",
        "NES" => "nintendo_nes",
        "Nintendo 64" => "nintendo_64",
        "Mega Drive" => "sega_genesis",
        _ => return None,
    })
}

/// Grava a biblioteca para o plugin: nome, plataforma, tempo jogado (o maior entre o do app e o do
/// emulador), última vez, entrada, status (pela marca `preset`), favorito e nota. Capas, descrições e o
/// resto o Playnite busca sozinho.
pub fn export_library(db: &Connection, path: &Path) -> AppResult<()> {
    let mut statement = db.prepare(
        "SELECT g.id, g.title, g.platform, g.playtime_seconds, g.emulator_playtime_seconds, g.last_played_at,
                g.emulator_last_played_at, g.added_at, s.preset, g.favorite, g.rating
         FROM games g LEFT JOIN statuses s ON s.id = g.status_id ORDER BY g.id",
    )?;
    let games = statement
        .query_map([], |row| {
            let platform: Option<String> = row.get(2)?;
            let playtime = row.get::<_, Option<i64>>(3)?.unwrap_or(0).max(row.get::<_, Option<i64>>(4)?.unwrap_or(0));
            let last_played = row.get::<_, Option<String>>(5)?.max(row.get::<_, Option<String>>(6)?);
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "title": row.get::<_, String>(1)?,
                "platformSpec": platform.as_deref().and_then(platform_spec),
                "platform": platform,
                "playtimeSeconds": playtime,
                "lastPlayedAt": last_played,
                "addedAt": row.get::<_, Option<String>>(7)?,
                "statusPreset": row.get::<_, Option<String>>(8)?,
                "favorite": row.get::<_, bool>(9)?,
                "rating": row.get::<_, Option<i64>>(10)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.part");
    let document = serde_json::to_vec(&serde_json::json!({ "version": 1, "games": games })).map_err(std::io::Error::other)?;
    std::fs::write(&temporary, document)?;
    std::fs::rename(&temporary, path)?;
    Ok(())
}

/// O que o Aniki mudou num jogo.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GameUpdate {
    pub id: i64,
    pub favorite: bool,
    pub status_preset: Option<String>,
    pub rating: Option<i64>,
}

/// Grava pelo mesmo código do desktop; um status que o Playtrove não conhece fica como estava.
pub fn apply_game_update(db: &Connection, language: Language, update: &GameUpdate) -> AppResult<()> {
    library::set_game_favorite(db, language, update.id, update.favorite)?;
    if let Some(preset) = &update.status_preset {
        let status: Option<i64> =
            db.query_row("SELECT id FROM statuses WHERE preset = ?1", [preset], |row| row.get(0)).optional()?;
        if let Some(status) = status {
            library::set_game_status(db, language, update.id, status)?;
        }
    }
    let evaluation = GameEvaluation { rating: Some(update.rating), difficulty: None, review: None };
    library::save_game_evaluation(db, language, update.id, evaluation, Utc::now())
}

/// O que a ponte pede ao app: abrir um jogo (devolve o processo do emulador) e gravar uma mudança.
pub trait BridgeActions: Send + Sync {
    fn play(&self, game_id: i64) -> Result<u32, String>;
    fn update(&self, update: GameUpdate) -> Result<(), String>;
}

#[derive(Debug, PartialEq, Eq)]
pub struct Reply {
    pub status: u16,
    pub body: String,
}

fn reply(status: u16, body: impl Into<String>) -> Reply {
    Reply { status, body: body.into() }
}

#[derive(Deserialize)]
struct PlayRequest {
    id: i64,
}

/// Um pedido do plugin: sem o token certo, nada acontece.
pub fn handle(
    actions: &dyn BridgeActions,
    token: &str,
    method: &str,
    path: &str,
    header_token: Option<&str>,
    body: &str,
) -> Reply {
    if header_token != Some(token) {
        return reply(401, "");
    }
    if !matches!(path, "/play" | "/game") {
        return reply(404, "");
    }
    if method != "POST" {
        return reply(405, "");
    }
    let error = |message: String| reply(409, serde_json::json!({ "error": message }).to_string());
    match path {
        "/play" => match serde_json::from_str::<PlayRequest>(body) {
            Ok(request) => match actions.play(request.id) {
                Ok(process_id) => reply(200, serde_json::json!({ "processId": process_id }).to_string()),
                Err(message) => error(message),
            },
            Err(_) => reply(400, ""),
        },
        _ => match serde_json::from_str::<GameUpdate>(body) {
            Ok(update) => match actions.update(update) {
                Ok(()) => reply(204, ""),
                Err(message) => error(message),
            },
            Err(_) => reply(400, ""),
        },
    }
}

/// 32 bytes aleatórios em hexadecimal (o `RandomState` vem das chaves aleatórias do sistema).
fn new_token() -> String {
    (0..4u64).map(|part| format!("{:016x}", RandomState::new().hash_one(part))).collect()
}

/// O servidor local de uma entrada no Aniki; parar apaga o `bridge.json`.
pub struct BridgeServer {
    server: Arc<tiny_http::Server>,
    address: SocketAddr,
    config: PathBuf,
    thread: Option<JoinHandle<()>>,
}

impl BridgeServer {
    pub fn start(actions: Arc<dyn BridgeActions>, folder: &Path) -> std::io::Result<BridgeServer> {
        let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").map_err(std::io::Error::other)?);
        let address = server.server_addr().to_ip().ok_or_else(|| std::io::Error::other("sem endereço"))?;
        let token = new_token();
        std::fs::create_dir_all(folder)?;
        let config = folder.join("bridge.json");
        std::fs::write(&config, serde_json::json!({ "port": address.port(), "token": token }).to_string())?;
        let listener = server.clone();
        let thread = std::thread::spawn(move || {
            while let Ok(mut request) = listener.recv() {
                let header = request
                    .headers()
                    .iter()
                    .find(|header| header.field.equiv(TOKEN_HEADER))
                    .map(|header| header.value.as_str().to_string());
                let mut body = String::new();
                let read = request.as_reader().take(BODY_LIMIT).read_to_string(&mut body);
                let answer = if read.is_err() {
                    reply(400, "")
                } else {
                    handle(actions.as_ref(), &token, request.method().as_str(), request.url(), header.as_deref(), &body)
                };
                let response = tiny_http::Response::from_string(answer.body).with_status_code(answer.status);
                let _ = request.respond(response);
            }
        });
        Ok(BridgeServer { server, address, config, thread: Some(thread) })
    }

    pub fn port(&self) -> u16 {
        self.address.port()
    }

    pub fn address(&self) -> SocketAddr {
        self.address
    }

    pub fn stop(mut self) {
        self.server.unblock();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        let _ = std::fs::remove_file(&self.config);
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::i18n::Language;
    use crate::test_support::{memory_database, temp_folder};

    #[derive(Default)]
    struct FakeActions {
        busy: bool,
        played: Mutex<Vec<i64>>,
        updates: Mutex<Vec<GameUpdate>>,
    }

    impl BridgeActions for FakeActions {
        fn play(&self, game_id: i64) -> Result<u32, String> {
            if self.busy {
                return Err("Já tem um jogo aberto.".into());
            }
            self.played.lock().unwrap().push(game_id);
            Ok(4242)
        }
        fn update(&self, update: GameUpdate) -> Result<(), String> {
            self.updates.lock().unwrap().push(update);
            Ok(())
        }
    }

    fn insert_game(db: &Connection) -> i64 {
        db.execute(
            "INSERT INTO games (title, status_id, added_at, platform, playtime_seconds, emulator_playtime_seconds, favorite, rating,
                description, last_played_at)
             VALUES ('Jogo Fictício', 4, '2026-01-02T03:04:05.000Z', 'Super Nintendo', 60, 600, 1, 8,
                'Uma descrição do IGDB', '2026-10-20T12:00:00.000Z')",
            [],
        )
        .unwrap();
        db.last_insert_rowid()
    }

    #[test]
    fn exporta_so_os_dados_do_playtrove() {
        let db = memory_database();
        let id = insert_game(&db);
        let path = temp_folder("ponte-exportar").join("library.json");
        export_library(&db, &path).unwrap();
        let document: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(document["version"], 1);
        let game = &document["games"][0];
        assert_eq!(game["id"], id);
        assert_eq!(game["title"], "Jogo Fictício");
        assert_eq!(game["platform"], "Super Nintendo");
        assert_eq!(game["platformSpec"], "nintendo_super_nes");
        // O maior entre o tempo do app e o do emulador, como na tela.
        assert_eq!(game["playtimeSeconds"], 600);
        assert_eq!(game["statusPreset"], "playing");
        assert_eq!(game["favorite"], true);
        assert_eq!(game["rating"], 8);
        assert_eq!(game["lastPlayedAt"], "2026-10-20T12:00:00.000Z");
        let keys: Vec<&String> = game.as_object().unwrap().keys().collect();
        for forbidden in ["description", "cover", "background", "logo", "genres", "romPath"] {
            assert!(!keys.iter().any(|key| key.as_str() == forbidden), "{forbidden}");
        }
    }

    #[test]
    fn plataformas_do_playtrove_nos_ids_do_playnite() {
        assert_eq!(platform_spec("PlayStation Portable"), Some("sony_psp"));
        assert_eq!(platform_spec("GameCube"), Some("nintendo_gamecube"));
        assert_eq!(platform_spec("Mega Drive"), Some("sega_genesis"));
        assert_eq!(platform_spec("Console Inventado"), None);
    }

    #[test]
    fn recusa_sem_token_e_com_token_errado() {
        let actions = FakeActions::default();
        for header in [None, Some("errado")] {
            let reply = handle(&actions, "segredo", "POST", "/play", header, r#"{"id": 1}"#);
            assert_eq!(reply.status, 401);
        }
        assert!(actions.played.lock().unwrap().is_empty());
    }

    #[test]
    fn play_devolve_o_processo_ou_409_com_jogo_aberto() {
        let actions = FakeActions::default();
        let reply = handle(&actions, "segredo", "POST", "/play", Some("segredo"), r#"{"id": 7}"#);
        assert_eq!((reply.status, reply.body.as_str()), (200, r#"{"processId":4242}"#));
        assert_eq!(*actions.played.lock().unwrap(), [7]);
        let busy = FakeActions { busy: true, ..FakeActions::default() };
        let reply = handle(&busy, "segredo", "POST", "/play", Some("segredo"), r#"{"id": 7}"#);
        assert_eq!(reply.status, 409);
        assert!(reply.body.contains("Já tem um jogo aberto."));
    }

    #[test]
    fn pedido_malformado_ou_rota_desconhecida() {
        let actions = FakeActions::default();
        assert_eq!(handle(&actions, "s", "POST", "/play", Some("s"), "{").status, 400);
        assert_eq!(handle(&actions, "s", "GET", "/play", Some("s"), "").status, 405);
        assert_eq!(handle(&actions, "s", "POST", "/apagar", Some("s"), "{}").status, 404);
    }

    #[test]
    fn game_grava_favorito_status_e_nota() {
        let db = memory_database();
        let id = insert_game(&db);
        let update = GameUpdate { id, favorite: false, status_preset: Some("beaten".into()), rating: None };
        apply_game_update(&db, Language::PtBr, &update).unwrap();
        let (favorite, preset, rating): (bool, Option<String>, Option<i64>) = db
            .query_row(
                "SELECT g.favorite, s.preset, g.rating FROM games g JOIN statuses s ON s.id = g.status_id WHERE g.id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!((favorite, preset.as_deref(), rating), (false, Some("beaten"), None));
        // Um status que o Playtrove não conhece (ou nenhum) não muda o do jogo.
        let update = GameUpdate { id, favorite: true, status_preset: Some("outro".into()), rating: Some(6) };
        apply_game_update(&db, Language::PtBr, &update).unwrap();
        let preset: String = db
            .query_row("SELECT s.preset FROM games g JOIN statuses s ON s.id = g.status_id WHERE g.id = ?1", [id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(preset, "beaten");
    }

    #[test]
    fn servidor_escuta_so_no_localhost_e_grava_a_porta_e_o_token() {
        let folder = temp_folder("ponte-servidor");
        let actions = Arc::new(FakeActions::default());
        let server = BridgeServer::start(actions.clone(), &folder).unwrap();
        let config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(folder.join("bridge.json")).unwrap()).unwrap();
        assert_eq!(config["port"], server.port());
        let token = config["token"].as_str().unwrap().to_string();
        assert_eq!(token.len(), 64);
        assert_eq!(server.address().ip(), std::net::Ipv4Addr::LOCALHOST);
        let body = r#"{"id": 3}"#;
        let mut stream = TcpStream::connect(("127.0.0.1", server.port())).unwrap();
        write!(stream, "POST /play HTTP/1.1\r\nHost: x\r\nX-Playtrove-Token: {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        assert_eq!(*actions.played.lock().unwrap(), [3]);
        server.stop();
        assert!(!folder.join("bridge.json").exists());
    }
}
