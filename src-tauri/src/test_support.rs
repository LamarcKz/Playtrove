//! Ajuda para os testes: pastas temporárias e bancos em memória, nunca os dados do computador.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::migrations::run_migrations;

/// Uma pasta temporária vazia, só deste teste.
pub fn temp_folder(name: &str) -> PathBuf {
    let folder = std::env::temp_dir().join(format!("playtrove-teste-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).unwrap();
    folder
}

/// Cria os arquivos (caminhos com "/") dentro da pasta, com as pastas que faltarem.
pub fn create_files(folder: &Path, files: &[(&str, &str)]) {
    for (path, content) in files {
        let file = folder.join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, content).unwrap();
    }
}

/// Um banco novo em memória, com todas as tabelas.
pub fn memory_database() -> Connection {
    let mut db = Connection::open_in_memory().unwrap();
    run_migrations(&mut db).unwrap();
    db
}
