//! O IGDB: descrição, gêneros, desenvolvedora, publicadora, lançamento, capa e artes de cada jogo. Ele usa
//! as contas de desenvolvedor da Twitch (Client ID e Client Secret).

use std::cmp::Ordering;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use chrono::DateTime;
use serde::Deserialize;

use super::http::{Fetch, HttpRequest, MetadataEndpoints, MetadataError, form_encode, request};
use super::matching::{Named, comparable_name};
use crate::i18n::{Language, text};

/// Client ID e Client Secret de um aplicativo da Twitch.
#[derive(Clone, Debug, PartialEq)]
pub struct IgdbCredentials {
    pub client_id: String,
    pub client_secret: String,
}

/// Um jogo encontrado no IGDB, só com o que o app usa.
#[derive(Clone, Debug, PartialEq)]
pub struct IgdbGame {
    pub id: i64,
    pub name: String,
    pub summary: Option<String>,
    /// AAAA-MM-DD.
    pub release_date: Option<String>,
    /// Os gêneros como o IGDB escreve, em inglês (a tela mostra no idioma do app).
    pub genres: Vec<String>,
    pub developers: Vec<String>,
    pub publishers: Vec<String>,
    pub cover_image_id: Option<String>,
    /// Artes oficiais e telas do jogo, para o fundo (as artes primeiro).
    pub background_image_ids: Vec<String>,
    /// Id de vídeo do YouTube, preferindo um trailer quando houver mais de uma opção.
    pub trailer_video_id: Option<String>,
    /// Não é o jogo em si, mas algo feito em cima dele: um hack, mod, DLC, pacote ou coletânea.
    pub derivative: bool,
}

impl Named for IgdbGame {
    fn name(&self) -> &str {
        &self.name
    }
}

/// Ids das plataformas no IGDB, pelo nome do console usado nas pastas de ROMs (e alguns apelidos).
const IGDB_PLATFORMS: [(&str, i64); 32] = [
    ("playstation", 7),
    ("ps1", 7),
    ("psx", 7),
    ("playstation 2", 8),
    ("ps2", 8),
    ("playstation 3", 9),
    ("ps3", 9),
    ("playstation portable", 38),
    ("psp", 38),
    ("nintendo ds", 20),
    ("nds", 20),
    ("ds", 20),
    ("game boy advance", 24),
    ("gba", 24),
    ("game boy", 33),
    ("gb", 33),
    ("game boy color", 22),
    ("gbc", 22),
    ("super nintendo", 19),
    ("snes", 19),
    ("nes", 18),
    ("nintendo 64", 4),
    ("n64", 4),
    ("gamecube", 21),
    ("gc", 21),
    ("ngc", 21),
    ("wii", 5),
    ("nintendo 3ds", 37),
    ("3ds", 37),
    ("mega drive", 29),
    ("genesis", 29),
    ("sega genesis", 29),
];

/// Id da plataforma no IGDB para o console do jogo, ou None se ele não for conhecido.
pub fn igdb_platform_id(platform: Option<&str>) -> Option<i64> {
    let name = comparable_name(platform?);
    IGDB_PLATFORMS.iter().find(|(known, _)| *known == name).map(|(_, id)| *id)
}

/// Campos pedidos ao IGDB em cada busca.
const FIELDS: &str = "name,summary,first_release_date,genres.name,involved_companies.company.name,involved_companies.developer,\
involved_companies.publisher,cover.image_id,artworks.image_id,screenshots.image_id,game_type,videos.name,videos.video_id";

/// Tipos de jogo do IGDB (campo game_type) que não são o jogo em si: DLC (1), expansão (2), coletânea
/// (3), mod (5, onde ficam os ROM hacks), fork (12), pacote (13) e atualização (14).
const DERIVATIVE_TYPES: [i64; 7] = [1, 2, 3, 5, 12, 13, 14];

/// Um jogo como o IGDB devolve (só os campos pedidos; todos podem faltar).
#[derive(Deserialize)]
struct GameResponse {
    id: i64,
    name: String,
    summary: Option<String>,
    first_release_date: Option<i64>,
    #[serde(default)]
    genres: Vec<NameResponse>,
    #[serde(default)]
    involved_companies: Vec<CompanyResponse>,
    cover: Option<ImageResponse>,
    #[serde(default)]
    artworks: Vec<ImageResponse>,
    #[serde(default)]
    screenshots: Vec<ImageResponse>,
    #[serde(default)]
    videos: Vec<VideoResponse>,
    game_type: Option<i64>,
}

#[derive(Deserialize)]
struct VideoResponse {
    name: Option<String>,
    video_id: Option<String>,
}

#[derive(Deserialize)]
struct NameResponse {
    name: Option<String>,
}

#[derive(Deserialize)]
struct CompanyResponse {
    company: Option<NameResponse>,
    #[serde(default)]
    developer: bool,
    #[serde(default)]
    publisher: bool,
}

#[derive(Deserialize)]
struct ImageResponse {
    image_id: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
}

/// Conexão com o IGDB. Guarda o token de acesso enquanto ele vale (uns 60 dias).
pub struct IgdbSession {
    fetch: Arc<dyn Fetch>,
    endpoints: MetadataEndpoints,
    credentials: IgdbCredentials,
    language: Language,
    token: Mutex<Option<(String, Instant)>>,
}

impl IgdbSession {
    pub fn new(
        fetch: Arc<dyn Fetch>,
        endpoints: MetadataEndpoints,
        credentials: IgdbCredentials,
        language: Language,
    ) -> IgdbSession {
        IgdbSession { fetch, endpoints, credentials, language, token: Mutex::new(None) }
    }

    /// As chaves desta conexão (para saber se ela ainda serve depois de o usuário trocar as chaves).
    pub fn credentials(&self) -> &IgdbCredentials {
        &self.credentials
    }

    /// Confere o Client ID e o Client Secret (pede um token novo).
    pub fn validate(&self) -> Result<(), MetadataError> {
        self.token(true).map(|_| ())
    }

    /// Procura jogos pelo nome, só na plataforma dada (se houver). Os mais relevantes vêm primeiro.
    pub fn search(&self, term: &str, platform_id: Option<i64>) -> Result<Vec<IgdbGame>, MetadataError> {
        let escaped = term.replace('\\', "\\\\").replace('"', "\\\"");
        let filter = platform_id.map(|id| format!(" where platforms = ({id});")).unwrap_or_default();
        let results = self.query(&format!("search \"{escaped}\"; fields {FIELDS};{filter} limit 10;"), true)?;
        Ok(results.into_iter().map(to_igdb_game).collect())
    }

    fn error(&self, key: &str, values: &[&str]) -> String {
        text(self.language, &format!("errors.{key}"), values)
    }

    fn token(&self, renew: bool) -> Result<String, MetadataError> {
        let mut saved = self.token.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some((token, expires_at)) = saved.as_ref()
            && !renew
            && Instant::now() < *expires_at
        {
            return Ok(token.clone());
        }
        let url = format!(
            "{}?client_id={}&client_secret={}&grant_type=client_credentials",
            self.endpoints.twitch_token,
            form_encode(&self.credentials.client_id),
            form_encode(&self.credentials.client_secret),
        );
        let response = request(&*self.fetch, &HttpRequest::post(url, None), "IGDB", self.language)?;
        if (400..500).contains(&response.status) {
            return Err(MetadataError::Stop(self.error("igdbWrongKeys", &[])));
        }
        if !response.ok() {
            return Err(MetadataError::Skip(self.error("twitchError", &[&response.status.to_string()])));
        }
        let body: TokenResponse = response.json().ok_or_else(|| MetadataError::Skip(self.error("igdbNoToken", &[])))?;
        let token = body.access_token.ok_or_else(|| MetadataError::Skip(self.error("igdbNoToken", &[])))?;
        // Renova um minuto antes de vencer.
        let lifetime = Duration::from_secs(body.expires_in.unwrap_or(3600).saturating_sub(60));
        *saved = Some((token.clone(), Instant::now() + lifetime));
        Ok(token)
    }

    fn query(&self, body: &str, retry: bool) -> Result<Vec<GameResponse>, MetadataError> {
        let token = self.token(false)?;
        let request_data = HttpRequest::post(format!("{}/games", self.endpoints.igdb), Some(body.to_string()))
            .header("Client-ID", self.credentials.client_id.clone())
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/json".into());
        let response = request(&*self.fetch, &request_data, "IGDB", self.language)?;
        // Token vencido ou revogado: pede outro e tenta mais uma vez.
        if response.status == 401 && retry {
            *self.token.lock().unwrap_or_else(PoisonError::into_inner) = None;
            return self.query(body, false);
        }
        if response.status == 401 || response.status == 403 {
            return Err(MetadataError::Stop(self.error("igdbRefused", &[])));
        }
        if !response.ok() {
            return Err(MetadataError::Skip(self.error("igdbError", &[&response.status.to_string()])));
        }
        Ok(response.json().unwrap_or_default())
    }
}

/// Desempate entre resultados do IGDB com o nome igualmente parecido (Less: `a` fica): o jogo em si
/// antes de um hack ou DLC dele e, depois, o lançado primeiro. Ex.: "Chrono Trigger" e o hack "Chrono
/// Trigger+" comparam igual, e o IGDB pode devolver o hack antes.
pub fn prefer_original(a: &IgdbGame, b: &IgdbGame) -> Ordering {
    if a.derivative != b.derivative {
        return if a.derivative { Ordering::Greater } else { Ordering::Less };
    }
    // Sem data, fica por último.
    a.release_date.as_deref().unwrap_or("9999").cmp(b.release_date.as_deref().unwrap_or("9999"))
}

/// Endereço de uma imagem do IGDB, no tamanho pedido (ex.: "t_cover_big", "t_1080p").
pub fn igdb_image_url(endpoints: &MetadataEndpoints, size: &str, image_id: &str) -> String {
    format!("{}/{size}/{image_id}.jpg", endpoints.igdb_images)
}

fn to_igdb_game(game: GameResponse) -> IgdbGame {
    let names_of = |developer: bool| {
        unique(
            game.involved_companies
                .iter()
                .filter(|item| if developer { item.developer } else { item.publisher })
                .map(|item| item.company.as_ref().and_then(|company| company.name.clone())),
        )
    };
    let image_ids = |images: &[ImageResponse]| unique(images.iter().map(|image| image.image_id.clone()));
    let mut videos: Vec<_> = game.videos.iter().filter(|video| video.video_id.as_deref().is_some_and(valid_youtube_id)).collect();
    videos.sort_by_key(|video| !video.name.as_deref().unwrap_or_default().to_ascii_lowercase().contains("trailer"));
    IgdbGame {
        id: game.id,
        summary: game.summary.as_deref().map(str::trim).filter(|summary| !summary.is_empty()).map(str::to_string),
        release_date: game
            .first_release_date
            .filter(|seconds| *seconds != 0)
            .and_then(|seconds| DateTime::from_timestamp(seconds, 0))
            .map(|date| date.format("%Y-%m-%d").to_string()),
        genres: unique(game.genres.iter().map(|genre| genre.name.clone())),
        developers: names_of(true),
        publishers: names_of(false),
        cover_image_id: game.cover.as_ref().and_then(|cover| cover.image_id.clone()),
        background_image_ids: [image_ids(&game.artworks), image_ids(&game.screenshots)].concat(),
        trailer_video_id: videos.first().and_then(|video| video.video_id.clone()),
        derivative: game.game_type.is_some_and(|kind| DERIVATIVE_TYPES.contains(&kind)),
        name: game.name,
    }
}

/// Apenas o id do YouTube, nunca um endereço ou argumento para o downloader.
fn valid_youtube_id(id: &str) -> bool {
    id.len() == 11 && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// Tira os vazios e os repetidos, mantendo a ordem.
fn unique(values: impl Iterator<Item = Option<String>>) -> Vec<String> {
    let mut list: Vec<String> = Vec::new();
    for value in values.flatten() {
        if !value.is_empty() && !list.contains(&value) {
            list.push(value);
        }
    }
    list
}

#[cfg(test)]
pub mod tests {
    use serde_json::json;

    use super::super::http::fake::{FakeFetch, json as json_response};
    use super::super::matching::pick_best_match;
    use super::*;

    pub fn endpoints() -> MetadataEndpoints {
        MetadataEndpoints::test("https://servidor")
    }

    pub fn credentials() -> IgdbCredentials {
        IgdbCredentials { client_id: "id-certo".into(), client_secret: "segredo-certo".into() }
    }

    /// Um jogo como o IGDB devolve.
    pub fn salto_estelar() -> serde_json::Value {
        json!({
            "id": 1234,
            "name": "Salto Estelar",
            "summary": "A aventura continua.",
            "first_release_date": 1066089600,
            "genres": [{ "name": "Platform" }, { "name": "Adventure" }, { "name": "Gênero Novo" }],
            "involved_companies": [
                { "company": { "name": "Estúdio Aurora" }, "developer": true, "publisher": false },
                { "company": { "name": "Editora Meridiano" }, "developer": false, "publisher": true },
                { "company": { "name": "Editora Meridiano" }, "developer": false, "publisher": true }
            ],
            "cover": { "image_id": "co1abc" },
            "artworks": [{ "image_id": "ar1" }],
            "screenshots": [{ "image_id": "sc1" }]
        })
    }

    fn session(fetch: Arc<FakeFetch>) -> IgdbSession {
        IgdbSession::new(fetch, endpoints(), credentials(), Language::PtBr)
    }

    fn igdb_world(games: impl Fn(&str) -> serde_json::Value + Send + Sync + 'static) -> Arc<FakeFetch> {
        Arc::new(FakeFetch::new(move |url, request| match url.path() {
            "/twitch/token" => json_response(json!({ "access_token": "token-1", "expires_in": 5_000_000 }), 200),
            "/igdb/games" => json_response(games(request.body.as_deref().unwrap_or_default()), 200),
            _ => json_response(json!({}), 404),
        }))
    }

    #[test]
    fn pede_o_token_busca_so_na_plataforma_e_guarda_os_generos_como_o_igdb_escreve() {
        let fetch = igdb_world(|body| if body.contains("\"Salto Estelar\"") { json!([salto_estelar()]) } else { json!([]) });
        let igdb = session(Arc::clone(&fetch));
        let game = igdb.search("Salto Estelar", Some(8)).unwrap().remove(0);

        let calls = fetch.calls.lock().unwrap().clone();
        assert_eq!(
            calls[0].url,
            "https://servidor/twitch/token?client_id=id-certo&client_secret=segredo-certo&grant_type=client_credentials"
        );
        assert!(calls[1].headers.contains(&("Client-ID", "id-certo".into())));
        assert!(calls[1].headers.contains(&("Authorization", "Bearer token-1".into())));
        let body = calls[1].body.clone().unwrap();
        assert!(body.contains("search \"Salto Estelar\";"));
        assert!(body.contains("where platforms = (8);"));
        assert!(body.contains("game_type"));
        assert_eq!(
            game,
            IgdbGame {
                id: 1234,
                name: "Salto Estelar".into(),
                summary: Some("A aventura continua.".into()),
                release_date: Some("2003-10-14".into()),
                genres: vec!["Platform".into(), "Adventure".into(), "Gênero Novo".into()],
                developers: vec!["Estúdio Aurora".into()],
                publishers: vec!["Editora Meridiano".into()],
                cover_image_id: Some("co1abc".into()),
                background_image_ids: vec!["ar1".into(), "sc1".into()],
                trailer_video_id: None,
                derivative: false,
            }
        );

        // O token é reaproveitado na busca seguinte.
        igdb.search("Outro", None).unwrap();
        let calls = fetch.calls.lock().unwrap().clone();
        assert_eq!(calls.iter().filter(|call| call.url.contains("/twitch/token")).count(), 1);
        assert!(!calls[2].body.clone().unwrap().contains("where"));
    }

    #[test]
    fn aspas_no_nome_nao_quebram_a_busca() {
        let fetch = igdb_world(|_| json!([]));
        session(Arc::clone(&fetch)).search("Diga \"Olá\"", None).unwrap();
        assert!(fetch.calls.lock().unwrap()[1].body.clone().unwrap().contains("search \"Diga \\\"Olá\\\"\";"));
    }

    #[test]
    fn token_vencido_pede_outro_e_tenta_de_novo() {
        let first = Mutex::new(true);
        let fetch = Arc::new(FakeFetch::new(move |url, _| match url.path() {
            "/twitch/token" => json_response(json!({ "access_token": "token", "expires_in": 5_000_000 }), 200),
            _ if std::mem::replace(&mut *first.lock().unwrap(), false) => {
                json_response(json!({ "message": "Authorization Failure" }), 401)
            }
            _ => json_response(json!([salto_estelar()]), 200),
        }));
        assert_eq!(session(Arc::clone(&fetch)).search("Salto Estelar", None).unwrap().len(), 1);
        assert_eq!(fetch.urls().iter().filter(|url| url.contains("/twitch/token")).count(), 2);
    }

    #[test]
    fn chaves_erradas_e_falta_de_internet_param_tudo() {
        let wrong = Arc::new(FakeFetch::new(|_, _| json_response(json!({ "message": "invalid client" }), 400)));
        assert_eq!(
            session(wrong).validate(),
            Err(MetadataError::Stop("O Client ID ou o Client Secret do IGDB estão errados.".into()))
        );

        let offline = Arc::new(FakeFetch::new(|_, _| Err("sem conexão".into())));
        assert_eq!(
            session(offline).search("Salto Estelar", None).unwrap_err(),
            MetadataError::Stop("Não deu para falar com o IGDB. Confira a conexão com a internet.".into())
        );
    }

    #[test]
    fn escolhe_trailer_antes_de_outros_videos_e_rejeita_ids_que_nao_sao_do_youtube() {
        let fetch = igdb_world(|_| {
            let mut game = salto_estelar();
            game["videos"] = json!([
                { "name": "Gameplay", "video_id": "Gameplay01A" },
                { "name": "Trailer inválido", "video_id": "https://fora" },
                { "name": "Official Launch TRAILER", "video_id": "Trailer001A" }
            ]);
            json!([game])
        });
        assert_eq!(session(fetch).search("Salto Estelar", None).unwrap()[0].trailer_video_id.as_deref(), Some("Trailer001A"));
        let fetch = igdb_world(|_| {
            let mut game = salto_estelar();
            game["videos"] =
                json!([{ "video_id": "curto" }, { "video_id": "../arquivo!" }, { "name": "Outro", "video_id": "Gameplay01A" }]);
            json!([game])
        });
        assert_eq!(session(fetch).search("Salto Estelar", None).unwrap()[0].trailer_video_id.as_deref(), Some("Gameplay01A"));
    }

    fn game(name: &str, release_date: Option<&str>, derivative: bool) -> IgdbGame {
        IgdbGame {
            id: 0,
            name: name.into(),
            summary: None,
            release_date: release_date.map(str::to_string),
            genres: vec![],
            developers: vec![],
            publishers: vec![],
            cover_image_id: None,
            background_image_ids: vec![],
            trailer_video_id: None,
            derivative,
        }
    }

    #[test]
    fn no_empate_do_nome_fica_o_jogo_original() {
        let pick =
            |term: &str, results: Vec<IgdbGame>| pick_best_match(term, results, Some(prefer_original)).map(|game| game.name);
        let original = game("Lenda Sombria", Some("1995-03-11"), false);
        // "Lenda Sombria+" compara igual a "Lenda Sombria", e o IGDB devolve o hack primeiro.
        assert_eq!(
            pick("Lenda Sombria", vec![game("Lenda Sombria+", Some("2024-07-08"), true), original.clone()]).as_deref(),
            Some("Lenda Sombria")
        );
        // Sem o tipo no IGDB, vale o lançado primeiro (os sem data ficam por último).
        let unmarked = game("Lenda Sombria+", Some("2024-07-08"), false);
        assert_eq!(pick("Lenda Sombria", vec![unmarked, original.clone()]).unwrap(), "Lenda Sombria");
        let undated = game("Lenda Sombria", None, false);
        let picked = pick_best_match("Lenda Sombria", vec![undated, original.clone()], Some(prefer_original)).unwrap();
        assert_eq!(picked.release_date.as_deref(), Some("1995-03-11"));
        // Um nome mais parecido continua ganhando, mesmo sendo de um hack.
        assert_eq!(
            pick("Lenda Sombria Redux", vec![original, game("Lenda Sombria Redux", Some("2024-07-08"), true)]).as_deref(),
            Some("Lenda Sombria Redux")
        );
    }

    #[test]
    fn o_tipo_do_jogo_diz_se_e_um_hack_mod_ou_dlc() {
        let fetch = igdb_world(|_| {
            let mut hack = salto_estelar();
            hack["game_type"] = json!(5);
            let mut main = salto_estelar();
            main["game_type"] = json!(0);
            json!([hack, main, salto_estelar()])
        });
        let results = session(fetch).search("Salto Estelar", None).unwrap();
        assert_eq!(results.iter().map(|game| game.derivative).collect::<Vec<_>>(), [true, false, false]);
    }

    #[test]
    fn plataformas_do_igdb_pelo_nome_do_console() {
        assert_eq!(igdb_platform_id(Some("PlayStation 2")), Some(8));
        assert_eq!(igdb_platform_id(Some("ps2")), Some(8));
        assert_eq!(igdb_platform_id(Some("PlayStation")), Some(7));
        assert_eq!(igdb_platform_id(Some("Nintendo DS")), Some(20));
        assert_eq!(igdb_platform_id(Some("Game Boy Advance")), Some(24));
        assert_eq!(igdb_platform_id(Some("Atari 2600")), None);
        assert_eq!(igdb_platform_id(None), None);
    }
}
