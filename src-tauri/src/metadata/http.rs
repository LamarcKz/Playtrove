//! Os pedidos pela internet dos serviços de metadados. Cada serviço recebe quem faz os pedidos (`Fetch`):
//! no app, o `HttpClient`; nos testes, uma internet de mentira.

use std::fmt;
use std::time::Duration;

use serde::de::DeserializeOwned;

use crate::i18n::{Language, text};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Method {
    Get,
    Post,
}

/// Um pedido.
#[derive(Clone, Debug)]
pub struct HttpRequest {
    pub method: Method,
    pub url: String,
    pub headers: Vec<(&'static str, String)>,
    pub body: Option<String>,
}

impl HttpRequest {
    pub fn get(url: String) -> HttpRequest {
        HttpRequest { method: Method::Get, url, headers: Vec::new(), body: None }
    }

    pub fn post(url: String, body: Option<String>) -> HttpRequest {
        HttpRequest { method: Method::Post, url, headers: Vec::new(), body }
    }

    pub fn header(mut self, name: &'static str, value: String) -> HttpRequest {
        self.headers.push((name, value));
        self
    }
}

/// Uma resposta (o corpo inteiro).
pub struct HttpResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

impl HttpResponse {
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn json<T: DeserializeOwned>(&self) -> Option<T> {
        serde_json::from_slice(&self.body).ok()
    }
}

/// Quem faz os pedidos. O erro é a falta de conexão (o servidor nem respondeu).
pub trait Fetch: Send + Sync {
    fn fetch(&self, request: &HttpRequest) -> Result<HttpResponse, String>;
}

/// Maior resposta aceita: as imagens têm até uns 5 MB, e nada passa de 20 MB.
pub const MAX_RESPONSE_BYTES: u64 = 20 * 1024 * 1024;

/// Os pedidos de verdade, pela internet.
pub struct HttpClient(ureq::Agent);

impl HttpClient {
    pub fn new() -> HttpClient {
        let config = ureq::Agent::config_builder()
            // As respostas de erro (ex.: 401 de uma chave errada) voltam como resposta, e não como falha.
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(60)))
            .user_agent(concat!("Playtrove/", env!("CARGO_PKG_VERSION")))
            .build();
        HttpClient(config.into())
    }
}

impl Fetch for HttpClient {
    fn fetch(&self, request: &HttpRequest) -> Result<HttpResponse, String> {
        let result = match request.method {
            Method::Get => {
                let mut builder = self.0.get(&request.url);
                for (name, value) in &request.headers {
                    builder = builder.header(*name, value);
                }
                builder.call()
            }
            Method::Post => {
                let mut builder = self.0.post(&request.url);
                for (name, value) in &request.headers {
                    builder = builder.header(*name, value);
                }
                match &request.body {
                    Some(body) => builder.send(body.as_str()),
                    None => builder.send_empty(),
                }
            }
        };
        let mut response = result.map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        let content_type = response.headers().get("content-type").and_then(|value| value.to_str().ok()).map(str::to_string);
        // Uma resposta grande demais vem vazia (a imagem é recusada depois).
        let body = response.body_mut().with_config().limit(MAX_RESPONSE_BYTES + 1).read_to_vec().unwrap_or_default();
        Ok(HttpResponse { status, content_type, body })
    }
}

/// Endereços dos serviços de metadados.
#[derive(Clone)]
pub struct MetadataEndpoints {
    /// Token de acesso da Twitch (o IGDB usa as contas de desenvolvedor da Twitch).
    pub twitch_token: String,
    pub igdb: String,
    /// Imagens do IGDB (capas, artes e telas do jogo).
    pub igdb_images: String,
    pub steam_grid_db: String,
    /// Capas oficiais do RetroArch (libretro-thumbnails).
    pub libretro_thumbnails: String,
}

impl MetadataEndpoints {
    pub fn real() -> MetadataEndpoints {
        MetadataEndpoints {
            twitch_token: "https://id.twitch.tv/oauth2/token".into(),
            igdb: "https://api.igdb.com/v4".into(),
            igdb_images: "https://images.igdb.com/igdb/image/upload".into(),
            steam_grid_db: "https://www.steamgriddb.com/api/v2".into(),
            libretro_thumbnails: "https://thumbnails.libretro.com".into(),
        }
    }

    /// Os mesmos serviços num servidor de mentira, para os testes do app não dependerem da internet.
    pub fn test(base: &str) -> MetadataEndpoints {
        MetadataEndpoints {
            twitch_token: format!("{base}/twitch/token"),
            igdb: format!("{base}/igdb"),
            igdb_images: format!("{base}/igdb-images"),
            steam_grid_db: format!("{base}/sgdb"),
            libretro_thumbnails: format!("{base}/libretro"),
        }
    }
}

/// Um problema num download de metadados.
#[derive(Debug, PartialEq)]
pub enum MetadataError {
    /// Para a leva inteira (chave errada, sem internet): todos os jogos falhariam do mesmo jeito.
    Stop(String),
    /// Pula só aquele jogo.
    Skip(String),
}

impl fmt::Display for MetadataError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MetadataError::Stop(message) | MetadataError::Skip(message) => formatter.write_str(message),
        }
    }
}

/// Um valor no formato dos formulários (o URLSearchParams do JavaScript: espaço vira "+").
pub fn form_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => char::from(byte).to_string(),
            b' ' => "+".to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// Faz um pedido. Sem conexão, o erro vira uma mensagem clara (e para a leva).
pub fn request(
    fetch: &dyn Fetch,
    request: &HttpRequest,
    service: &str,
    language: Language,
) -> Result<HttpResponse, MetadataError> {
    fetch.fetch(request).map_err(|_| MetadataError::Stop(text(language, "errors.noConnection", &[service])))
}

#[cfg(test)]
pub mod fake {
    //! Uma internet de mentira para os testes: cada pedido vai para `route`, que devolve a resposta (ou
    //! um erro, como sem conexão), e os pedidos ficam guardados.

    use std::sync::Mutex;

    use super::*;

    type Route = Box<dyn Fn(&tauri::Url, &HttpRequest) -> Result<HttpResponse, String> + Send + Sync>;

    pub struct FakeFetch {
        route: Route,
        pub calls: Mutex<Vec<HttpRequest>>,
    }

    impl FakeFetch {
        pub fn new(
            route: impl Fn(&tauri::Url, &HttpRequest) -> Result<HttpResponse, String> + Send + Sync + 'static,
        ) -> FakeFetch {
            FakeFetch { route: Box::new(route), calls: Mutex::new(Vec::new()) }
        }

        pub fn urls(&self) -> Vec<String> {
            self.calls.lock().unwrap().iter().map(|call| call.url.clone()).collect()
        }
    }

    impl Fetch for FakeFetch {
        fn fetch(&self, request: &HttpRequest) -> Result<HttpResponse, String> {
            self.calls.lock().unwrap().push(request.clone());
            (self.route)(&tauri::Url::parse(&request.url).expect("endereço inválido no teste"), request)
        }
    }

    pub fn json(data: serde_json::Value, status: u16) -> Result<HttpResponse, String> {
        Ok(HttpResponse { status, content_type: Some("application/json".into()), body: data.to_string().into_bytes() })
    }

    /// Uma imagem PNG de mentira (só o começo do arquivo), com o tipo dado.
    pub fn image(content_type: &str) -> Result<HttpResponse, String> {
        Ok(HttpResponse {
            status: 200,
            content_type: Some(content_type.into()),
            body: vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13],
        })
    }

    pub fn not_found() -> Result<HttpResponse, String> {
        Ok(HttpResponse { status: 404, content_type: Some("text/plain".into()), body: b"nao achei".to_vec() })
    }
}
