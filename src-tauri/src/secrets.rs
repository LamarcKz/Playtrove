//! Chaves secretas (das APIs), guardadas na tabela settings criptografadas pelo Windows: só a conta do
//! Windows que salvou consegue ler. A interface nunca recebe as chaves de volta.
//!
//! O formato é o mesmo do safeStorage do Electron, para as chaves salvas no app em Electron continuarem
//! valendo (e o contrário): uma chave AES de 256 bits, protegida pelo Windows (DPAPI), fica no arquivo
//! "Local State" da pasta de dados (`os_crypt.encrypted_key`, em base64, com "DPAPI" na frente), e cada
//! segredo é guardado como "v10" + nonce de 12 bytes + o texto cifrado em AES-GCM (com a etiqueta no fim),
//! em base64.

use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, Generate, Key, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use rusqlite::Connection;
use serde_json::{Value, json};
use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CryptProtectData, CryptUnprotectData};
use windows::core::PCWSTR;

use crate::errors::{AppError, AppResult};
use crate::i18n::Language;
use crate::settings::{get_setting, set_setting};

/// O arquivo da chave que tranca as senhas (o mesmo nome do Electron).
const KEY_FILE: &str = "Local State";
/// A marca de um segredo no formato do Electron.
const VERSION: &[u8] = b"v10";
/// A marca da chave protegida pelo Windows.
const DPAPI: &[u8] = b"DPAPI";
const NONCE_BYTES: usize = 12;

/// Os segredos da pasta de dados desta vez.
pub struct Secrets {
    folder: PathBuf,
}

impl Secrets {
    pub fn new(folder: &Path) -> Secrets {
        Secrets { folder: folder.to_path_buf() }
    }

    /// Guarda um segredo criptografado (None apaga).
    pub fn save(&self, db: &Connection, language: Language, key: &str, value: Option<&str>) -> AppResult<()> {
        let Some(value) = value else {
            set_setting(db, key, None)?;
            return Ok(());
        };
        let encrypted = self.encrypt(value).ok_or_else(|| AppError::text(language, "errors.cantProtectKey", &[]))?;
        set_setting(db, key, Some(&encrypted))?;
        Ok(())
    }

    /// Lê um segredo. Se não der para abrir (ex.: o banco veio de outro computador), é como se não houvesse.
    pub fn read(&self, db: &Connection, key: &str) -> Option<String> {
        let stored = get_setting(db, key).ok()??;
        if stored.is_empty() {
            return None;
        }
        self.decrypt(&stored)
    }

    fn encrypt(&self, value: &str) -> Option<String> {
        let cipher = Aes256Gcm::new_from_slice(&self.master_key(true)?).ok()?;
        let nonce = Nonce::generate();
        let ciphertext = cipher.encrypt(&nonce, value.as_bytes()).ok()?;
        Some(BASE64.encode([VERSION, nonce.as_slice(), &ciphertext].concat()))
    }

    fn decrypt(&self, stored: &str) -> Option<String> {
        let data = BASE64.decode(stored).ok()?;
        let rest = data.strip_prefix(VERSION)?;
        if rest.len() < NONCE_BYTES {
            return None;
        }
        let (nonce, ciphertext) = rest.split_at(NONCE_BYTES);
        let cipher = Aes256Gcm::new_from_slice(&self.master_key(false)?).ok()?;
        let plaintext = cipher.decrypt(&Nonce::try_from(nonce).ok()?, ciphertext).ok()?;
        String::from_utf8(plaintext).ok()
    }

    /// A chave que tranca os segredos, do "Local State". Sem ela, com `create`, cria uma e guarda no
    /// arquivo (mantendo o que mais estiver lá).
    fn master_key(&self, create: bool) -> Option<Vec<u8>> {
        let path = self.folder.join(KEY_FILE);
        let mut state: Value =
            std::fs::read_to_string(&path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_else(|| json!({}));
        let stored = state.pointer("/os_crypt/encrypted_key").and_then(Value::as_str).and_then(|key| BASE64.decode(key).ok());
        if let Some(stored) = stored {
            return unprotect(stored.strip_prefix(DPAPI)?);
        }
        if !create || !state.is_object() {
            return None;
        }

        let key = Key::<Aes256Gcm>::generate();
        let protected = protect(key.as_slice())?;
        let encoded = BASE64.encode([DPAPI, &protected].concat());
        match state.get_mut("os_crypt").and_then(Value::as_object_mut) {
            Some(os_crypt) => {
                os_crypt.insert("encrypted_key".into(), Value::String(encoded));
            }
            None => {
                state["os_crypt"] = json!({ "encrypted_key": encoded });
            }
        }
        std::fs::create_dir_all(&self.folder).ok()?;
        std::fs::write(&path, serde_json::to_string(&state).ok()?).ok()?;
        Some(key.to_vec())
    }
}

/// Protege bytes com a conta do Windows (DPAPI).
fn protect(data: &[u8]) -> Option<Vec<u8>> {
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: a entrada aponta para `data`, que vive durante a chamada, e a saída é liberada com LocalFree.
    unsafe {
        CryptProtectData(&input, PCWSTR::null(), None, None, None, 0, &mut output).ok()?;
        Some(take_blob(output))
    }
}

/// Abre bytes protegidos pela conta do Windows (DPAPI).
fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: a entrada aponta para `data`, que vive durante a chamada, e a saída é liberada com LocalFree.
    unsafe {
        CryptUnprotectData(&input, None, None, None, None, 0, &mut output).ok()?;
        Some(take_blob(output))
    }
}

/// Copia os bytes que o Windows devolveu e libera a memória dele.
///
/// SAFETY: `blob` precisa ter vindo do CryptProtectData ou do CryptUnprotectData, ainda sem liberar.
unsafe fn take_blob(blob: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    // SAFETY: o Windows garante `cbData` bytes válidos em `pbData`, liberados uma vez só aqui.
    unsafe {
        let bytes = std::slice::from_raw_parts(blob.pbData, blob.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(blob.pbData.cast())));
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{memory_database, temp_folder};

    #[test]
    fn guarda_e_le_de_volta_e_a_chave_fica_no_local_state() {
        let folder = temp_folder("segredos");
        let db = memory_database();
        let secrets = Secrets::new(&folder);
        secrets.save(&db, Language::PtBr, "steamGridDbKey", Some("chave-certa")).unwrap();

        // O banco só tem o texto cifrado, no formato do Electron.
        let stored = get_setting(&db, "steamGridDbKey").unwrap().unwrap();
        assert!(!stored.contains("chave-certa"));
        assert!(BASE64.decode(&stored).unwrap().starts_with(VERSION));
        assert_eq!(secrets.read(&db, "steamGridDbKey").as_deref(), Some("chave-certa"));

        // Outra abertura do app (a mesma pasta) lê com a mesma chave.
        assert_eq!(Secrets::new(&folder).read(&db, "steamGridDbKey").as_deref(), Some("chave-certa"));
        let state: Value = serde_json::from_str(&std::fs::read_to_string(folder.join(KEY_FILE)).unwrap()).unwrap();
        assert!(state["os_crypt"]["encrypted_key"].as_str().is_some());

        secrets.save(&db, Language::PtBr, "steamGridDbKey", None).unwrap();
        assert_eq!(secrets.read(&db, "steamGridDbKey"), None);
    }

    #[test]
    fn mantem_o_que_mais_estiver_no_local_state() {
        let folder = temp_folder("segredos-local-state");
        std::fs::write(folder.join(KEY_FILE), r#"{"browser":{"enabled_labs_experiments":[]}}"#).unwrap();
        let db = memory_database();
        Secrets::new(&folder).save(&db, Language::PtBr, "chave", Some("valor")).unwrap();
        let state: Value = serde_json::from_str(&std::fs::read_to_string(folder.join(KEY_FILE)).unwrap()).unwrap();
        assert!(state["browser"].is_object());
        assert!(state["os_crypt"]["encrypted_key"].is_string());
    }

    #[test]
    fn sem_a_chave_ou_com_o_texto_estragado_e_como_se_nao_houvesse() {
        let db = memory_database();
        let saved_in = temp_folder("segredos-origem");
        Secrets::new(&saved_in).save(&db, Language::PtBr, "chave", Some("valor")).unwrap();
        // Outra pasta, sem o Local State: não dá para abrir.
        assert_eq!(Secrets::new(&temp_folder("segredos-outra-pasta")).read(&db, "chave"), None);
        set_setting(&db, "chave", Some("isto não é base64")).unwrap();
        assert_eq!(Secrets::new(&saved_in).read(&db, "chave"), None);
    }
}
