//! Preparação das duas ferramentas oficiais, com hashes fixos e extração restrita.

use std::fs::{File, OpenOptions};
use std::io::{Cursor, Read, Write};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, TryLockError};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

static PREPARE_LOCK: Mutex<()> = Mutex::new(());
static NEXT_FILE: AtomicU64 = AtomicU64::new(1);

pub(super) struct Tools {
    pub youtube: PathBuf,
    pub deno: PathBuf,
    pub runtime: PathBuf,
}

const YOUTUBE: ToolSpec<'static> = ToolSpec {
    directory: "yt-dlp-2026.10.21",
    filename: "yt-dlp.exe",
    url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp.exe",
    download_sha256: "33121d192d706e62f684a06f80918e3f3a8ba52ac3a65213b6951c39c7d9f555",
    executable_sha256: "33121d192d706e62f684a06f80918e3f3a8ba52ac3a65213b6951c39c7d9f555",
    download_limit: 32 * 1024 * 1024,
    executable_limit: 32 * 1024 * 1024,
    zip: false,
};
const DENO: ToolSpec<'static> = ToolSpec {
    directory: "deno-2.9.8",
    filename: "deno.exe",
    url: "https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-pc-windows-msvc.zip",
    download_sha256: "cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf",
    executable_sha256: "924397800533d3eb0ed0c889b20ad70e18b970d93acd8135bc043f425e528266",
    download_limit: 64 * 1024 * 1024,
    executable_limit: 128 * 1024 * 1024,
    zip: true,
};

pub(super) fn prepare(root: &Path, deadline: Instant) -> Result<Tools, String> {
    let _guard = loop {
        match PREPARE_LOCK.try_lock() {
            Ok(guard) => break guard,
            Err(TryLockError::Poisoned(error)) => break error.into_inner(),
            Err(TryLockError::WouldBlock) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => return Err("tempo de preparação esgotado".into()),
        }
    };
    let fetch = |url: &str, limit: u64| {
        let remaining = deadline.checked_duration_since(Instant::now()).ok_or("tempo de preparação esgotado")?;
        let config = ureq::Agent::config_builder().timeout_global(Some(remaining.min(Duration::from_secs(60)))).build();
        let agent: ureq::Agent = config.into();
        let mut response = agent.get(url).call().map_err(|_| "não foi possível obter a ferramenta")?;
        let bytes =
            response.body_mut().with_config().limit(limit + 1).read_to_vec().map_err(|_| "falha ao receber a ferramenta")?;
        if bytes.len() as u64 > limit {
            return Err("ferramenta acima do limite de tamanho".into());
        }
        Ok(bytes)
    };
    let youtube = prepare_tool(root, &YOUTUBE, &fetch)?;
    let deno = prepare_tool(root, &DENO, &fetch)?;
    let runtime = confined_directory(root, "runtime")?;
    Ok(Tools { youtube, deno, runtime })
}

struct ToolSpec<'a> {
    directory: &'a str,
    filename: &'a str,
    url: &'a str,
    download_sha256: &'a str,
    executable_sha256: &'a str,
    download_limit: u64,
    executable_limit: u64,
    zip: bool,
}

fn prepare_tool(
    root: &Path,
    spec: &ToolSpec<'_>,
    fetch: &impl Fn(&str, u64) -> Result<Vec<u8>, String>,
) -> Result<PathBuf, String> {
    let directory = confined_directory(root, spec.directory)?;
    let executable = directory.join(spec.filename);
    if verified_file(&executable, spec.executable_sha256, spec.executable_limit) {
        return Ok(executable);
    }
    let bytes = fetch(spec.url, spec.download_limit)?;
    if bytes.len() as u64 > spec.download_limit || format!("{:x}", Sha256::digest(&bytes)) != spec.download_sha256 {
        return Err("a ferramenta não passou na verificação de integridade".into());
    }
    let temporary = temporary_path(&executable);
    let result = (|| {
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "não foi possível preparar a ferramenta")?;
        if spec.zip {
            let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "arquivo de ferramenta inválido")?;
            let mut entry = zip.by_name(spec.filename).map_err(|_| "executável ausente na ferramenta")?;
            if !entry.is_file()
                || entry.size() > spec.executable_limit
                || entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("entrada de ferramenta inválida".into());
            }
            super::copy_limited(&mut entry, &mut output, spec.executable_limit)?;
        } else {
            super::copy_limited(&mut Cursor::new(bytes), &mut output, spec.executable_limit)?;
        }
        output.flush().map_err(|_| "falha ao gravar a ferramenta")?;
        drop(output);
        if !verified_file(&temporary, spec.executable_sha256, spec.executable_limit) {
            return Err("o executável não passou na verificação de integridade".into());
        }
        // rename substitui atomicamente o cache antigo somente após validar a nova cópia.
        std::fs::rename(&temporary, &executable).map_err(|_| "não foi possível instalar a ferramenta")?;
        Ok(executable)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

fn confined_directory(root: &Path, name: &str) -> Result<PathBuf, String> {
    if !root.is_absolute() {
        return Err("pasta de ferramentas inválida".into());
    }
    std::fs::create_dir_all(root).map_err(|_| "não foi possível criar a pasta de ferramentas")?;
    let root = root.canonicalize().map_err(|_| "pasta de ferramentas inacessível")?;
    let directory = root.join(name);
    std::fs::create_dir_all(&directory).map_err(|_| "não foi possível criar a pasta da ferramenta")?;
    let resolved = directory.canonicalize().map_err(|_| "pasta de ferramenta inacessível")?;
    if resolved != directory {
        return Err("a pasta da ferramenta sai dos dados do app".into());
    }
    Ok(resolved)
}

fn verified_file(path: &Path, expected: &str, limit: u64) -> bool {
    let Ok(metadata) = std::fs::symlink_metadata(path) else { return false };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > limit {
        return false;
    }
    let Ok(mut file) = File::open(path) else { return false };
    let mut hash = Sha256::new();
    let mut bytes = [0; 64 * 1024];
    let mut total = 0;
    loop {
        let count = match file.read(&mut bytes) {
            Ok(0) => break,
            Ok(count) => count,
            Err(_) => return false,
        };
        total += count as u64;
        if total > limit {
            return false;
        }
        hash.update(&bytes[..count]);
    }
    format!("{:x}", hash.finalize()) == expected
}

pub(super) fn temporary_path(destination: &Path) -> PathBuf {
    let sequence = NEXT_FILE.fetch_add(1, Ordering::Relaxed);
    destination.with_extension(format!("part-{}-{sequence}", std::process::id()))
}

pub(super) fn promote_new(source: &Path, destination: &Path) -> Result<(), String> {
    use windows::Win32::Storage::FileSystem::{MOVE_FILE_FLAGS, MoveFileExW};
    use windows::core::PCWSTR;

    let error = || "não foi possível guardar o trailer".to_string();
    let parent = destination.parent().ok_or_else(error)?.canonicalize().map_err(|_| error())?;
    let source = parent.join(source.file_name().ok_or_else(error)?);
    let destination = parent.join(destination.file_name().ok_or_else(error)?);
    let source: Vec<u16> = source.as_os_str().encode_wide().chain([0]).collect();
    let destination: Vec<u16> = destination.as_os_str().encode_wide().chain([0]).collect();
    // SAFETY: buffers UTF-16 válidos durante a chamada; sem REPLACE_EXISTING, um destino concorrente é preservado.
    unsafe { MoveFileExW(PCWSTR(source.as_ptr()), PCWSTR(destination.as_ptr()), MOVE_FILE_FLAGS(0)).map_err(|_| error()) }
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};
    use std::sync::atomic::{AtomicUsize, Ordering};

    use sha2::{Digest, Sha256};
    use zip::write::SimpleFileOptions;

    use super::*;
    use crate::test_support::temp_folder;

    const ABC_SHA: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    fn fixture(download_hash: &str, zip: bool) -> ToolSpec<'_> {
        ToolSpec {
            directory: "versao-teste",
            filename: "deno.exe",
            url: "https://servidor.test/ferramenta",
            download_sha256: download_hash,
            executable_sha256: ABC_SHA,
            download_limit: 4096,
            executable_limit: 3,
            zip,
        }
    }

    fn archive(name: &str, content: &[u8]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file(name, SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)).unwrap();
        zip.write_all(content).unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn cache_verificado_dispensa_rede_e_cache_adulterado_e_substituido() {
        let root = temp_folder("ferramentas-cache");
        let folder = root.join("versao-teste");
        std::fs::create_dir_all(&folder).unwrap();
        let exe = folder.join("deno.exe");
        std::fs::write(&exe, b"abc").unwrap();
        let calls = AtomicUsize::new(0);
        let fetch = |_: &str, _: u64| {
            calls.fetch_add(1, Ordering::Relaxed);
            Ok(b"abc".to_vec())
        };
        assert_eq!(prepare_tool(&root, &fixture(ABC_SHA, false), &fetch).unwrap(), exe.canonicalize().unwrap());
        assert_eq!(calls.load(Ordering::Relaxed), 0);
        std::fs::write(&exe, b"xyz").unwrap();
        prepare_tool(&root, &fixture(ABC_SHA, false), &fetch).unwrap();
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        assert_eq!(std::fs::read(exe).unwrap(), b"abc");
    }

    #[test]
    fn resposta_com_hash_errado_nao_instala_executavel() {
        let root = temp_folder("ferramentas-hash");
        assert!(prepare_tool(&root, &fixture(ABC_SHA, false), &|_, _| Ok(b"xyz".to_vec())).is_err());
        assert!(!root.join("versao-teste/deno.exe").exists());
    }

    #[test]
    fn zip_so_instala_a_entrada_exata_com_tamanho_e_hash_do_executavel_corretos() {
        let root = temp_folder("ferramentas-zip");
        let good = archive("deno.exe", b"abc");
        let hash = format!("{:x}", Sha256::digest(&good));
        let path = prepare_tool(&root, &fixture(&hash, true), &|_, _| Ok(good.clone())).unwrap();
        assert_eq!(std::fs::read(path).unwrap(), b"abc");

        for (index, name, content) in [(0, "../deno.exe", b"abc".as_slice()), (1, "deno.exe", b"abcdef"), (2, "deno.exe", b"xyz")]
        {
            let root = root.join(index.to_string());
            let bytes = archive(name, content);
            let hash = format!("{:x}", Sha256::digest(&bytes));
            assert!(prepare_tool(&root, &fixture(&hash, true), &|_, _| Ok(bytes.clone())).is_err());
            assert!(!root.join("versao-teste/deno.exe").exists());
        }
    }
}
