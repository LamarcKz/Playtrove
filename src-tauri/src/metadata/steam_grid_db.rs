//! O SteamGridDB: capas e fundos feitos pela comunidade (os ícones não são usados: os de fãs variam
//! demais, e o ícone da lista é um pedaço da capa).

use std::collections::HashMap;
use std::sync::Arc;

use serde::Deserialize;
use serde::de::DeserializeOwned;

use super::http::{Fetch, HttpRequest, MetadataEndpoints, MetadataError, request};
use super::matching::Named;
use crate::i18n::{Language, text};
use crate::images::{ImageKind, encode_uri_component};

/// Um jogo encontrado no SteamGridDB.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct SteamGridDbGame {
    pub id: i64,
    pub name: String,
}

impl Named for SteamGridDbGame {
    fn name(&self) -> &str {
        &self.name
    }
}

/// O que buscar de cada tipo de imagem. Capa: as de retrato (600x900 e parecidas). Fundo: os "heroes",
/// as faixas largas do topo da página do jogo. Nada de imagens NSFW ou de humor.
const IMAGE_QUERIES: [(ImageKind, &str); 2] = [
    (ImageKind::Cover, "grids/game/{id}?dimensions=600x900,342x482,660x930&types=static&nsfw=false&humor=false"),
    (ImageKind::Background, "heroes/game/{id}?types=static&nsfw=false&humor=false"),
];

#[derive(Deserialize)]
struct Envelope<T> {
    success: bool,
    data: Option<T>,
    #[serde(default)]
    errors: Vec<String>,
}

#[derive(Deserialize)]
struct ImageResponse {
    url: Option<String>,
}

/// Conexão com o SteamGridDB.
pub struct SteamGridDbSession {
    fetch: Arc<dyn Fetch>,
    endpoints: MetadataEndpoints,
    api_key: String,
    language: Language,
}

impl SteamGridDbSession {
    pub fn new(fetch: Arc<dyn Fetch>, endpoints: MetadataEndpoints, api_key: String, language: Language) -> SteamGridDbSession {
        SteamGridDbSession { fetch, endpoints, api_key, language }
    }

    /// Confere a chave (faz uma busca de teste).
    pub fn validate(&self) -> Result<(), MetadataError> {
        self.search("mario").map(|_| ())
    }

    /// Procura jogos pelo nome. Os mais relevantes vêm primeiro.
    pub fn search(&self, term: &str) -> Result<Vec<SteamGridDbGame>, MetadataError> {
        Ok(self.get(&format!("search/autocomplete/{}", encode_uri_component(term)))?.unwrap_or_default())
    }

    /// Endereços da capa e do fundo mais votados do jogo (os que não existem ficam de fora).
    pub fn images(&self, game_id: i64) -> Result<HashMap<ImageKind, String>, MetadataError> {
        let mut found = HashMap::new();
        for (kind, query) in IMAGE_QUERIES {
            let images: Option<Vec<ImageResponse>> = self.get(&query.replace("{id}", &game_id.to_string()))?;
            if let Some(url) = images.unwrap_or_default().into_iter().find_map(|image| image.url) {
                found.insert(kind, url);
            }
        }
        Ok(found)
    }

    fn get<T: DeserializeOwned>(&self, path: &str) -> Result<Option<T>, MetadataError> {
        let error = |key: &str, values: &[&str]| text(self.language, &format!("errors.{key}"), values);
        let request_data = HttpRequest::get(format!("{}/{path}", self.endpoints.steam_grid_db))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Accept", "application/json".into());
        let response = request(&*self.fetch, &request_data, "SteamGridDB", self.language)?;
        if response.status == 401 || response.status == 403 {
            return Err(MetadataError::Stop(error("steamGridDbWrongKey", &[])));
        }
        // 404: o jogo não tem imagens desse tipo.
        if response.status == 404 {
            return Ok(None);
        }
        if !response.ok() {
            return Err(MetadataError::Skip(error("steamGridDbError", &[&response.status.to_string()])));
        }
        let body: Envelope<T> = response.json().ok_or_else(|| MetadataError::Skip(error("steamGridDbRefused", &[])))?;
        if !body.success {
            let message = if body.errors.is_empty() { error("steamGridDbRefused", &[]) } else { body.errors.join(" ") };
            return Err(MetadataError::Skip(message));
        }
        Ok(body.data)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::http::fake::{FakeFetch, json as json_response};
    use super::*;

    fn session(fetch: Arc<FakeFetch>, key: &str) -> SteamGridDbSession {
        SteamGridDbSession::new(fetch, MetadataEndpoints::test("https://servidor"), key.into(), Language::PtBr)
    }

    #[test]
    fn busca_com_a_chave_e_pega_a_imagem_mais_votada_de_cada_tipo() {
        let fetch = Arc::new(FakeFetch::new(|url, _| match url.path() {
            "/sgdb/search/autocomplete/Salto%20Estelar" => {
                json_response(json!({ "success": true, "data": [{ "id": 55, "name": "Salto Estelar" }] }), 200)
            }
            "/sgdb/grids/game/55" => {
                json_response(json!({ "success": true, "data": [{ "url": "https://cdn.test/capa.png" }] }), 200)
            }
            _ => json_response(json!({ "success": false }), 404),
        }));
        let sgdb = session(Arc::clone(&fetch), "chave-certa");
        assert_eq!(sgdb.search("Salto Estelar").unwrap(), [SteamGridDbGame { id: 55, name: "Salto Estelar".into() }]);
        let calls = fetch.calls.lock().unwrap().clone();
        assert_eq!(calls[0].url, "https://servidor/sgdb/search/autocomplete/Salto%20Estelar");
        assert!(calls[0].headers.contains(&("Authorization", "Bearer chave-certa".into())));

        // Sem fundo (404): só a capa.
        assert_eq!(sgdb.images(55).unwrap(), HashMap::from([(ImageKind::Cover, "https://cdn.test/capa.png".to_string())]));
        assert!(fetch.urls()[1].contains("/sgdb/grids/game/55?dimensions=600x900"));
    }

    #[test]
    fn chave_errada_para_tudo() {
        let fetch = Arc::new(FakeFetch::new(|_, _| json_response(json!({ "success": false }), 401)));
        assert_eq!(
            session(fetch, "chave-errada").validate(),
            Err(MetadataError::Stop("A chave do SteamGridDB está errada.".into()))
        );
    }
}
