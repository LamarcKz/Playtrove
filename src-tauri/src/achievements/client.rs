//! A API do RetroAchievements (https://api-docs.retroachievements.org). Cada pedido leva a Web API Key do
//! usuário (parâmetro `y`); chave errada volta como 401. Só leitura: quem desbloqueia as conquistas são os
//! emuladores.

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{DateTime, NaiveDateTime, Utc};
use serde_json::Value;

use crate::dates::iso;
use crate::i18n::{Language, text};
use crate::metadata::http::{Fetch, HttpRequest, MetadataError, form_encode, request};

/// Endereços da API e das imagens do RetroAchievements.
#[derive(Clone)]
pub struct RaEndpoints {
    pub api: String,
    pub media: String,
}

impl RaEndpoints {
    pub fn real() -> RaEndpoints {
        RaEndpoints { api: "https://retroachievements.org/API".into(), media: "https://media.retroachievements.org".into() }
    }

    /// Os mesmos serviços no servidor de mentira dos testes do app.
    pub fn test(base: &str) -> RaEndpoints {
        RaEndpoints { api: format!("{base}/ra/API"), media: format!("{base}/ra-media") }
    }
}

/// A conta do usuário: o nome e a Web API Key (de retroachievements.org → Configurações → Keys).
#[derive(Clone, Debug, PartialEq)]
pub struct RaAccount {
    pub username: String,
    pub api_key: String,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RaConsole {
    pub id: i64,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RaCatalogGame {
    pub id: i64,
    pub title: String,
    pub num_achievements: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RaAchievement {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub points: i64,
    pub badge_name: Option<String>,
    pub display_order: i64,
    /// Quantos jogadores desbloquearam (no modo normal ou no hardcore).
    pub num_awarded: i64,
    pub earned_at: Option<String>,
    pub earned_hardcore_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RaGameProgress {
    pub id: i64,
    pub title: String,
    pub num_distinct_players: i64,
    pub achievements: Vec<RaAchievement>,
}

/// O que a atualização usa do RetroAchievements (os testes passam um de mentira).
pub trait RaApi {
    /// Confere a conta (a chave e o nome).
    fn validate(&self) -> Result<(), MetadataError>;
    fn consoles(&self) -> Result<Vec<RaConsole>, MetadataError>;
    /// Os jogos com conquistas de um console (lista grande: o app guarda e só busca de novo de vez em quando).
    fn catalog(&self, console_id: i64) -> Result<Vec<RaCatalogGame>, MetadataError>;
    fn game_progress(&self, ra_game_id: i64) -> Result<RaGameProgress, MetadataError>;
    /// Os jogos das conquistas desbloqueadas nos últimos `minutes` minutos.
    fn recent_game_ids(&self, minutes: f64) -> Result<Vec<i64>, MetadataError>;
}

pub struct RaClient {
    fetch: Arc<dyn Fetch>,
    endpoints: RaEndpoints,
    account: RaAccount,
    language: Language,
}

impl RaClient {
    pub fn new(fetch: Arc<dyn Fetch>, endpoints: RaEndpoints, account: RaAccount, language: Language) -> RaClient {
        RaClient { fetch, endpoints, account, language }
    }

    fn error(&self, key: &str, values: &[&str]) -> String {
        text(self.language, &format!("errors.{key}"), values)
    }

    /// Faz um pedido à API. Com `missing_as_null`, "não encontrado" volta como None em vez de erro.
    fn get(&self, endpoint: &str, params: &[(&str, String)], missing_as_null: bool) -> Result<Option<Value>, MetadataError> {
        let mut query: Vec<String> = params.iter().map(|(name, value)| format!("{name}={}", form_encode(value))).collect();
        query.push(format!("y={}", form_encode(&self.account.api_key)));
        let url = format!("{}/{endpoint}.php?{}", self.endpoints.api, query.join("&"));
        let response = request(&*self.fetch, &HttpRequest::get(url), "RetroAchievements", self.language)?;
        if response.status == 401 || response.status == 403 {
            return Err(MetadataError::Stop(self.error("raWrongKey", &[])));
        }
        if response.status == 429 {
            return Err(MetadataError::Stop(self.error("raRateLimited", &[])));
        }
        // 404: não existe; 422: o nome nem é um nome de usuário válido lá.
        if missing_as_null && (response.status == 404 || response.status == 422) {
            return Ok(None);
        }
        if !response.ok() {
            return Err(MetadataError::Skip(self.error("raError", &[&response.status.to_string()])));
        }
        Ok(Some(response.json().unwrap_or(Value::Null)))
    }
}

impl RaApi for RaClient {
    fn validate(&self) -> Result<(), MetadataError> {
        let profile = self.get("API_GetUserProfile", &[("u", self.account.username.clone())], true)?;
        let found = profile.as_ref().and_then(|profile| profile.get("User")).is_some_and(|user| !user.is_null() && user != "");
        if !found {
            return Err(MetadataError::Skip(self.error("raUserNotFound", &[&self.account.username])));
        }
        Ok(())
    }

    fn consoles(&self) -> Result<Vec<RaConsole>, MetadataError> {
        let list = self.get("API_GetConsoleIDs", &[("a", "1".into()), ("g", "1".into())], false)?;
        Ok(objects(list).iter().map(|item| RaConsole { id: num(&item["ID"]), name: string(&item["Name"]) }).collect())
    }

    fn catalog(&self, console_id: i64) -> Result<Vec<RaCatalogGame>, MetadataError> {
        let list = self.get("API_GetGameList", &[("i", console_id.to_string()), ("f", "1".into())], false)?;
        Ok(objects(list)
            .iter()
            .map(|item| RaCatalogGame {
                id: num(&item["ID"]),
                title: string(&item["Title"]),
                num_achievements: num(&item["NumAchievements"]),
            })
            .collect())
    }

    fn game_progress(&self, ra_game_id: i64) -> Result<RaGameProgress, MetadataError> {
        let params = [("g", ra_game_id.to_string()), ("u", self.account.username.clone())];
        let game = self.get("API_GetGameInfoAndUserProgress", &params, false)?.unwrap_or(Value::Null);
        // "Achievements" vem como um objeto indexado pelo id (ou como lista vazia, sem conquistas).
        let achievements: Vec<&Value> = match &game["Achievements"] {
            Value::Object(map) => map.values().collect(),
            Value::Array(list) => list.iter().collect(),
            _ => Vec::new(),
        };
        let id = num(&game["ID"]);
        Ok(RaGameProgress {
            id: if id != 0 { id } else { ra_game_id },
            title: string(&game["Title"]),
            num_distinct_players: num(&game["NumDistinctPlayers"]),
            achievements: achievements
                .into_iter()
                .map(|item| RaAchievement {
                    id: num(&item["ID"]),
                    title: string(&item["Title"]),
                    description: string(&item["Description"]),
                    points: num(&item["Points"]),
                    badge_name: Some(string(&item["BadgeName"])).filter(|name| !name.is_empty()),
                    display_order: num(&item["DisplayOrder"]),
                    num_awarded: num(&item["NumAwarded"]),
                    earned_at: ra_date(&item["DateEarned"]),
                    earned_hardcore_at: ra_date(&item["DateEarnedHardcore"]),
                })
                .collect(),
        })
    }

    fn recent_game_ids(&self, minutes: f64) -> Result<Vec<i64>, MetadataError> {
        let minutes = minutes.round().max(1.0) as i64;
        let list = self.get(
            "API_GetUserRecentAchievements",
            &[("u", self.account.username.clone()), ("m", minutes.to_string())],
            false,
        )?;
        let mut ids: Vec<i64> = Vec::new();
        let mut seen = HashSet::new();
        for id in objects(list).iter().map(|item| num(&item["GameID"])).filter(|id| *id > 0) {
            if seen.insert(id) {
                ids.push(id);
            }
        }
        Ok(ids)
    }
}

fn objects(value: Option<Value>) -> Vec<Value> {
    match value {
        Some(Value::Array(list)) => list.into_iter().filter(Value::is_object).collect(),
        _ => Vec::new(),
    }
}

/// Um número como o Number() do JavaScript lê ("200" vira 200; qualquer coisa estranha, 0).
fn num(value: &Value) -> i64 {
    match value {
        Value::Number(number) => number.as_i64().or_else(|| number.as_f64().map(|float| float as i64)).unwrap_or(0),
        Value::String(text) => {
            text.trim().parse::<f64>().ok().filter(|number| number.is_finite()).map_or(0, |number| number as i64)
        }
        Value::Bool(flag) => i64::from(*flag),
        _ => 0,
    }
}

fn string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// As datas do RetroAchievements: "2023-12-27 16:04:50" (UTC, sem fuso) ou ISO com fuso. Devolve ISO, ou
/// None se não houver.
pub fn ra_date(value: &Value) -> Option<String> {
    let text = value.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(date) = DateTime::parse_from_rfc3339(text) {
        return Some(iso(date.with_timezone(&Utc)));
    }
    let naive = NaiveDateTime::parse_from_str(&text.replace('T', " "), "%Y-%m-%d %H:%M:%S%.f").ok()?;
    Some(iso(naive.and_utc()))
}

#[cfg(test)]
pub mod tests {
    use serde_json::json;

    use super::*;
    use crate::metadata::http::fake::{FakeFetch, json as json_response};

    /// Uma conquista para os testes.
    pub fn achievement(id: i64, title: &str, points: i64, num_awarded: i64, earned_at: Option<String>) -> RaAchievement {
        RaAchievement {
            id,
            title: title.into(),
            description: String::new(),
            points,
            badge_name: None,
            display_order: id,
            num_awarded,
            earned_at,
            earned_hardcore_at: None,
        }
    }

    fn client(fetch: Arc<FakeFetch>, username: &str) -> RaClient {
        let account = RaAccount { username: username.into(), api_key: "chave".into() };
        RaClient::new(
            fetch,
            RaEndpoints { api: "https://ra.test/API".into(), media: "https://ra.test/media".into() },
            account,
            Language::PtBr,
        )
    }

    #[test]
    fn le_o_progresso_de_um_jogo_e_as_datas_em_utc() {
        let fetch = Arc::new(FakeFetch::new(|_, _| {
            json_response(
                json!({
                    "ID": 77, "Title": "Salto Estelar", "NumDistinctPlayers": "200",
                    "Achievements": {
                        "5": { "ID": 5, "Title": "Primeiro salto", "Description": "Pule.", "Points": 5, "BadgeName": "1001", "DisplayOrder": 1, "NumAwarded": 150, "DateEarned": "2026-09-20 21:30:00" },
                        "6": { "ID": 6, "Title": "Chefe final", "Description": "Vença.", "Points": 25, "BadgeName": "1002", "DisplayOrder": 2, "NumAwarded": 6 }
                    }
                }),
                200,
            )
        }));
        let progress = client(Arc::clone(&fetch), "jogador").game_progress(77).unwrap();
        assert_eq!(fetch.urls()[0], "https://ra.test/API/API_GetGameInfoAndUserProgress.php?g=77&u=jogador&y=chave");
        assert_eq!((progress.id, progress.title.as_str(), progress.num_distinct_players), (77, "Salto Estelar", 200));
        let first = progress.achievements.iter().find(|item| item.id == 5).unwrap();
        assert_eq!((first.earned_at.as_deref(), first.earned_hardcore_at.clone()), (Some("2026-09-20T21:30:00.000Z"), None));
        assert_eq!(progress.achievements.iter().find(|item| item.id == 6).unwrap().earned_at, None);
    }

    #[test]
    fn chave_recusada_para_a_atualizacao_inteira() {
        let fetch = Arc::new(FakeFetch::new(|_, _| json_response(json!({ "message": "Unauthenticated." }), 401)));
        assert!(matches!(client(fetch, "a").consoles(), Err(MetadataError::Stop(_))));
    }

    #[test]
    fn usuario_que_nao_existe_nao_passa_na_conferencia() {
        let empty = Arc::new(FakeFetch::new(|_, _| json_response(json!({}), 200)));
        assert!(client(empty, "ninguem").validate().unwrap_err().to_string().contains("Não achei o usuário \"ninguem\""));
        let not_found = Arc::new(FakeFetch::new(|_, _| json_response(json!([]), 404)));
        assert!(client(not_found, "ninguem").validate().unwrap_err().to_string().contains("Não achei o usuário \"ninguem\""));
    }

    #[test]
    fn datas_com_e_sem_fuso() {
        assert_eq!(ra_date(&json!("2023-12-27 16:04:50")).as_deref(), Some("2023-12-27T16:04:50.000Z"));
        assert_eq!(ra_date(&json!("2023-10-27T02:52:34+00:00")).as_deref(), Some("2023-10-27T02:52:34.000Z"));
        assert_eq!(ra_date(&json!("")), None);
        assert_eq!(ra_date(&Value::Null), None);
    }
}
