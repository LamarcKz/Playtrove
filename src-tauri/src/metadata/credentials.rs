//! As chaves dos serviços de metadados e a configuração (Configurações → Metadados). As chaves secretas
//! vão criptografadas (secrets.rs); a interface só recebe o que está configurado, nunca as chaves.

use rusqlite::Connection;
use serde::Serialize;

use super::igdb::IgdbCredentials;
use crate::errors::AppResult;
use crate::i18n::Language;
use crate::secrets::Secrets;
use crate::settings::{get_setting, set_setting};

/// Onde cada coisa fica na tabela settings (os mesmos nomes do Electron).
const IGDB_CLIENT_ID: &str = "igdbClientId";
const IGDB_CLIENT_SECRET: &str = "igdbClientSecret";
const STEAM_GRID_DB_KEY: &str = "steamGridDbKey";
const AUTO_DOWNLOAD: &str = "metadataAutoDownload";

/// As chaves salvas (só a parte em Rust lê).
pub struct MetadataCredentials {
    pub igdb: Option<IgdbCredentials>,
    pub steam_grid_db_key: Option<String>,
}

pub fn read_metadata_credentials(db: &Connection, secrets: &Secrets) -> MetadataCredentials {
    let client_id = get_setting(db, IGDB_CLIENT_ID).ok().flatten().filter(|id| !id.is_empty());
    let client_secret = secrets.read(db, IGDB_CLIENT_SECRET);
    MetadataCredentials {
        igdb: client_id.zip(client_secret).map(|(client_id, client_secret)| IgdbCredentials { client_id, client_secret }),
        steam_grid_db_key: secrets.read(db, STEAM_GRID_DB_KEY),
    }
}

/// O que está configurado, para a tela de Configurações.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataConfig {
    igdb: bool,
    /// Não é segredo: aparece na tela para o usuário conferir.
    igdb_client_id: Option<String>,
    steam_grid_db: bool,
    /// Baixar sozinho os metadados dos jogos novos, quando uma pasta de ROMs é procurada.
    auto_download: bool,
}

pub fn get_metadata_config(db: &Connection, secrets: &Secrets) -> MetadataConfig {
    let credentials = read_metadata_credentials(db, secrets);
    MetadataConfig {
        igdb: credentials.igdb.is_some(),
        igdb_client_id: credentials.igdb.map(|igdb| igdb.client_id),
        steam_grid_db: credentials.steam_grid_db_key.is_some(),
        auto_download: auto_download(db),
    }
}

/// Baixar sozinho os metadados dos jogos novos? (Vem ligado.)
pub fn auto_download(db: &Connection) -> bool {
    get_setting(db, AUTO_DOWNLOAD).ok().flatten().as_deref() != Some("0")
}

/// Salva (ou apaga, com None) o Client ID e o Client Secret do IGDB.
pub fn save_igdb_credentials(
    db: &Connection,
    secrets: &Secrets,
    language: Language,
    credentials: Option<&IgdbCredentials>,
) -> AppResult<()> {
    set_setting(db, IGDB_CLIENT_ID, credentials.map(|credentials| credentials.client_id.as_str()))?;
    secrets.save(db, language, IGDB_CLIENT_SECRET, credentials.map(|credentials| credentials.client_secret.as_str()))
}

/// Salva (ou apaga, com None) a chave do SteamGridDB.
pub fn save_steam_grid_db_key(db: &Connection, secrets: &Secrets, language: Language, key: Option<&str>) -> AppResult<()> {
    secrets.save(db, language, STEAM_GRID_DB_KEY, key)
}

pub fn set_metadata_auto_download(db: &Connection, enabled: bool) -> rusqlite::Result<()> {
    set_setting(db, AUTO_DOWNLOAD, Some(if enabled { "1" } else { "0" }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_database, temp_folder};

    #[test]
    fn a_tela_so_sabe_o_que_esta_configurado_nunca_as_chaves() {
        let db = memory_database();
        let secrets = Secrets::new(&temp_folder("credenciais"));
        let empty = MetadataConfig { igdb: false, igdb_client_id: None, steam_grid_db: false, auto_download: true };
        assert_eq!(get_metadata_config(&db, &secrets), empty);

        let igdb = IgdbCredentials { client_id: "id-certo".into(), client_secret: "segredo-certo".into() };
        save_igdb_credentials(&db, &secrets, Language::PtBr, Some(&igdb)).unwrap();
        save_steam_grid_db_key(&db, &secrets, Language::PtBr, Some("chave-certa")).unwrap();
        set_metadata_auto_download(&db, false).unwrap();
        assert_eq!(
            get_metadata_config(&db, &secrets),
            MetadataConfig { igdb: true, igdb_client_id: Some("id-certo".into()), steam_grid_db: true, auto_download: false }
        );
        let credentials = read_metadata_credentials(&db, &secrets);
        assert_eq!(credentials.igdb, Some(igdb));
        assert_eq!(credentials.steam_grid_db_key.as_deref(), Some("chave-certa"));

        save_igdb_credentials(&db, &secrets, Language::PtBr, None).unwrap();
        save_steam_grid_db_key(&db, &secrets, Language::PtBr, None).unwrap();
        assert_eq!(get_metadata_config(&db, &secrets), MetadataConfig { auto_download: false, ..empty });
    }
}
