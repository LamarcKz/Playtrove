//! O tema Aniki ReMake, como no Playnite: o Playtrove baixa das páginas oficiais o Playnite portátil, o
//! tema, o Aniki Helper e o IGDB (que o assistente do próprio Playnite instalaria) e deixa os
//! complementos com o assistente do Aniki. Cada pacote tem endereço e SHA-256 fixos, conferidos antes
//! de abrir; nada disso vai no instalador do Playtrove.

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

use crate::i18n::Language;
use crate::test_mode::test_mode;

pub const THEME_PROTOCOL: &str = "playtrove-theme";
pub const PROGRESS_EVENT: &str = "themes:aniki-progress";
pub const ANIKI_VERSION: &str = "3.6.0";
pub const THEME_ID: &str = "Aniki_ReMake_bb8728bd-ac83-4324-88b1-ee5c586527d1";
pub const HELPER_ID: &str = "AnikiHelper_96a983a3-3f13-4dce-a474-4052b718bb52";
pub const PLAYNITE_SIZE: u64 = 133_044_541;
pub const ANIKI_SIZE: u64 = 380_465_812;
pub const HELPER_SIZE: u64 = 98_556_358;
pub const IGDB_SIZE: u64 = 270_419;
/// Endereço, SHA-256, tamanho e onde cada pacote fica dentro da pasta do Playnite.
const PACKAGES: [(&str, &str, u64, &str); 4] = [
    (
        "https://github.com/JosefNemec/Playnite/releases/download/10.63/10.63.7z",
        "9af9a0db330c97879697beac9f819c16f9f544e712261a83fa4e62a8f9a2c787",
        PLAYNITE_SIZE,
        "",
    ),
    (
        "https://github.com/Mike-Aniki/Aniki-ReMake/releases/download/v3.6.0/Aniki_ReMake_bb8728bd-ac83-4324-88b1-ee5c586527d1_3_6_0.pthm",
        "21a3757a0cffce8006831503192083ba3ed14247616a4a0548f7c1fabd226dd7",
        ANIKI_SIZE,
        "Themes/Fullscreen/Aniki_ReMake_bb8728bd-ac83-4324-88b1-ee5c586527d1",
    ),
    (
        "https://github.com/Mike-Aniki/AnikiHelper/releases/download/v1.7.0/AnikiHelper_96a983a3-3f13-4dce-a474-4052b718bb52_1_7_0.pext",
        "c0dfb8ce7c3fc4083e7bc6fc74a946dc16af9c9357c83589ab2eda02af21c17e",
        HELPER_SIZE,
        "Extensions/AnikiHelper_96a983a3-3f13-4dce-a474-4052b718bb52",
    ),
    (
        "https://playnite.link/download/extensions/bins/IGDBMetadata_Builtin_2_15.pext",
        "c35896117a1dbefd4e5024fff4562743c48049da2da3f7f3bbc4ca33206164c9",
        IGDB_SIZE,
        "Extensions/IGDBMetadata_Builtin",
    ),
];
const DOWNLOAD_LIMIT: u64 = 400 * 1024 * 1024;
/// O Playnite tem arquivos grandes (o navegador embutido): o limite é por arquivo e pelo total.
const FILE_LIMIT: u64 = 512 * 1024 * 1024;
const EXTRACT_LIMIT: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;
const REPORT_STEP: u64 = 2 * 1024 * 1024;
const MARKER: &str = ".playtrove-aniki";
const SEVEN_ZIP_SIGNATURE: [u8; 6] = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];

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
    /// Qual dos pacotes está sendo baixado (1 a `steps`; 0 parado).
    pub step: u8,
    pub steps: u8,
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

pub type Fetched = Result<(Box<dyn Read + Send>, Option<u64>), String>;
pub type Fetch<'a> = &'a dyn Fn(&str) -> Fetched;

/// De onde vem um pacote; os testes do app trocam pelos de um servidor local.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackageSource {
    pub url: String,
    pub sha256: String,
}

#[derive(Default)]
struct Progress {
    installing: bool,
    phase: Option<Phase>,
    received: u64,
    total: u64,
    step: u8,
}

pub struct AnikiPack {
    root: PathBuf,
    sources: Vec<PackageSource>,
    progress: Mutex<Progress>,
    cancel: AtomicBool,
}

impl AnikiPack {
    pub fn new(root: PathBuf) -> Self {
        let sources = match &test_mode().aniki_packages {
            Some(sources) => sources.clone(),
            None => PACKAGES
                .iter()
                .map(|(url, sha256, _, _)| PackageSource { url: url.to_string(), sha256: sha256.to_string() })
                .collect(),
        };
        Self::with_sources(root, sources)
    }

    fn with_sources(root: PathBuf, sources: Vec<PackageSource>) -> Self {
        AnikiPack { root, sources, progress: Mutex::new(Progress::default()), cancel: AtomicBool::new(false) }
    }

    fn progress(&self) -> MutexGuard<'_, Progress> {
        self.progress.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn folder(&self) -> PathBuf {
        self.root.join("aniki")
    }

    fn playnite_dir(&self) -> PathBuf {
        self.folder().join("playnite")
    }

    pub fn playnite_exe(&self) -> PathBuf {
        self.playnite_dir().join("Playnite.FullscreenApp.exe")
    }

    /// Os dados do Playnite (`--userdatadir`), separados da biblioteca do Playtrove.
    pub fn data_dir(&self) -> PathBuf {
        self.folder().join("data")
    }

    /// A marca guarda os hashes dos pacotes: trocar uma versão pede outra instalação.
    fn marker(&self) -> String {
        self.sources.iter().map(|source| source.sha256.as_str()).collect::<Vec<_>>().join(",")
    }

    pub fn installed(&self) -> bool {
        std::fs::read_to_string(self.playnite_dir().join(MARKER)).is_ok_and(|marker| marker == self.marker())
    }

    fn theme_dir(&self) -> Option<PathBuf> {
        self.installed().then(|| self.playnite_dir().join(PACKAGES[1].3)).and_then(|directory| directory.canonicalize().ok())
    }

    /// Uma mídia do tema instalado; nomes com `..` ou fora da pasta do tema não são entregues.
    fn asset_file(&self, relative: &str) -> Option<PathBuf> {
        mime(relative)?;
        if relative.split('/').any(|part| part.is_empty() || part == "." || part == ".." || part.contains('\\')) {
            return None;
        }
        let directory = self.theme_dir()?;
        let file = directory.join(relative).canonicalize().ok()?;
        (file.starts_with(&directory) && file.is_file()).then_some(file)
    }

    pub fn status(&self) -> AnikiPackStatus {
        let installed = self.installed();
        let progress = self.progress();
        AnikiPackStatus {
            version: ANIKI_VERSION,
            size: PACKAGES.iter().map(|package| package.2).sum(),
            installed,
            installing: progress.installing,
            phase: progress.phase,
            received: progress.received,
            total: progress.total,
            step: progress.step,
            steps: self.sources.len() as u8,
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
            *progress = Progress { installing: true, ..Progress::default() };
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
        let download = root.join(format!("aniki-download.{suffix}"));
        let staging = root.join(format!("aniki-playnite.{suffix}"));
        let result = (|| {
            std::fs::create_dir(&staging)?;
            let mut budget = Budget::default();
            for (index, source) in self.sources.iter().enumerate() {
                {
                    let mut progress = self.progress();
                    *progress = Progress {
                        installing: true,
                        phase: Some(Phase::Download),
                        received: 0,
                        total: PACKAGES.get(index).map_or(0, |package| package.2),
                        step: index as u8 + 1,
                    };
                }
                report(self.status());
                self.download(fetch, source, &download, report)?;
                self.progress().phase = Some(Phase::Extract);
                report(self.status());
                let target = staging.join(PACKAGES.get(index).map_or("", |package| package.3));
                extract(&download, &target, &self.cancel, &mut budget)?;
                std::fs::remove_file(&download)?;
            }
            // A marca vai por último: uma pasta sem ela é uma instalação que não terminou.
            std::fs::write(staging.join(MARKER), self.marker())?;
            let target = self.playnite_dir();
            if target.exists() {
                std::fs::remove_dir_all(&target)?;
            }
            std::fs::create_dir_all(self.folder())?;
            std::fs::rename(&staging, &target)?;
            Ok(())
        })();
        let _ = std::fs::remove_file(&download);
        if result.is_err() {
            let _ = std::fs::remove_dir_all(&staging);
        }
        result
    }

    fn download(
        &self,
        fetch: Fetch<'_>,
        source: &PackageSource,
        path: &Path,
        report: &dyn Fn(AnikiPackStatus),
    ) -> Result<(), InstallError> {
        let (mut reader, length) = fetch(&source.url).map_err(|_| InstallError::Download)?;
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
        if format!("{:x}", hash.finalize()) != source.sha256 {
            return Err(InstallError::Integrity);
        }
        Ok(())
    }

    /// Apaga o Playnite e os dados dele (a configuração volta ao tema Playtrove em quem chama).
    pub fn remove(&self) -> Result<(), InstallError> {
        if self.progress().installing {
            return Err(InstallError::Busy);
        }
        if self.folder().exists() {
            std::fs::remove_dir_all(self.folder())?;
        }
        Ok(())
    }

    /// O primeiro uso do Playnite fica feito (o assistente que vale é o do Aniki), no idioma do Playtrove,
    /// com a busca de metadados ao importar e o Aniki como tema da tela cheia. O resto do que o Playnite
    /// já gravou no arquivo fica como está.
    pub fn write_playnite_config(&self, language: Language) -> std::io::Result<()> {
        let data = self.data_dir();
        std::fs::create_dir_all(&data)?;
        let library = data.join("library");
        let language = match language {
            Language::PtBr => "pt_BR",
            Language::En => "en_US",
        };
        merge_json(
            &data.join("config.json"),
            serde_json::json!({
                "FirstTimeWizardComplete": true,
                "Language": language,
                "DatabasePath": library.to_string_lossy(),
                "DownloadMetadataOnImport": true,
            }),
        )?;
        merge_json(&data.join("fullscreenConfig.json"), serde_json::json!({ "Theme": THEME_ID }))
    }
}

fn merge_json(path: &Path, values: serde_json::Value) -> std::io::Result<()> {
    let mut current = std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text.trim_start_matches('\u{feff}')).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    if let (Some(current), Some(values)) = (current.as_object_mut(), values.as_object()) {
        for (key, value) in values {
            current.insert(key.clone(), value.clone());
        }
    }
    std::fs::write(path, serde_json::to_vec_pretty(&current)?)
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

/// O que todos os pacotes juntos já extraíram.
#[derive(Default)]
struct Budget {
    entries: usize,
    bytes: u64,
}

impl Budget {
    fn add(&mut self, size: u64) -> Result<(), InstallError> {
        self.entries += 1;
        self.bytes += size;
        if self.entries > MAX_ENTRIES || size > FILE_LIMIT || self.bytes > EXTRACT_LIMIT {
            return Err(InstallError::Integrity);
        }
        Ok(())
    }
}

/// Um caminho de dentro do pacote, só com partes normais (nada de `..`, raiz ou letra de disco).
fn enclosed(name: &str) -> Option<PathBuf> {
    let path = Path::new(name);
    let inside = !name.is_empty() && path.components().all(|part| matches!(part, std::path::Component::Normal(_)));
    inside.then(|| path.to_path_buf())
}

/// O Playnite vem em .7z; o tema e os complementos, em .zip (.pthm e .pext).
fn extract(archive: &Path, target: &Path, cancel: &AtomicBool, budget: &mut Budget) -> Result<(), InstallError> {
    let mut signature = [0u8; 6];
    let is_seven_zip = File::open(archive)?.read_exact(&mut signature).is_ok() && signature == SEVEN_ZIP_SIGNATURE;
    std::fs::create_dir_all(target)?;
    if is_seven_zip { extract_seven_zip(archive, target, cancel, budget) } else { extract_zip(archive, target, cancel, budget) }
}

fn write_entry(target: &Path, relative: &Path, reader: &mut dyn Read, size: u64) -> Result<(), InstallError> {
    let destination = target.join(relative);
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut output = OpenOptions::new().write(true).create_new(true).open(&destination)?;
    let copied = std::io::copy(&mut reader.take(FILE_LIMIT + 1), &mut output)?;
    if copied > FILE_LIMIT || copied != size {
        return Err(InstallError::Integrity);
    }
    Ok(())
}

fn extract_zip(archive: &Path, target: &Path, cancel: &AtomicBool, budget: &mut Budget) -> Result<(), InstallError> {
    let mut zip = zip::ZipArchive::new(BufReader::new(File::open(archive)?)).map_err(|_| InstallError::Integrity)?;
    for index in 0..zip.len() {
        if cancel.load(Ordering::SeqCst) {
            return Err(InstallError::Cancelled);
        }
        let mut entry = zip.by_index(index).map_err(|_| InstallError::Integrity)?;
        let relative = entry.enclosed_name().ok_or(InstallError::Integrity)?;
        if entry.is_dir() {
            continue;
        }
        if entry.is_symlink() {
            return Err(InstallError::Integrity);
        }
        budget.add(entry.size())?;
        let size = entry.size();
        write_entry(target, &relative, &mut entry, size)?;
    }
    Ok(())
}

fn extract_seven_zip(archive: &Path, target: &Path, cancel: &AtomicBool, budget: &mut Budget) -> Result<(), InstallError> {
    let mut reader =
        sevenz_rust2::ArchiveReader::open(archive, sevenz_rust2::Password::empty()).map_err(|_| InstallError::Integrity)?;
    let mut failure = None;
    let result = reader.for_each_entries(|entry, data| {
        let step = (|| {
            if cancel.load(Ordering::SeqCst) {
                return Err(InstallError::Cancelled);
            }
            let relative = enclosed(&entry.name.replace('\\', "/")).ok_or(InstallError::Integrity)?;
            if entry.is_directory || entry.is_anti_item {
                return Ok(());
            }
            budget.add(entry.size)?;
            write_entry(target, &relative, data, entry.size)
        })();
        match step {
            Ok(()) => Ok(true),
            Err(error) => {
                failure = Some(error);
                Ok(false)
            }
        }
    });
    if let Some(error) = failure {
        return Err(error);
    }
    result.map_err(|_| InstallError::Integrity)
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

/// O download de verdade, pelas páginas oficiais (o GitHub redireciona para o armazenamento dele).
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
    use crate::i18n::Language;
    use crate::test_support::temp_folder;

    fn archive(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, content) in files {
            zip.start_file(*name, SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)).unwrap();
            zip.write_all(content).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    /// O formato do pacote do Playnite.
    fn seven_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = sevenz_rust2::ArchiveWriter::new(Cursor::new(Vec::new())).unwrap();
        for (name, content) in files {
            writer.push_archive_entry(sevenz_rust2::ArchiveEntry::new_file(name), Some(Cursor::new(content.to_vec()))).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    /// Os quatro pacotes de mentira: o Playnite (.7z), o tema, o Helper e o IGDB (.zip).
    fn packages() -> Vec<Vec<u8>> {
        vec![
            seven_zip(&[
                ("Playnite.FullscreenApp.exe", b"exe"),
                ("Playnite.DesktopApp.exe", b"exe"),
                ("Localization/pt_BR.xaml", b"<x/>"),
            ]),
            archive(&[("theme.yaml", b"Id: Aniki"), ("Images/Back.png", b"png"), ("Views/Main.xaml", b"<xaml/>")]),
            archive(&[("extension.yaml", b"Id: AnikiHelper"), ("AnikiHelper.dll", b"dll")]),
            archive(&[("extension.yaml", b"Id: IGDBMetadata_Builtin"), ("IGDBMetadata.dll", b"dll")]),
        ]
    }

    /// Serve os pacotes da memória; `wrong` troca o hash esperado de um deles.
    fn fake(name: &str, bytes: Vec<Vec<u8>>, wrong: Option<usize>) -> (AnikiPack, PathBuf, impl Fn(&str) -> Fetched) {
        let root = temp_folder(name);
        let sources = bytes
            .iter()
            .enumerate()
            .map(|(index, content)| PackageSource {
                url: format!("https://servidor.test/{index}"),
                sha256: if wrong == Some(index) { "0".repeat(64) } else { format!("{:x}", Sha256::digest(content)) },
            })
            .collect();
        let pack = AnikiPack::with_sources(root.clone(), sources);
        let fetch = move |url: &str| -> Fetched {
            let index: usize = url.trim_start_matches("https://servidor.test/").parse().unwrap();
            let content = bytes[index].clone();
            let length = content.len() as u64;
            Ok((Box::new(Cursor::new(content)), Some(length)))
        };
        (pack, root, fetch)
    }

    fn request(path: &str) -> Request<Vec<u8>> {
        Request::builder().uri(format!("http://playtrove-theme.localhost/{path}")).body(Vec::new()).unwrap()
    }

    #[test]
    fn instala_os_quatro_pacotes_e_marca_por_ultimo() {
        let (pack, root, fetch) = fake("aniki-quatro", packages(), None);
        let steps = Mutex::new(Vec::new());
        pack.install(&fetch, &|status| steps.lock().unwrap().push((status.step, status.steps))).unwrap();
        assert!(pack.installed());
        let playnite = root.join("aniki").join("playnite");
        assert_eq!(pack.playnite_exe(), playnite.join("Playnite.FullscreenApp.exe"));
        assert!(pack.playnite_exe().is_file());
        // O tema vai inteiro (o Playnite precisa do XAML), não só as mídias.
        assert!(playnite.join("Themes/Fullscreen").join(THEME_ID).join("theme.yaml").is_file());
        assert!(playnite.join("Themes/Fullscreen").join(THEME_ID).join("Views/Main.xaml").is_file());
        assert!(playnite.join("Extensions").join(HELPER_ID).join("extension.yaml").is_file());
        assert!(playnite.join("Extensions/IGDBMetadata_Builtin/extension.yaml").is_file());
        assert_eq!(pack.data_dir(), root.join("aniki").join("data"));
        // Só a pasta do Aniki fica: os downloads e a pasta temporária somem.
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        let steps = steps.into_inner().unwrap();
        assert!(steps.contains(&(1, 4)) && steps.contains(&(4, 4)));

        pack.remove().unwrap();
        assert!(!pack.installed());
        assert!(!root.join("aniki").exists());
    }

    #[test]
    fn hash_errado_em_qualquer_pacote_nao_instala() {
        let (pack, root, fetch) = fake("aniki-hash", packages(), Some(2));
        assert_eq!(pack.install(&fetch, &|_| {}), Err(InstallError::Integrity));
        assert!(!pack.installed());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        assert!(!pack.status().installing);
    }

    #[test]
    fn caminho_fora_da_pasta_no_zip_e_recusado() {
        let mut bytes = packages();
        bytes[1] = archive(&[("theme.yaml", b"Id: Aniki"), ("../fora.png", b"png")]);
        let (pack, root, fetch) = fake("aniki-fora", bytes, None);
        assert_eq!(pack.install(&fetch, &|_| {}), Err(InstallError::Integrity));
        assert!(!pack.installed());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        assert!(!root.parent().unwrap().join("fora.png").exists());
    }

    #[test]
    fn caminho_fora_da_pasta_no_7z_e_recusado() {
        let mut bytes = packages();
        bytes[0] = seven_zip(&[("Playnite.FullscreenApp.exe", b"exe"), ("../fora.exe", b"exe")]);
        let (pack, root, fetch) = fake("aniki-fora-7z", bytes, None);
        assert_eq!(pack.install(&fetch, &|_| {}), Err(InstallError::Integrity));
        assert!(!pack.installed());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        assert!(!root.parent().unwrap().join("fora.exe").exists());
    }

    #[test]
    fn cancelar_no_meio_apaga_os_temporarios() {
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
        let mut bytes = packages();
        bytes[1] = archive(&[("theme.yaml", b"Id: Aniki"), ("Images/Back.png", &noise)]);
        let (pack, root, fetch) = fake("aniki-cancelar", bytes, None);
        // Um pedido de cancelar antigo não vale para a próxima instalação; este chega no meio do tema.
        pack.cancel();
        let cancel = |status: AnikiPackStatus| {
            if status.step == 2 && status.received > 0 {
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
    fn config_do_playnite_segue_o_idioma_e_guarda_o_resto() {
        let (pack, _root, fetch) = fake("aniki-config", packages(), None);
        pack.install(&fetch, &|_| {}).unwrap();
        std::fs::create_dir_all(pack.data_dir()).unwrap();
        // O Playnite grava o arquivo com BOM e com as escolhas dele.
        std::fs::write(pack.data_dir().join("config.json"), "\u{feff}{\"GridItemWidth\": 240, \"Language\": \"pt_BR\"}").unwrap();
        pack.write_playnite_config(Language::En).unwrap();
        let read = |name: &str| -> serde_json::Value {
            let text = std::fs::read_to_string(pack.data_dir().join(name)).unwrap();
            serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap()
        };
        let config = read("config.json");
        assert_eq!(config["Language"], "en_US");
        assert_eq!(config["FirstTimeWizardComplete"], true);
        assert_eq!(config["DownloadMetadataOnImport"], true);
        assert_eq!(config["GridItemWidth"], 240);
        assert_eq!(config["DatabasePath"], pack.data_dir().join("library").to_string_lossy().as_ref());
        assert_eq!(read("fullscreenConfig.json")["Theme"], THEME_ID);
        pack.write_playnite_config(Language::PtBr).unwrap();
        assert_eq!(read("config.json")["Language"], "pt_BR");
    }

    #[test]
    fn serve_as_midias_do_tema_instalado_e_nada_fora_dele() {
        let (pack, _root, fetch) = fake("aniki-midias", packages(), None);
        pack.install(&fetch, &|_| {}).unwrap();
        let response = asset_response(&pack, request("aniki/Images/Back.png"));
        assert_eq!((response.status(), response.body().as_slice()), (StatusCode::OK, b"png".as_slice()));
        for invalid in [
            "aniki/../x.png",
            "aniki/Images/../../x.png",
            "aniki/Images//Back.png",
            "aniki/Images%5CBack.png",
            "aniki/Views/Main.xaml",
            "aniki/Images/Nada.png",
            "outro/Images/Back.png",
        ] {
            assert_eq!(asset_response(&pack, request(invalid)).status(), StatusCode::NOT_FOUND, "{invalid}");
        }
    }

    #[test]
    fn status_mostra_os_quatro_pacotes_oficiais() {
        let status = AnikiPack::new(temp_folder("aniki-status")).status();
        assert_eq!((status.version, status.installed, status.installing, status.steps), ("3.6.0", false, false, 4));
        assert_eq!(status.size, PLAYNITE_SIZE + ANIKI_SIZE + HELPER_SIZE + IGDB_SIZE);
    }
}
