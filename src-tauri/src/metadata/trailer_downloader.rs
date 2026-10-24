//! Download limitado de trailers, com ferramentas verificadas e sem configuração externa.

use std::ffi::OsString;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

#[path = "trailer_tools_process.rs"]
mod process;
#[path = "trailer_tools.rs"]
mod tools;

const MAX_VIDEO_BYTES: u64 = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(180);

pub trait TrailerDownloader: Send + Sync {
    fn download(&self, video_id: &str, destination: &Path) -> Result<(), String>;
}

pub struct YoutubeDownloader {
    tools_dir: PathBuf,
}

impl YoutubeDownloader {
    pub fn new(tools_dir: PathBuf) -> Self {
        Self { tools_dir }
    }
}

impl TrailerDownloader for YoutubeDownloader {
    fn download(&self, video_id: &str, destination: &Path) -> Result<(), String> {
        validate_video_id(video_id)?;
        validate_destination(destination)?;
        let deadline = Instant::now() + DOWNLOAD_TIMEOUT;
        let tools = tools::prepare(&self.tools_dir, deadline)?;
        save_download(destination, |file| {
            process::run(&tools.youtube, &download_args(&tools.deno, video_id), &tools.runtime, file, deadline)
        })
    }
}

fn validate_video_id(id: &str) -> Result<(), String> {
    if id.len() == 11 && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-') {
        Ok(())
    } else {
        Err("identificador de trailer inválido".into())
    }
}

fn copy_limited(reader: &mut impl Read, writer: &mut impl Write, limit: u64) -> Result<u64, String> {
    let mut bytes = [0; 64 * 1024];
    let mut total = 0;
    loop {
        // Depois do teto, lê somente um byte para distinguir EOF de um arquivo grande demais.
        let allowed = (limit.saturating_sub(total) + 1).min(bytes.len() as u64) as usize;
        let count = reader.read(&mut bytes[..allowed]).map_err(|_| "falha na transferência")?;
        if count == 0 {
            return Ok(total);
        }
        let remaining = limit - total;
        let accepted = count.min(remaining as usize);
        writer.write_all(&bytes[..accepted]).map_err(|_| "falha ao gravar a transferência")?;
        total += accepted as u64;
        if count > accepted {
            return Err("transferência acima do limite de tamanho".into());
        }
    }
}

fn download_args(deno: &Path, video_id: &str) -> Vec<OsString> {
    let mut args: Vec<OsString> = [
        "--ignore-config",
        "--no-config-locations",
        "--no-plugin-dirs",
        "--no-remote-components",
        "--no-update",
        "--no-exec",
        "--no-js-runtimes",
        "--no-cookies",
        "--no-cookies-from-browser",
        "--no-cache-dir",
        "--no-playlist",
        "--use-extractors",
        "youtube",
        "--downloader",
        "native",
        "--fixup",
        "never",
        "--socket-timeout",
        "20",
        "--retries",
        "2",
        "--max-filesize",
        "104857600",
        "--quiet",
        "--no-progress",
        "--output",
        "-",
        "--format",
        "bv[ext=mp4][vcodec^=avc1][height<=720][protocol=https]/b[ext=mp4][vcodec^=avc1][height<=720][protocol=https]",
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    let mut deno_path = OsString::from("deno:");
    deno_path.push(deno);
    args.extend(["--js-runtimes".into(), deno_path, "--".into(), format!("https://www.youtube.com/watch?v={video_id}").into()]);
    args
}

fn validate_destination(destination: &Path) -> Result<(), String> {
    if !destination.is_absolute()
        || destination.extension().is_none_or(|extension| extension != "mp4")
        || std::fs::symlink_metadata(destination).is_ok()
        || destination.parent().is_none_or(|parent| !parent.is_dir())
    {
        return Err("destino do trailer inválido".into());
    }
    Ok(())
}

fn save_download(destination: &Path, run: impl FnOnce(File) -> Result<(), String>) -> Result<(), String> {
    validate_destination(destination)?;
    let temporary = tools::temporary_path(destination);
    let result = (|| {
        let output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "não foi possível criar o trailer")?;
        run(output)?;
        let mut downloaded = File::open(&temporary).map_err(|_| "trailer não recebido")?;
        if downloaded.metadata().map_err(|_| "trailer inacessível")?.len() > MAX_VIDEO_BYTES {
            return Err("trailer acima do limite de tamanho".into());
        }
        let mut signature = [0; 12];
        downloaded.read_exact(&mut signature).map_err(|_| "trailer incompleto")?;
        if &signature[4..8] != b"ftyp" {
            return Err("o trailer recebido não é MP4".into());
        }
        drop(downloaded);
        tools::promote_new(&temporary, destination)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use crate::test_support::temp_folder;

    #[test]
    fn somente_ids_youtube_validos_chegam_ao_downloader() {
        assert!(validate_video_id("Abc_1234-XY").is_ok());
        for id in
            ["", "abc", "Abc_1234-XYZ", "../Abc_1234", "https://youtube.com/watch?v=Abc_1234-XY", "Abc_1234 XY", "Abc_1234-áY"]
        {
            assert!(validate_video_id(id).is_err(), "{id}");
        }
    }

    #[test]
    fn a_transferencia_nunca_grava_acima_do_limite_real() {
        let mut output = Vec::new();
        let result = copy_limited(&mut Cursor::new(b"123456789"), &mut output, 8);
        assert!(result.is_err());
        assert_eq!(output, b"12345678");
        let mut exact = Vec::new();
        assert_eq!(copy_limited(&mut Cursor::new(b"12345678"), &mut exact, 8), Ok(8));
        assert_eq!(exact, b"12345678");
    }

    #[test]
    fn argumentos_isolam_configs_e_credenciais_e_pedem_somente_mp4_limitado() {
        let args = download_args(Path::new(r"D:\Ferramentas de teste\deno.exe"), "Abc_1234-XY");
        for flag in [
            "--ignore-config",
            "--no-config-locations",
            "--no-plugin-dirs",
            "--no-cookies",
            "--no-cookies-from-browser",
            "--no-remote-components",
            "--no-update",
            "--no-exec",
            "--no-cache-dir",
            "--no-playlist",
        ] {
            assert!(args.iter().any(|arg| arg == flag), "{flag}");
        }
        let value = |flag: &str| args[args.iter().position(|arg| arg == flag).unwrap() + 1].to_string_lossy().into_owned();
        assert_eq!(value("--output"), "-");
        assert_eq!(value("--max-filesize"), "104857600");
        assert_eq!(value("--downloader"), "native");
        assert_eq!(value("--fixup"), "never");
        let format = value("--format");
        assert!(format.starts_with("bv[ext=mp4][vcodec^=avc1][height<=720][protocol=https]/b[ext=mp4]"));
        assert!(!format.contains('+'));
        assert!(!format.contains("webm"));
        assert_eq!(args[args.len() - 2], "--");
        assert_eq!(args.last().unwrap(), "https://www.youtube.com/watch?v=Abc_1234-XY");
    }

    #[test]
    fn apenas_mp4_completo_e_promovido_e_falhas_removem_parciais() {
        let root = temp_folder("trailer-parcial");
        let destination = root.join("trailer.mp4");
        save_download(&destination, |mut file| {
            file.write_all(b"0000ftypmp42").unwrap();
            Ok(())
        })
        .unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"0000ftypmp42");
        assert!(save_download(&destination, |_| panic!("não deve substituir arquivo existente")).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"0000ftypmp42");
        std::fs::remove_file(&destination).unwrap();
        for failure in [true, false] {
            assert!(
                save_download(&destination, |mut file| {
                    file.write_all(b"nao e video").unwrap();
                    if failure { Err("processo falhou".into()) } else { Ok(()) }
                })
                .is_err()
            );
            assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        }
    }

    #[test]
    fn arquivo_que_aparece_durante_o_download_nao_e_substituido() {
        let root = temp_folder("trailer-destino-concorrente");
        let destination = root.join("trailer.mp4");
        assert!(
            save_download(&destination, |mut file| {
                file.write_all(b"0000ftypmp42").unwrap();
                std::fs::write(&destination, b"outro arquivo").unwrap();
                Ok(())
            })
            .is_err()
        );
        assert_eq!(std::fs::read(destination).unwrap(), b"outro arquivo");
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 1);
    }
}
