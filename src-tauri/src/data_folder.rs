//! Onde ficam os dados do app: o banco, as imagens dos jogos e a chave que tranca as senhas.

use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use crate::test_mode::test_mode;

/// O arquivo do banco, dentro da pasta de dados.
pub const DATABASE_FILE: &str = "playtrove.db";

/// A pasta de dados do app instalado, em %APPDATA%.
const REAL_FOLDER: &str = "Playtrove";

/// A pasta da biblioteca do modo de desenvolvimento, ao lado da de verdade (a mesma do Electron).
const DEV_FOLDER: &str = "Playtrove Dev";

/// O arquivo que deixa o app portátil (vem no .zip): com ele ao lado do .exe, os dados ficam ali do lado.
const PORTABLE_MARKER: &str = "portable.txt";

/// O que vai junto com o banco na cópia do modo de desenvolvimento: as imagens e a chave que tranca as
/// senhas (as chaves das APIs).
const COPIED_ALONG: [&str; 2] = ["images", "Local State"];

/// A pasta de dados desta vez: nos testes automáticos, uma pasta temporária (nunca a biblioteca de
/// verdade); na versão portátil, a pasta "data" ao lado do .exe; no app de verdade, %APPDATA%\Playtrove;
/// e no modo de desenvolvimento, uma cópia dela, em %APPDATA%\Playtrove Dev, para o código em
/// desenvolvimento nunca mexer nos jogos de verdade.
///
/// O app em Electron também trazia a pasta da época do Bibliotecaofgames (até a 0.4.0, que nunca foi
/// pública); quem chega ao Tauri já vem da pasta do Playtrove, então essa mudança não existe aqui.
pub fn data_folder(app_data: &Path) -> Result<PathBuf, Box<dyn Error>> {
    if let Some(folder) = &test_mode().data_dir {
        return Ok(folder.clone());
    }
    let real = app_data.join(REAL_FOLDER);
    if cfg!(debug_assertions) {
        return dev_library(&real, &app_data.join(DEV_FOLDER));
    }
    Ok(portable_data_folder(&std::env::current_exe()?).unwrap_or(real))
}

/// Esta é a versão portátil (o .zip, com o portable.txt ao lado do .exe)? Nunca no modo de desenvolvimento.
pub fn is_portable() -> bool {
    !cfg!(debug_assertions) && std::env::current_exe().is_ok_and(|exe| portable_data_folder(&exe).is_some())
}

/// A pasta de dados da versão portátil: "data", ao lado do .exe, quando o portable.txt está lá (como nos
/// emuladores portáteis). None se não for a portátil.
fn portable_data_folder(exe: &Path) -> Option<PathBuf> {
    let folder = exe.parent()?;
    folder.join(PORTABLE_MARKER).exists().then(|| folder.join("data"))
}

/// A biblioteca do modo de desenvolvimento: uma cópia da de verdade, numa pasta à parte (escolha do
/// usuário em 2026-09-29). Na primeira vez, ou depois do `npm run dev:nova-copia`, copia o banco, as
/// imagens e a chave das senhas; a biblioteca de verdade só é lida. Sem biblioteca de verdade, a do
/// desenvolvimento começa vazia.
fn dev_library(real: &Path, dev: &Path) -> Result<PathBuf, Box<dyn Error>> {
    let dev_database = dev.join(DATABASE_FILE);
    if dev_database.exists() {
        return Ok(dev.to_path_buf());
    }
    fs::create_dir_all(dev)?;
    let real_database = real.join(DATABASE_FILE);
    if !real_database.exists() {
        return Ok(dev.to_path_buf());
    }

    // O VACUUM INTO grava uma cópia inteira e coerente, mesmo com o app instalado aberto e gravando.
    let source = Connection::open_with_flags(&real_database, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    source.execute("VACUUM INTO ?1", [dev_database.to_string_lossy()])?;
    drop(source);
    for name in COPIED_ALONG {
        let from = real.join(name);
        if from.exists() {
            copy_recursive(&from, &dev.join(name))?;
        }
    }
    Ok(dev.to_path_buf())
}

/// Copia um arquivo ou uma pasta inteira.
fn copy_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    if !from.is_dir() {
        fs::copy(from, to)?;
        return Ok(());
    }
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("playtrove-teste-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    #[test]
    fn a_portatil_usa_a_pasta_data_ao_lado_do_exe() {
        let folder = temp_folder("portatil");
        let exe = folder.join("Playtrove.exe");
        assert_eq!(portable_data_folder(&exe), None);
        fs::write(folder.join(PORTABLE_MARKER), "").unwrap();
        assert_eq!(portable_data_folder(&exe), Some(folder.join("data")));
    }

    #[test]
    fn o_desenvolvimento_copia_a_biblioteca_sem_mexer_na_de_verdade() {
        let folder = temp_folder("copia");
        let real = folder.join("real");
        let dev = folder.join("dev");
        fs::create_dir_all(real.join("images").join("1")).unwrap();
        fs::write(real.join("images").join("1").join("cover.png"), "capa").unwrap();
        let db = Connection::open(real.join(DATABASE_FILE)).unwrap();
        db.execute_batch("CREATE TABLE jogos (nome TEXT); INSERT INTO jogos VALUES ('Jogo de exemplo');").unwrap();
        drop(db);

        assert_eq!(dev_library(&real, &dev).unwrap(), dev);
        let copy = Connection::open(dev.join(DATABASE_FILE)).unwrap();
        let name: String = copy.query_row("SELECT nome FROM jogos", [], |row| row.get(0)).unwrap();
        assert_eq!(name, "Jogo de exemplo");
        assert_eq!(fs::read_to_string(dev.join("images").join("1").join("cover.png")).unwrap(), "capa");

        // A cópia já existe: nada é copiado de novo.
        copy.execute("DELETE FROM jogos", []).unwrap();
        drop(copy);
        dev_library(&real, &dev).unwrap();
        let copy = Connection::open(dev.join(DATABASE_FILE)).unwrap();
        let count: i64 = copy.query_row("SELECT COUNT(*) FROM jogos", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }
}
