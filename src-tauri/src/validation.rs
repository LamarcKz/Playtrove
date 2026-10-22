//! Confere o que vem da interface antes de usar (nunca confiar cegamente na tela). Os comandos recebem
//! os valores crus (JSON) e passam por aqui.

use serde_json::Value;

use crate::achievements::client::RaAccount;
use crate::emulators::EmulatorId;
use crate::errors::{AppError, AppResult};
use crate::i18n::Language;
use crate::library::GameEvaluation;
use crate::metadata::igdb::IgdbCredentials;

/// O valor mais alto da nota e da dificuldade (cinco ícones inteiros; cada ponto vale meio ícone).
const SCORE_MAX: i64 = 10;

/// Tamanho máximo da análise, em caracteres (os do JavaScript, como a tela conta).
const MAX_REVIEW_LENGTH: usize = 10_000;

/// Um id: número inteiro positivo.
pub fn to_id(value: &Value, language: Language) -> AppResult<i64> {
    value.as_i64().filter(|id| *id > 0).ok_or_else(|| AppError::text(language, "errors.invalidId", &[]))
}

/// Um texto.
pub fn to_text(value: &Value, language: Language) -> AppResult<String> {
    value.as_str().map(str::to_string).ok_or_else(|| AppError::text(language, "errors.invalidText", &[]))
}

/// Sim ou não.
pub fn to_bool(value: &Value, language: Language) -> AppResult<bool> {
    value.as_bool().ok_or_else(|| AppError::text(language, "errors.invalidValue", &[]))
}

/// Um id ou nada (null = todos, ex.: procurar em todas as pastas).
pub fn to_optional_id(value: &Value, language: Language) -> AppResult<Option<i64>> {
    if value.is_null() { Ok(None) } else { to_id(value, language).map(Some) }
}

/// Um dos emuladores que o app conhece.
pub fn to_emulator_id(value: &Value, language: Language) -> AppResult<EmulatorId> {
    value.as_str().and_then(EmulatorId::from_id).ok_or_else(|| AppError::text(language, "errors.unknownEmulator", &[]))
}

/// Uma pasta de ROMs nova: o caminho, o emulador, o core (só no RetroArch; null = nenhum) e o console.
pub fn to_rom_folder(value: &Value, language: Language) -> AppResult<(String, EmulatorId, Option<String>, String)> {
    let field = |name: &str| value.get(name).unwrap_or(&Value::Null);
    let core = match field("core") {
        Value::Null => None,
        core => Some(to_text(core, language)?),
    };
    Ok((
        to_text(field("path"), language)?,
        to_emulator_id(field("emulatorId"), language)?,
        core,
        to_text(field("platform"), language)?,
    ))
}

/// Uma lista de jogos (ids).
pub fn to_id_list(value: &Value, language: Language) -> AppResult<Vec<i64>> {
    let items = value.as_array().ok_or_else(|| AppError::text(language, "errors.invalidGameList", &[]))?;
    items.iter().map(|item| to_id(item, language)).collect()
}

/// Uma chave de serviço: um texto, sem os espaços das pontas e de tamanho razoável. `field` é o nome do
/// campo nos erros (errors.keyFields).
pub fn to_secret(value: &Value, field: &str, language: Language) -> AppResult<String> {
    let secret = value.as_str().unwrap_or_default().trim().to_string();
    let field_name = crate::i18n::text(language, &format!("errors.keyFields.{field}"), &[]);
    if secret.is_empty() {
        return Err(AppError::text(language, "errors.fillIn", &[&field_name]));
    }
    if secret.chars().count() > 200 {
        return Err(AppError::text(language, "errors.tooLong", &[&field_name]));
    }
    Ok(secret)
}

/// O Client ID e o Client Secret do IGDB (null = apagar).
pub fn to_igdb_credentials(value: &Value, language: Language) -> AppResult<Option<IgdbCredentials>> {
    if value.is_null() {
        return Ok(None);
    }
    let field = |name: &str| value.get(name).unwrap_or(&Value::Null);
    Ok(Some(IgdbCredentials {
        client_id: to_secret(field("clientId"), "igdbClientId", language)?,
        client_secret: to_secret(field("clientSecret"), "igdbClientSecret", language)?,
    }))
}

/// A conta do RetroAchievements (null = apagar a conta): o nome (de 2 a 32 letras, números, ".", "_" ou
/// "-") e a Web API Key.
pub fn to_ra_account(value: &Value, language: Language) -> AppResult<Option<RaAccount>> {
    if value.is_null() {
        return Ok(None);
    }
    if !value.is_object() {
        return Err(AppError::text(language, "errors.invalidAccount", &[]));
    }
    let username = value.get("username").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    let valid = (2..=32).contains(&username.chars().count())
        && username.chars().all(|character| character.is_ascii_alphanumeric() || "_.-".contains(character));
    if !valid {
        return Err(AppError::text(language, "errors.raUsername", &[]));
    }
    let api_key = to_secret(value.get("apiKey").unwrap_or(&Value::Null), "raApiKey", language)?;
    Ok(Some(RaAccount { username, api_key }))
}

/// A ordem nova dos status: uma lista de ids.
pub fn to_order(value: &Value, language: Language) -> AppResult<Vec<i64>> {
    let items = value.as_array().ok_or_else(|| AppError::text(language, "errors.invalidOrder", &[]))?;
    items.iter().map(|item| to_id(item, language)).collect()
}

/// As regras automáticas de status: o de jogo novo e o de primeiro jogo.
pub fn to_status_rules(value: &Value, language: Language) -> AppResult<(i64, i64)> {
    let field = |name: &str| to_id(value.get(name).unwrap_or(&Value::Null), language);
    Ok((field("newGameStatusId")?, field("firstPlayStatusId")?))
}

/// A avaliação: só as partes enviadas, com a nota e a dificuldade de 1 a 10 (ou null) e a análise de
/// até MAX_REVIEW_LENGTH caracteres (ou null).
pub fn to_evaluation(value: &Value, language: Language) -> AppResult<GameEvaluation> {
    let fields = value.as_object().ok_or_else(|| AppError::text(language, "errors.invalidEvaluation", &[]))?;
    let score = |name: &str, error: &str| -> AppResult<Option<Option<i64>>> {
        match fields.get(name) {
            None => Ok(None),
            Some(Value::Null) => Ok(Some(None)),
            Some(score) => match score.as_i64().filter(|score| (1..=SCORE_MAX).contains(score)) {
                Some(score) => Ok(Some(Some(score))),
                None => Err(AppError::text(language, error, &[])),
            },
        }
    };
    let review = match fields.get("review") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(review)) if review.encode_utf16().count() > MAX_REVIEW_LENGTH => {
            return Err(AppError::text(language, "errors.reviewTooLong", &[&format_number(MAX_REVIEW_LENGTH, language)]));
        }
        Some(Value::String(review)) => Some(Some(review.clone())),
        Some(_) => return Err(AppError::text(language, "errors.invalidReview", &[])),
    };
    Ok(GameEvaluation {
        rating: score("rating", "errors.invalidRating")?,
        difficulty: score("difficulty", "errors.invalidDifficulty")?,
        review,
    })
}

/// Um número inteiro com o separador de milhar do idioma: 10.000 (português) ou 10,000 (inglês).
fn format_number(number: usize, language: Language) -> String {
    let separator = match language {
        Language::PtBr => '.',
        Language::En => ',',
    };
    let digits = number.to_string();
    let mut formatted = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            formatted.push(separator);
        }
        formatted.push(digit);
    }
    formatted
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ids_sao_inteiros_positivos() {
        assert_eq!(to_id(&json!(7), Language::PtBr).unwrap(), 7);
        for wrong in [json!(0), json!(-1), json!(1.5), json!("7"), Value::Null] {
            assert_eq!(to_id(&wrong, Language::PtBr).unwrap_err().to_string(), "Id inválido.");
        }
    }

    #[test]
    fn a_avaliacao_so_muda_as_partes_enviadas() {
        let changes = to_evaluation(&json!({ "rating": 9, "difficulty": null }), Language::PtBr).unwrap();
        assert_eq!(changes.rating, Some(Some(9)));
        assert_eq!(changes.difficulty, Some(None));
        assert_eq!(changes.review, None);

        let review = to_evaluation(&json!({ "review": "Muito bom" }), Language::PtBr).unwrap();
        assert_eq!(review.review, Some(Some("Muito bom".to_string())));
        assert_eq!(review.rating, None);
    }

    #[test]
    fn notas_fora_de_1_a_10_e_analises_longas_demais_sao_recusadas() {
        assert!(to_evaluation(&json!({ "rating": 11 }), Language::PtBr).is_err());
        assert!(to_evaluation(&json!({ "difficulty": 0.5 }), Language::PtBr).is_err());
        assert!(to_evaluation(&json!({ "review": 3 }), Language::PtBr).is_err());
        assert!(to_evaluation(&json!("nota"), Language::PtBr).is_err());
        let long = "a".repeat(MAX_REVIEW_LENGTH + 1);
        let error = to_evaluation(&json!({ "review": long }), Language::PtBr).unwrap_err().to_string();
        assert!(error.contains("10.000"), "{error}");
        let error = to_evaluation(&json!({ "review": long }), Language::En).unwrap_err().to_string();
        assert!(error.contains("10,000"), "{error}");
    }

    #[test]
    fn as_regras_precisam_dos_dois_status() {
        assert_eq!(to_status_rules(&json!({ "newGameStatusId": 1, "firstPlayStatusId": 4 }), Language::PtBr).unwrap(), (1, 4));
        assert!(to_status_rules(&json!({ "newGameStatusId": 1 }), Language::PtBr).is_err());
        assert!(to_status_rules(&Value::Null, Language::PtBr).is_err());
    }

    #[test]
    fn numeros_com_o_separador_do_idioma() {
        assert_eq!(format_number(10_000, Language::PtBr), "10.000");
        assert_eq!(format_number(1_234_567, Language::En), "1,234,567");
        assert_eq!(format_number(40, Language::En), "40");
    }
}
