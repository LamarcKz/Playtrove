//! O download dos metadados e das imagens de um jogo.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};

use chrono::Utc;
use regex::{Regex, RegexBuilder};
use rusqlite::Connection;

use super::http::{Fetch, HttpRequest, MetadataEndpoints, MetadataError};
use super::igdb::{IgdbGame, IgdbSession, igdb_image_url, igdb_platform_id, prefer_original};
use super::libretro::libretro_boxart_url;
use super::matching::{pick_best_match, search_term_for};
use super::steam_grid_db::SteamGridDbSession;
use crate::dates::iso;
use crate::i18n::Language;
use crate::images::{ImageKind, MAX_IMAGE_BYTES, image_extension, save_game_image};
use crate::library::{GameMetadata, get_metadata_target, save_game_metadata};

/// Os serviços configurados agora (o IGDB e o SteamGridDB podem faltar; o libretro-thumbnails não precisa
/// de chave e vale sempre) e onde guardar as imagens.
pub struct MetadataServices {
    pub fetch: Arc<dyn Fetch>,
    pub endpoints: MetadataEndpoints,
    pub igdb: Option<Arc<IgdbSession>>,
    pub steam_grid_db: Option<SteamGridDbSession>,
    /// Pasta das imagens dos jogos (uma subpasta por jogo).
    pub images_dir: PathBuf,
}

/// O banco, só durante as leituras e gravações (os pedidos pela internet acontecem sem ele).
pub fn lock(db: &Mutex<Connection>) -> MutexGuard<'_, Connection> {
    db.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Baixa os metadados e as imagens de um jogo e grava tudo no banco:
/// 1. IGDB: descrição, gêneros, desenvolvedora, publicadora e lançamento (buscando só na plataforma do
///    jogo; sem resultado, em todas);
/// 2. capa: a oficial do libretro-thumbnails (pelo nome exato da ROM, nos jogos de emulador); se não
///    houver, a do SteamGridDB (buscando pelo nome oficial que veio do IGDB); por fim, a do IGDB;
/// 3. fundo: o do SteamGridDB; se não houver, uma arte ou tela do jogo do IGDB.
///
/// Devolve true se o jogo foi encontrado em algum lugar.
pub fn download_game_metadata(
    db: &Mutex<Connection>,
    language: Language,
    game_id: i64,
    services: &MetadataServices,
) -> Result<bool, MetadataError> {
    let game = get_metadata_target(&lock(db), language, game_id).map_err(|error| MetadataError::Skip(error.to_string()))?;
    let term = search_term_for(&game.title);

    let mut igdb_game: Option<IgdbGame> = None;
    if let Some(igdb) = &services.igdb {
        let platform_id = igdb_platform_id(game.platform.as_deref());
        let mut results = igdb.search(&term, platform_id)?;
        if results.is_empty() && platform_id.is_some() {
            results = igdb.search(&term, None)?;
        }
        igdb_game = pick_best_match(&term, results, Some(prefer_original));
    }

    let mut sgdb_id = None;
    let mut sgdb_images = HashMap::new();
    if let Some(steam_grid_db) = &services.steam_grid_db {
        let name = igdb_game.as_ref().map_or(term.clone(), |game| game.name.clone());
        if let Some(found) = pick_best_match(&name, steam_grid_db.search(&name)?, None) {
            sgdb_id = Some(found.id);
            sgdb_images = steam_grid_db.images(found.id)?;
        }
    }

    // Cada imagem tem uma ordem de fontes: vale a primeira que baixar.
    let libretro_cover = libretro_boxart_url(&services.endpoints, game.platform.as_deref(), game.rom_path.as_deref());
    let igdb_image = |size: &str, id: Option<&String>| id.map(|id| igdb_image_url(&services.endpoints, size, id));
    let candidates = [
        (
            ImageKind::Cover,
            vec![
                libretro_cover.clone(),
                sgdb_images.get(&ImageKind::Cover).cloned(),
                igdb_image("t_cover_big", igdb_game.as_ref().and_then(|game| game.cover_image_id.as_ref())),
            ],
        ),
        (
            ImageKind::Background,
            vec![
                sgdb_images.get(&ImageKind::Background).cloned(),
                igdb_image("t_1080p", igdb_game.as_ref().and_then(|game| game.background_image_ids.first())),
            ],
        ),
    ];
    let mut images = HashMap::new();
    let mut found_on_libretro = false;
    for (kind, urls) in candidates {
        for url in urls.into_iter().flatten() {
            let Some(file) = download_image(services, &url, game_id, kind) else { continue };
            images.insert(kind, file);
            found_on_libretro |= Some(&url) == libretro_cover.as_ref();
            break;
        }
    }

    let metadata = GameMetadata {
        description: igdb_game.as_ref().and_then(|game| game.summary.clone()),
        genres: igdb_game.as_ref().map(|game| game.genres.clone()),
        developers: igdb_game.as_ref().map(|game| game.developers.clone()),
        publishers: igdb_game.as_ref().map(|game| game.publishers.clone()),
        release_date: igdb_game.as_ref().and_then(|game| game.release_date.clone()),
        igdb_id: igdb_game.as_ref().map(|game| game.id),
        sgdb_id,
        images,
    };
    save_game_metadata(&lock(db), game_id, &metadata, &iso(Utc::now()))
        .map_err(|error| MetadataError::Skip(error.to_string()))?;
    Ok(igdb_game.is_some() || sgdb_id.is_some() || found_on_libretro)
}

/// Baixa uma imagem e guarda na pasta do jogo. Se não der (link quebrado, não é imagem, grande demais),
/// devolve None: o jogo fica com a imagem que já tinha.
fn download_image(services: &MetadataServices, url: &str, game_id: i64, kind: ImageKind) -> Option<String> {
    let response = services.fetch.fetch(&HttpRequest::get(url.to_string())).ok()?;
    // Tipo de imagem conhecido: vale ele. Sem tipo (ou "binário"): vale a extensão do endereço. Qualquer
    // outro tipo (ex.: uma página de erro) não é imagem.
    let content_type = response.content_type.as_deref();
    let extension =
        image_extension(content_type).or_else(|| if is_generic_type(content_type) { extension_from_url(url) } else { None })?;
    if !response.ok() || response.body.is_empty() || response.body.len() > MAX_IMAGE_BYTES {
        return None;
    }
    save_game_image(&services.images_dir, game_id, kind, &response.body, extension).ok()
}

/// O servidor não disse que tipo de arquivo é?
fn is_generic_type(content_type: Option<&str>) -> bool {
    let mime = content_type.and_then(|value| value.split(';').next()).unwrap_or_default().trim().to_lowercase();
    mime.is_empty() || mime == "application/octet-stream" || mime == "binary/octet-stream"
}

/// Extensão pelo fim do endereço, para servidores que não dizem o tipo da imagem.
fn extension_from_url(url: &str) -> Option<&'static str> {
    static EXTENSION: LazyLock<Regex> = LazyLock::new(|| {
        RegexBuilder::new(r"\.(png|jpe?g|webp|gif|ico)(?:$|\?)").case_insensitive(true).build().expect("expressão fixa")
    });
    match EXTENSION.captures(url)?[1].to_lowercase().as_str() {
        "png" => Some("png"),
        "jpg" | "jpeg" => Some("jpg"),
        "webp" => Some("webp"),
        "gif" => Some("gif"),
        _ => Some("ico"),
    }
}

#[cfg(test)]
pub mod tests {
    use std::path::Path;

    use serde_json::json;

    use super::super::http::fake::{FakeFetch, image, json as json_response, not_found};
    use super::super::igdb::tests::{credentials, endpoints, salto_estelar};
    use super::*;
    use crate::emulators::EmulatorId;
    use crate::library::{EmulatedGame, add_emulated_game};
    use crate::test_support::{memory_database, temp_folder};

    type Override = Box<dyn Fn() -> Result<super::super::http::HttpResponse, String> + Send + Sync>;

    /// Os dois serviços respondendo como de verdade, com o Salto Estelar encontrado nos dois. `overrides`
    /// troca a resposta de um caminho.
    pub fn services_world(overrides: Vec<(&'static str, Override)>) -> Arc<FakeFetch> {
        Arc::new(FakeFetch::new(move |url, request| {
            let path = url.path();
            if let Some((_, custom)) = overrides.iter().find(|(route, _)| *route == path) {
                return custom();
            }
            let body = request.body.as_deref().unwrap_or_default();
            match path {
                "/twitch/token" => json_response(json!({ "access_token": "token-1", "expires_in": 5_000_000 }), 200),
                "/igdb/games" => {
                    json_response(if body.contains("\"Salto Estelar\"") { json!([salto_estelar()]) } else { json!([]) }, 200)
                }
                _ if path.starts_with("/sgdb/search/autocomplete/") => {
                    json_response(json!({ "success": true, "data": [{ "id": 55, "name": "Salto Estelar" }] }), 200)
                }
                "/sgdb/grids/game/55" => {
                    json_response(json!({ "success": true, "data": [{ "url": "https://cdn.test/capa.png" }] }), 200)
                }
                "/sgdb/heroes/game/55" => {
                    json_response(json!({ "success": true, "data": [{ "url": "https://cdn.test/fundo.jpg" }] }), 200)
                }
                _ if url.host_str() == Some("cdn.test") => image(if path.ends_with(".png") { "image/png" } else { "image/jpeg" }),
                _ if path.starts_with("/igdb-images/") => image("image/jpeg"),
                _ => json_response(json!({ "erro": "não encontrado" }), 404),
            }
        }))
    }

    /// Os serviços com as chaves certas (`only`: só "igdb" ou só "sgdb").
    pub fn make_services(fetch: Arc<FakeFetch>, images_dir: &Path, only: Option<&str>) -> MetadataServices {
        let shared: Arc<dyn Fetch> = fetch;
        MetadataServices {
            fetch: Arc::clone(&shared),
            endpoints: endpoints(),
            images_dir: images_dir.to_path_buf(),
            igdb: (only != Some("sgdb"))
                .then(|| Arc::new(IgdbSession::new(Arc::clone(&shared), endpoints(), credentials(), Language::PtBr))),
            steam_grid_db: (only != Some("igdb"))
                .then(|| SteamGridDbSession::new(Arc::clone(&shared), endpoints(), "chave-certa".into(), Language::PtBr)),
        }
    }

    /// Um banco com um jogo de PS2 (e o id dele).
    pub fn database_with_game(title: &str) -> (Mutex<Connection>, i64) {
        let db = memory_database();
        let rom = format!(r"D:\PS2\{title}.iso");
        let game = EmulatedGame {
            title,
            rom_path: &rom,
            platform: "PlayStation 2",
            library: "PCSX2",
            emulator: EmulatorId::Pcsx2,
            core: None,
        };
        let id = add_emulated_game(&db, Language::PtBr, &game).unwrap().unwrap();
        (Mutex::new(db), id)
    }

    fn field(db: &Mutex<Connection>, column: &str) -> Option<String> {
        lock(db).query_row(&format!("SELECT {column} FROM games"), [], |row| row.get(0)).unwrap()
    }

    fn files(dir: &Path, game_id: i64) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir.join(game_id.to_string()))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn download(db: &Mutex<Connection>, game_id: i64, services: &MetadataServices) -> bool {
        download_game_metadata(db, Language::PtBr, game_id, services).unwrap()
    }

    #[test]
    fn junta_o_igdb_e_o_steamgriddb_guarda_as_imagens_e_grava_no_banco() {
        let (db, game_id) = database_with_game("Salto Estelar");
        let images = temp_folder("metadados-junta");
        assert!(download(&db, game_id, &make_services(services_world(vec![]), &images, None)));

        assert_eq!(field(&db, "description").as_deref(), Some("A aventura continua."));
        assert_eq!(field(&db, "genres").as_deref(), Some(r#"["Platform","Adventure","Gênero Novo"]"#));
        assert_eq!(field(&db, "developer").as_deref(), Some(r#"["Estúdio Aurora"]"#));
        assert_eq!(field(&db, "publisher").as_deref(), Some(r#"["Editora Meridiano"]"#));
        assert_eq!(field(&db, "release_date").as_deref(), Some("2003-10-14"));
        assert_eq!(field(&db, "cover_image").as_deref(), Some("cover.png"));
        assert_eq!(field(&db, "background_image").as_deref(), Some("background.jpg"));
        assert_eq!(files(&images, game_id), ["background.jpg", "cover.png"]);
        assert!(crate::library::list_games_without_metadata(&lock(&db)).unwrap().is_empty());
    }

    #[test]
    fn um_hack_com_o_mesmo_nome_nao_toma_o_lugar_do_jogo_original() {
        let (db, game_id) = database_with_game("Salto Estelar");
        let mut hack = salto_estelar();
        hack["id"] = json!(99);
        hack["name"] = json!("Salto Estelar+");
        hack["summary"] = json!("Este hack muda tudo.");
        hack["game_type"] = json!(5);
        let both = json!([hack, salto_estelar()]);
        let fetch = services_world(vec![("/igdb/games", Box::new(move || json_response(both.clone(), 200)))]);
        download(&db, game_id, &make_services(fetch, &temp_folder("metadados-hack"), Some("igdb")));
        assert_eq!(field(&db, "description").as_deref(), Some("A aventura continua."));
    }

    #[test]
    fn sem_imagens_no_steamgriddb_a_capa_e_o_fundo_vem_do_igdb() {
        let (db, game_id) = database_with_game("Salto Estelar");
        let images = temp_folder("metadados-igdb-imagens");
        let fetch = services_world(vec![(
            "/sgdb/search/autocomplete/Salto%20Estelar",
            Box::new(|| json_response(json!({ "success": true, "data": [] }), 200)),
        )]);
        download(&db, game_id, &make_services(Arc::clone(&fetch), &images, None));
        let urls = fetch.urls();
        assert!(urls.contains(&"https://servidor/igdb-images/t_cover_big/co1abc.jpg".to_string()));
        assert!(urls.contains(&"https://servidor/igdb-images/t_1080p/ar1.jpg".to_string()));
        assert_eq!(files(&images, game_id), ["background.jpg", "cover.jpg"]);
    }

    #[test]
    fn so_o_steamgriddb_configurado_baixa_so_as_imagens() {
        let (db, game_id) = database_with_game("Salto Estelar");
        let fetch = services_world(vec![]);
        assert!(download(&db, game_id, &make_services(Arc::clone(&fetch), &temp_folder("metadados-so-sgdb"), Some("sgdb"))));
        assert!(!fetch.urls().iter().any(|url| url.contains("/igdb")));
        assert_eq!(field(&db, "description"), None);
        assert_eq!(field(&db, "genres"), None);
        assert!(field(&db, "cover_image").is_some());
    }

    #[test]
    fn jogo_nao_encontrado_tenta_sem_a_plataforma_marca_a_data_e_nao_apaga_o_que_havia() {
        let (db, game_id) = database_with_game("Meu Jogo Caseiro");
        let old = GameMetadata { description: Some("Descrição antiga".into()), ..GameMetadata::default() };
        save_game_metadata(&lock(&db), game_id, &old, "2026-01-01T00:00:00.000Z").unwrap();
        let fetch = services_world(vec![(
            "/sgdb/search/autocomplete/Meu%20Jogo%20Caseiro",
            Box::new(|| json_response(json!({ "success": true, "data": [{ "id": 9, "name": "Minecraft" }] }), 200)),
        )]);
        assert!(!download(&db, game_id, &make_services(Arc::clone(&fetch), &temp_folder("metadados-nao-achou"), None)));

        let calls = fetch.calls.lock().unwrap().clone();
        let igdb: Vec<_> = calls.iter().filter(|call| call.url.ends_with("/igdb/games")).collect();
        assert_eq!(igdb.len(), 2);
        assert!(igdb[0].body.clone().unwrap().contains("where platforms = (8);"));
        assert!(!igdb[1].body.clone().unwrap().contains("where"));
        assert_eq!(field(&db, "description").as_deref(), Some("Descrição antiga"));
        assert_ne!(field(&db, "metadata_updated_at").as_deref(), Some("2026-01-01T00:00:00.000Z"));
    }

    #[test]
    fn nenhuma_capa_disponivel_nao_apaga_a_que_o_jogo_ja_tinha() {
        let (db, game_id) = database_with_game("Salto Estelar");
        let images = temp_folder("metadados-capa-fica");
        download(&db, game_id, &make_services(services_world(vec![]), &images, None));

        let broken = services_world(vec![
            ("/capa.png", Box::new(not_found)),
            ("/igdb-images/t_cover_big/co1abc.jpg", Box::new(not_found)),
        ]);
        download(&db, game_id, &make_services(broken, &images, None));
        assert!(images.join(game_id.to_string()).join("cover.png").exists());
        assert_eq!(field(&db, "cover_image").as_deref(), Some("cover.png"));
    }

    #[test]
    fn a_capa_vem_do_libretro_quando_existe_e_sem_ela_do_steamgriddb_e_depois_do_igdb() {
        const LIBRETRO: &str = "/libretro/Sony%20-%20PlayStation%202/Named_Boxarts/Salto%20Estelar.png";

        // 1. Com a capa no libretro-thumbnails (achada pelo nome exato da ROM).
        let with_libretro = services_world(vec![(LIBRETRO, Box::new(|| image("image/png")))]);
        let (db, game_id) = database_with_game("Salto Estelar");
        download(&db, game_id, &make_services(Arc::clone(&with_libretro), &temp_folder("metadados-libretro-1"), None));
        assert!(with_libretro.urls().iter().any(|url| url.ends_with(LIBRETRO)));
        // A capa veio do libretro: o SteamGridDB nem foi baixado.
        assert!(!with_libretro.urls().contains(&"https://cdn.test/capa.png".to_string()));

        // 2. Sem ela, vale a do SteamGridDB.
        let without = services_world(vec![]);
        let (db, game_id) = database_with_game("Salto Estelar");
        download(&db, game_id, &make_services(Arc::clone(&without), &temp_folder("metadados-libretro-2"), None));
        assert!(without.urls().contains(&"https://cdn.test/capa.png".to_string()));

        // 3. Sem o SteamGridDB: sobra a do IGDB.
        let only_igdb = services_world(vec![]);
        let (db, game_id) = database_with_game("Salto Estelar");
        download(&db, game_id, &make_services(Arc::clone(&only_igdb), &temp_folder("metadados-libretro-3"), Some("igdb")));
        assert!(only_igdb.urls().contains(&"https://servidor/igdb-images/t_cover_big/co1abc.jpg".to_string()));
    }

    #[test]
    fn servidor_sem_tipo_vale_a_extensao_do_endereco() {
        assert_eq!(extension_from_url("https://cdn.test/capa.JPEG?x=1"), Some("jpg"));
        assert_eq!(extension_from_url("https://cdn.test/capa"), None);
        assert!(is_generic_type(Some("application/octet-stream")));
        assert!(is_generic_type(None));
        assert!(!is_generic_type(Some("text/html")));
    }
}
