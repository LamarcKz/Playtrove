//! Tema Aniki ReMake da tela cheia. Como no Playnite, o pacote oficial vem da release do autor (MIT, © 2025
//! Mike Aniki) e não do repositório do Playtrove, porque traz arte de terceiros (logos de consoles e lojas,
//! selos, personagens). O arquivo tem hash fixo, e só as mídias (imagens, sons, vídeos e fontes) são extraídas
//! para os dados do app; a tela as lê pelo protocolo `playtrove-theme`.

use std::fs::{File, OpenOptions};
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use percent_encoding::percent_decode_str;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::http::{Method, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::test_mode::test_mode;

pub const THEME_PROTOCOL: &str = "playtrove-theme";
pub const PROGRESS_EVENT: &str = "themes:aniki-progress";
pub const ANIKI_VERSION: &str = "3.6.0";
/// O tamanho do pacote oficial, mostrado antes de baixar.
pub const ANIKI_SIZE: u64 = 380_465_812;
const ANIKI_URL: &str = "https://github.com/Mike-Aniki/Aniki-ReMake/releases/download/v3.6.0/Aniki_ReMake_bb8728bd-ac83-4324-88b1-ee5c586527d1_3_6_0.pthm";
const ANIKI_SHA256: &str = "21a3757a0cffce8006831503192083ba3ed14247616a4a0548f7c1fabd226dd7";
const DOWNLOAD_LIMIT: u64 = 400 * 1024 * 1024;
const MEDIA_LIMIT: u64 = 512 * 1024 * 1024;
const FILE_LIMIT: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 10_000;
/// A cada quanto o progresso do download vira aviso para a tela.
const REPORT_STEP: u64 = 2 * 1024 * 1024;
/// Gravado por último: sem ele (ou com o hash de outro pacote), a pasta não conta como instalada.
const MARKER: &str = ".playtrove-aniki";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Download,
    Extract,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnikiPackStatus {
    pub version: &'static str,
    pub size: u64,
    pub installed: bool,
    pub installing: bool,
    pub phase: Option<Phase>,
    pub received: u64,
    pub total: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum InstallError {
    Busy,
    Cancelled,
    Download,
    Integrity,
    Disk,
}

impl InstallError {
    /// A mensagem da tela (`errors.*` dos dicionários).
    pub fn message_key(&self) -> &'static str {
        match self {
            InstallError::Download | InstallError::Busy | InstallError::Cancelled => "errors.anikiDownload",
            InstallError::Integrity => "errors.anikiIntegrity",
            InstallError::Disk => "errors.anikiDisk",
        }
    }
}

impl From<std::io::Error> for InstallError {
    fn from(_: std::io::Error) -> Self {
        InstallError::Disk
    }
}

/// Quem busca o pacote: o leitor da resposta e o tamanho anunciado (os testes passam um arquivo em memória).
pub type Fetched = Result<(Box<dyn Read + Send>, Option<u64>), String>;
pub type Fetch<'a> = &'a dyn Fn(&str) -> Fetched;

#[derive(Default)]
struct Progress {
    installing: bool,
    phase: Option<Phase>,
    received: u64,
    total: u64,
}

pub struct AnikiPack {
    root: PathBuf,
    url: String,
    sha256: String,
    progress: Mutex<Progress>,
    cancel: AtomicBool,
}

impl AnikiPack {
    /// `root` é a pasta `themes` dos dados do app. Nos testes do app, o pacote vem do servidor de mentira.
    pub fn new(root: PathBuf) -> Self {
        let (url, sha256) = match &test_mode().aniki_pack {
            Some((url, sha256)) => (url.clone(), sha256.clone()),
            None => (ANIKI_URL.to_string(), ANIKI_SHA256.to_string()),
        };
        Self::with_source(root, url, sha256)
    }

    fn with_source(root: PathBuf, url: String, sha256: String) -> Self {
        AnikiPack { root, url, sha256, progress: Mutex::new(Progress::default()), cancel: AtomicBool::new(false) }
    }

    fn progress(&self) -> MutexGuard<'_, Progress> {
        self.progress.lock().unwrap_or_else(|error| error.into_inner())
    }

    pub fn installed(&self) -> bool {
        self.installed_dir().is_some()
    }

    fn installed_dir(&self) -> Option<PathBuf> {
        let directory = self.root.join(pack_name()).canonicalize().ok()?;
        let marker = std::fs::read_to_string(directory.join(MARKER)).ok()?;
        (marker == self.sha256).then_some(directory)
    }

    /// Uma mídia do pacote instalado; nomes com `..` ou fora da pasta do pacote não são entregues.
    fn asset_file(&self, relative: &str) -> Option<PathBuf> {
        mime(relative)?;
        if relative.split('/').any(|part| part.is_empty() || part == "." || part == ".." || part.contains('\\')) {
            return None;
        }
        let directory = self.installed_dir()?;
        let file = directory.join(relative).canonicalize().ok()?;
        (file.starts_with(&directory) && file.is_file()).then_some(file)
    }

    pub fn status(&self) -> AnikiPackStatus {
        let installed = self.installed();
        let progress = self.progress();
        AnikiPackStatus {
            version: ANIKI_VERSION,
            size: ANIKI_SIZE,
            installed,
            installing: progress.installing,
            phase: progress.phase,
            received: progress.received,
            total: progress.total,
        }
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Baixa, confere e instala; um segundo pedido durante a instalação não começa outro download.
    pub fn install(&self, fetch: Fetch<'_>, report: &dyn Fn(AnikiPackStatus)) -> Result<(), InstallError> {
        if self.installed() {
            return Ok(());
        }
        {
            let mut progress = self.progress();
            if progress.installing {
                return Err(InstallError::Busy);
            }
            *progress = Progress { installing: true, phase: Some(Phase::Download), received: 0, total: ANIKI_SIZE };
        }
        self.cancel.store(false, Ordering::SeqCst);
        report(self.status());
        let result = self.run(fetch, report);
        *self.progress() = Progress::default();
        report(self.status());
        result
    }

    fn run(&self, fetch: Fetch<'_>, report: &dyn Fn(AnikiPackStatus)) -> Result<(), InstallError> {
        std::fs::create_dir_all(&self.root)?;
        let root = self.root.canonicalize()?;
        let suffix = format!("part-{}", std::process::id());
        let download = root.join(format!("{}.pthm.{suffix}", pack_name()));
        let staging = root.join(format!("{}.{suffix}", pack_name()));
        let result = (|| {
            self.download(fetch, &download, report)?;
            {
                let mut progress = self.progress();
                progress.phase = Some(Phase::Extract);
            }
            report(self.status());
            extract(&download, &staging, &self.cancel)?;
            std::fs::write(staging.join(MARKER), &self.sha256)?;
            let target = root.join(pack_name());
            if target.exists() {
                // Uma pasta sem a marca é uma instalação que não terminou.
                std::fs::remove_dir_all(&target)?;
            }
            std::fs::rename(&staging, &target)?;
            Ok(())
        })();
        let _ = std::fs::remove_file(&download);
        if result.is_err() {
            let _ = std::fs::remove_dir_all(&staging);
        }
        result
    }

    fn download(&self, fetch: Fetch<'_>, path: &Path, report: &dyn Fn(AnikiPackStatus)) -> Result<(), InstallError> {
        let (mut reader, length) = fetch(&self.url).map_err(|_| InstallError::Download)?;
        if length.is_some_and(|length| length > DOWNLOAD_LIMIT) {
            return Err(InstallError::Download);
        }
        if let Some(length) = length {
            self.progress().total = length;
        }
        let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
        let mut hash = Sha256::new();
        let mut bytes = vec![0; 256 * 1024];
        let mut received = 0u64;
        let mut reported = 0u64;
        loop {
            if self.cancel.load(Ordering::SeqCst) {
                return Err(InstallError::Cancelled);
            }
            let count = reader.read(&mut bytes).map_err(|_| InstallError::Download)?;
            if count == 0 {
                break;
            }
            received += count as u64;
            if received > DOWNLOAD_LIMIT {
                return Err(InstallError::Download);
            }
            hash.update(&bytes[..count]);
            file.write_all(&bytes[..count])?;
            if received - reported >= REPORT_STEP {
                reported = received;
                self.progress().received = received;
                report(self.status());
            }
        }
        file.flush()?;
        drop(file);
        self.progress().received = received;
        if format!("{:x}", hash.finalize()) != self.sha256 {
            return Err(InstallError::Integrity);
        }
        Ok(())
    }

    /// Apaga o pacote instalado (a configuração volta ao tema Playtrove em quem chama).
    pub fn remove(&self) -> Result<(), InstallError> {
        if self.progress().installing {
            return Err(InstallError::Busy);
        }
        let target = self.root.join(pack_name());
        if target.exists() {
            std::fs::remove_dir_all(target)?;
        }
        Ok(())
    }
}

fn pack_name() -> String {
    format!("aniki-{ANIKI_VERSION}")
}

fn mime(path: &str) -> Option<&'static str> {
    let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => return None,
    })
}

/// Só as mídias saem do pacote: XAML, scripts e arquivos compactados internos ficam de fora.
fn extract(archive: &Path, staging: &Path, cancel: &AtomicBool) -> Result<(), InstallError> {
    let mut zip = zip::ZipArchive::new(BufReader::new(File::open(archive)?)).map_err(|_| InstallError::Integrity)?;
    if zip.len() > MAX_ENTRIES {
        return Err(InstallError::Integrity);
    }
    std::fs::create_dir(staging)?;
    let mut total = 0u64;
    for index in 0..zip.len() {
        if cancel.load(Ordering::SeqCst) {
            return Err(InstallError::Cancelled);
        }
        let mut entry = zip.by_index(index).map_err(|_| InstallError::Integrity)?;
        if entry.is_dir() {
            continue;
        }
        let relative = entry.enclosed_name().ok_or(InstallError::Integrity)?;
        if relative.to_str().and_then(mime).is_none() {
            continue;
        }
        if entry.is_symlink() || entry.size() > FILE_LIMIT {
            return Err(InstallError::Integrity);
        }
        total += entry.size();
        if total > MEDIA_LIMIT {
            return Err(InstallError::Integrity);
        }
        let destination = staging.join(&relative);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut output = OpenOptions::new().write(true).create_new(true).open(&destination)?;
        let copied = std::io::copy(&mut (&mut entry).take(FILE_LIMIT + 1), &mut output)?;
        if copied > FILE_LIMIT || copied != entry.size() {
            return Err(InstallError::Integrity);
        }
    }
    Ok(())
}

pub fn handle_request<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = context.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(asset_response(&app.state::<AnikiPack>(), request));
    });
}

fn asset_response(pack: &AnikiPack, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let not_found = || Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap();
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return Response::builder().status(StatusCode::METHOD_NOT_ALLOWED).header("Allow", "GET, HEAD").body(Vec::new()).unwrap();
    }
    let Ok(path) = percent_decode_str(request.uri().path().trim_start_matches('/')).decode_utf8() else { return not_found() };
    let Some(relative) = path.strip_prefix("aniki/") else { return not_found() };
    let (Some(file), Some(mime)) = (pack.asset_file(relative), mime(relative)) else { return not_found() };
    crate::videos::file_response(&file, mime, &request)
}

/// O download de verdade, pela release oficial (o GitHub redireciona para o armazenamento dele).
pub fn download(url: &str) -> Fetched {
    let config = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(30)))
        .timeout_recv_response(Some(Duration::from_secs(60)))
        .timeout_recv_body(Some(Duration::from_secs(30 * 60)))
        .build();
    let agent: ureq::Agent = config.into();
    let response = agent.get(url).call().map_err(|_| "não foi possível baixar o pacote".to_string())?;
    let length = response
        .headers()
        .get(tauri::http::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let reader = response.into_body().into_with_config().limit(DOWNLOAD_LIMIT + 1).reader();
    Ok((Box::new(reader), length))
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use zip::write::SimpleFileOptions;

    use super::*;
    use crate::test_support::temp_folder;

    fn archive(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, content) in files {
            zip.start_file(*name, SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)).unwrap();
            zip.write_all(content).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    /// Um pacote de mentira com o próprio hash, servido da memória.
    fn fake(name: &str, bytes: &[u8]) -> (AnikiPack, PathBuf, impl Fn(&str) -> Fetched) {
        let root = temp_folder(name);
        let pack = AnikiPack::with_source(
            root.clone(),
            "https://servidor.test/aniki.pthm".into(),
            format!("{:x}", Sha256::digest(bytes)),
        );
        let bytes = bytes.to_vec();
        let fetch = move |url: &str| -> Fetched {
            assert_eq!(url, "https://servidor.test/aniki.pthm");
            Ok((Box::new(Cursor::new(bytes.clone())), Some(bytes.len() as u64)))
        };
        (pack, root, fetch)
    }

    fn request(path: &str) -> Request<Vec<u8>> {
        Request::builder().uri(format!("http://playtrove-theme.localhost/{path}")).body(Vec::new()).unwrap()
    }

    #[test]
    fn instala_so_as_midias_e_serve_somente_de_dentro_do_pacote() {
        let bytes = archive(&[
            ("Images/Back.png", b"png"),
            ("audio/navigation.wav", b"wav"),
            ("Startup Video/Startup.mp4", b"mp4"),
            ("Views/Main.xaml", b"<xaml/>"),
            ("Themes Option/pacote.zip", b"zip"),
        ]);
        let (pack, root, fetch) = fake("aniki-instalar", &bytes);
        let reports = Mutex::new(Vec::new());
        pack.install(&fetch, &|status| reports.lock().unwrap().push(status.phase)).unwrap();
        assert!(pack.installed());
        assert_eq!(reports.into_inner().unwrap(), [Some(Phase::Download), Some(Phase::Extract), None]);
        let directory = root.join(pack_name());
        assert_eq!(std::fs::read(directory.join("Images/Back.png")).unwrap(), b"png");
        assert!(directory.join("Startup Video/Startup.mp4").is_file());
        assert!(!directory.join("Views").exists());
        assert!(!directory.join("Themes Option").exists());
        // Só a pasta instalada fica: o download e a pasta temporária somem.
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);

        let response = asset_response(&pack, request("aniki/Images/Back.png"));
        assert_eq!((response.status(), response.body().as_slice()), (StatusCode::OK, b"png".as_slice()));
        let response = asset_response(&pack, request("aniki/Startup%20Video/Startup.mp4"));
        assert_eq!(response.status(), StatusCode::OK);
        for invalid in [
            "aniki/../x.png",
            "aniki/Images/../../x.png",
            "aniki/Images//Back.png",
            "aniki/Images%5CBack.png",
            "aniki/.playtrove-aniki",
            "aniki/Images/Nada.png",
            "outro/Images/Back.png",
        ] {
            assert_eq!(asset_response(&pack, request(invalid)).status(), StatusCode::NOT_FOUND, "{invalid}");
        }

        pack.remove().unwrap();
        assert!(!pack.installed());
        assert_eq!(asset_response(&pack, request("aniki/Images/Back.png")).status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn hash_errado_ou_caminho_para_fora_nao_instalam_nada() {
        let bytes = archive(&[("Images/Back.png", b"png")]);
        let (_, root, fetch) = fake("aniki-hash", &bytes);
        let pack = AnikiPack::with_source(root.clone(), "https://servidor.test/aniki.pthm".into(), ANIKI_SHA256.into());
        assert_eq!(pack.install(&fetch, &|_| {}), Err(InstallError::Integrity));
        assert!(!pack.installed());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        assert!(!pack.status().installing);

        let escape = archive(&[("Images/Back.png", b"png"), ("../fora.png", b"png")]);
        let (pack, root, fetch) = fake("aniki-fora", &escape);
        assert_eq!(pack.install(&fetch, &|_| {}), Err(InstallError::Integrity));
        assert!(!pack.installed());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        assert!(!root.parent().unwrap().join("fora.png").exists());
    }

    #[test]
    fn cancelar_durante_o_download_nao_deixa_arquivos() {
        // Bytes sem padrão, para o pacote passar dos 2 MiB que geram o aviso de progresso.
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        let noise: Vec<u8> = (0..3 * 1024 * 1024)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                seed as u8
            })
            .collect();
        let bytes = archive(&[("Images/Back.png", &noise)]);
        let (pack, root, fetch) = fake("aniki-cancelar", &bytes);
        // Um pedido de cancelar antigo não vale para a próxima instalação; este chega no meio do download.
        pack.cancel();
        let cancel = |status: AnikiPackStatus| {
            if status.phase == Some(Phase::Download) && status.received > 0 {
                pack.cancel();
            }
        };
        assert_eq!(pack.install(&fetch, &cancel), Err(InstallError::Cancelled));
        assert!(!pack.installed());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        pack.install(&fetch, &|_| {}).unwrap();
        assert!(pack.installed());
    }

    #[test]
    fn status_mostra_o_pacote_oficial() {
        let status = AnikiPack::new(temp_folder("aniki-status")).status();
        assert_eq!((status.version, status.size, status.installed, status.installing), ("3.6.0", ANIKI_SIZE, false, false));
    }
}
