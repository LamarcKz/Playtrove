//! Busca conservadora de música tema por título e plataforma, sem conversão de áudio.

use std::ffi::OsString;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Deserialize;
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

use super::trailer_downloader::{VerifiedYoutubeTools, isolated_args, promote_media, temporary_media_path, validate_video_id};

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_AUDIO_BYTES: u64 = 32 * 1024 * 1024;
const MAX_SEARCH_BYTES: u64 = 1024 * 1024;
const SEARCH_RESULTS: usize = 5;

pub trait ThemeDownloader: Send + Sync {
    fn download(&self, title: &str, platform: Option<&str>, destination: &Path) -> Result<bool, String>;
}

pub struct YoutubeThemeDownloader {
    tools_dir: PathBuf,
}

impl YoutubeThemeDownloader {
    pub fn new(tools_dir: PathBuf) -> Self {
        Self { tools_dir }
    }
}

impl ThemeDownloader for YoutubeThemeDownloader {
    fn download(&self, title: &str, platform: Option<&str>, destination: &Path) -> Result<bool, String> {
        validate_request(title, platform, destination)?;
        let deadline = Instant::now() + DOWNLOAD_TIMEOUT;
        let tools = VerifiedYoutubeTools::prepare(&self.tools_dir, deadline)?;
        download_with(title, platform, destination, tools.deno(), deadline, |args, output, deadline, limit| {
            tools.run(args, output, deadline, limit)
        })
    }
}

fn search_args(deno: &Path, title: &str, platform: Option<&str>) -> Vec<OsString> {
    let mut args = isolated_args(deno, "youtube,youtube:search");
    let platform = platform.filter(|value| !value.trim().is_empty()).map(|value| format!(" {value}")).unwrap_or_default();
    args.extend([
        "--flat-playlist".into(),
        "--playlist-end".into(),
        SEARCH_RESULTS.to_string().into(),
        "--skip-download".into(),
        "--print".into(),
        "%(.{id,title,duration,_type,ie_key,live_status})j".into(),
        "--".into(),
        format!("ytsearch{SEARCH_RESULTS}:{title}{platform} main theme soundtrack").into(),
    ]);
    args
}

fn audio_args(deno: &Path, video_id: &str) -> Vec<OsString> {
    let mut args = isolated_args(deno, "youtube");
    args.extend([
        "--max-filesize".into(),
        MAX_AUDIO_BYTES.to_string().into(),
        "--match-filters".into(),
        "duration > 0 & duration <= 600 & !is_live".into(),
        "--output".into(),
        "-".into(),
        "--format".into(),
        "bestaudio[ext=m4a][acodec^=mp4a][protocol=https]".into(),
        "--".into(),
        format!("https://www.youtube.com/watch?v={video_id}").into(),
    ]);
    args
}

#[derive(Deserialize)]
struct Candidate {
    id: String,
    title: String,
    duration: Option<f64>,
    #[serde(rename = "_type")]
    kind: Option<String>,
    ie_key: Option<String>,
    live_status: Option<String>,
}

fn choose_candidate(bytes: &[u8], title: &str, platform: Option<&str>) -> Result<Option<String>, String> {
    if bytes.len() as u64 > MAX_SEARCH_BYTES {
        return Err("resposta da busca de música acima do limite".into());
    }
    let game = tokens(title);
    if game.is_empty() {
        return Ok(None);
    }
    let platform = platform.map(platform_variants).unwrap_or_default();
    let mut best = None;
    let mut best_score = 0;
    for line in bytes.split(|byte| *byte == b'\n').filter(|line| !line.iter().all(u8::is_ascii_whitespace)).take(SEARCH_RESULTS) {
        let candidate: Candidate = serde_json::from_slice(line).map_err(|_| "resposta da busca de música inválida")?;
        let Some(score) = candidate_score(&candidate, &game, &platform) else { continue };
        if score > best_score {
            best_score = score;
            best = Some(candidate.id);
        }
    }
    Ok(best)
}

fn candidate_score(candidate: &Candidate, game: &[String], platform: &[Vec<String>]) -> Option<u8> {
    if validate_video_id(&candidate.id).is_err()
        || candidate.duration.is_none_or(|duration| !duration.is_finite() || duration <= 0.0 || duration > 600.0)
        || candidate.kind.as_deref().is_some_and(|kind| !matches!(kind, "url" | "video"))
        || candidate.ie_key.as_deref().is_some_and(|key| key != "Youtube")
        || candidate.live_status.as_deref().is_some_and(|status| !matches!(status, "not_live" | "was_live"))
    {
        return None;
    }
    let mut words = tokens(&candidate.title);
    let position = words.windows(game.len()).position(|part| part == game)?;
    words.drain(position..position + game.len());
    let mut matched_platform = false;
    for variant in platform {
        while let Some(position) = words.windows(variant.len()).position(|part| part == variant) {
            words.drain(position..position + variant.len());
            matched_platform = true;
        }
    }
    if !words.iter().any(|word| matches!(word.as_str(), "main" | "theme" | "title" | "menu")) {
        return None;
    }
    // Exigir só descritores conhecidos fora do nome evita escolher outra sequência,
    // subtítulo, arranjo ou coletânea. Uma busca incerta termina sem associação.
    if words.iter().any(|word| {
        !matches!(
            word.as_str(),
            "main"
                | "theme"
                | "title"
                | "menu"
                | "screen"
                | "opening"
                | "music"
                | "soundtrack"
                | "ost"
                | "original"
                | "official"
                | "audio"
                | "hd"
                | "hq"
                | "game"
                | "version"
        )
    }) {
        return None;
    }
    Some(1 + u8::from(matched_platform) * 2 + u8::from(words.iter().any(|word| word == "main")))
}

fn tokens(value: &str) -> Vec<String> {
    value
        .nfd()
        .filter(|character| !is_combining_mark(*character))
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(|word| {
            match word {
                "i" => "1",
                "ii" => "2",
                "iii" => "3",
                "iv" => "4",
                "v" => "5",
                "vi" => "6",
                "vii" => "7",
                "viii" => "8",
                "ix" => "9",
                "x" => "10",
                _ => word,
            }
            .to_string()
        })
        .collect()
}

fn platform_variants(platform: &str) -> Vec<Vec<String>> {
    let compact = tokens(platform).join("");
    let aliases: &[&str] = match compact.as_str() {
        "playstation" | "ps1" | "psx" => &["PlayStation", "PS1", "PSX"],
        "playstation2" | "ps2" => &["PlayStation 2", "PS2"],
        "playstation3" | "ps3" => &["PlayStation 3", "PS3"],
        "playstationportable" | "psp" => &["PlayStation Portable", "PSP"],
        "nintendogamecube" | "gamecube" | "ngc" | "gc" => &["Nintendo GameCube", "GameCube", "NGC", "GC"],
        "nintendowii" | "wii" => &["Nintendo Wii", "Wii"],
        "gameboyadvance" | "nintendogameboyadvance" | "gba" => &["Game Boy Advance", "Nintendo Game Boy Advance", "GBA"],
        "nintendo3ds" | "3ds" => &["Nintendo 3DS", "3DS"],
        "supernintendo" | "snes" => &["Super Nintendo", "SNES"],
        _ => return vec![tokens(platform)].into_iter().filter(|words| !words.is_empty()).collect(),
    };
    aliases.iter().map(|alias| tokens(alias)).collect()
}

fn validate_request(title: &str, platform: Option<&str>, destination: &Path) -> Result<(), String> {
    if title.trim().is_empty()
        || title.len() > 512
        || title.chars().any(char::is_control)
        || platform.is_some_and(|value| value.len() > 128 || value.chars().any(char::is_control))
    {
        return Err("nome ou plataforma inválidos para a busca de música".into());
    }
    if !destination.is_absolute()
        || destination.extension().is_none_or(|extension| extension != "m4a")
        || std::fs::symlink_metadata(destination).is_ok()
        || destination.parent().is_none_or(|parent| !parent.is_dir())
    {
        return Err("destino da música inválido".into());
    }
    Ok(())
}

fn download_with(
    title: &str,
    platform: Option<&str>,
    destination: &Path,
    deno: &Path,
    deadline: Instant,
    mut run: impl FnMut(&[OsString], File, Instant, u64) -> Result<(), String>,
) -> Result<bool, String> {
    validate_request(title, platform, destination)?;
    check_deadline(deadline)?;
    let search_path = temporary_media_path(destination);
    let audio_path = temporary_media_path(destination);
    let mut created_search = false;
    let mut created_audio = false;
    let result = (|| {
        let search = create_output(&search_path)?;
        created_search = true;
        run(&search_args(deno, title, platform), search, deadline, MAX_SEARCH_BYTES)?;
        check_deadline(deadline)?;
        let mut bytes = Vec::new();
        File::open(&search_path)
            .map_err(|_| "busca de música não recebida")?
            .take(MAX_SEARCH_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "falha ao ler a busca de música")?;
        let Some(id) = choose_candidate(&bytes, title, platform)? else { return Ok(false) };
        let audio = create_output(&audio_path)?;
        created_audio = true;
        run(&audio_args(deno, &id), audio, deadline, MAX_AUDIO_BYTES)?;
        let mut downloaded = File::open(&audio_path).map_err(|_| "música não recebida")?;
        if downloaded.metadata().map_err(|_| "música inacessível")?.len() > MAX_AUDIO_BYTES {
            return Err("música acima do limite de tamanho".into());
        }
        let mut signature = [0; 12];
        downloaded.read_exact(&mut signature).map_err(|_| "música incompleta")?;
        if &signature[4..8] != b"ftyp"
            || !matches!(&signature[8..12], b"M4A " | b"isom" | b"iso2" | b"iso5" | b"iso6" | b"mp41" | b"mp42" | b"dash")
        {
            return Err("a música recebida não é M4A".into());
        }
        drop(downloaded);
        check_deadline(deadline)?;
        promote_media(&audio_path, destination)?;
        Ok(true)
    })();
    if created_search {
        let _ = std::fs::remove_file(search_path);
    }
    if created_audio {
        let _ = std::fs::remove_file(audio_path);
    }
    result
}

fn check_deadline(deadline: Instant) -> Result<(), String> {
    if Instant::now() >= deadline { Err("tempo de download da música esgotado".into()) } else { Ok(()) }
}

fn create_output(path: &Path) -> Result<File, String> {
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "não foi possível criar o arquivo da música".into())
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::io::Write;
    use std::path::Path;
    use std::time::Instant;

    use super::*;
    use crate::test_support::temp_folder;

    fn candidate(id: &str, title: &str, duration: serde_json::Value) -> String {
        serde_json::json!({"id":id,"title":title,"duration":duration,"_type":"url","ie_key":"Youtube"}).to_string()
    }

    #[test]
    fn a_busca_mantem_consulta_literal_e_nao_herda_configuracoes() {
        let title = "Shadow Quest 2\" --exec calc.exe";
        let args = search_args(Path::new(r"D:\Ferramentas de teste\deno.exe"), title, Some("PS2"));
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
            "--flat-playlist",
        ] {
            assert!(args.iter().any(|arg| arg == flag), "{flag}");
        }
        let value = |flag: &str| args[args.iter().position(|arg| arg == flag).unwrap() + 1].to_string_lossy().into_owned();
        assert_eq!(value("--use-extractors"), "youtube,youtube:search");
        assert_eq!(value("--playlist-end"), "5");
        assert_eq!(args[args.len() - 2], "--");
        assert_eq!(args.last().unwrap(), &OsString::from(format!("ytsearch5:{title} PS2 main theme soundtrack")));
        assert!(!args.iter().any(|arg| arg == "--exec"));
    }

    #[test]
    fn escolhe_o_jogo_a_sequencia_e_a_plataforma_corretos() {
        let lines = [
            candidate("WrongGame01", "Shadow Quest 3 Main Theme PS2", 120.into()),
            candidate("OtherGame01", "Shadow Quest 2 Other Adventure Main Theme", 120.into()),
            candidate("NoPlatform1", "Shadow Quest II - Main Theme", 120.into()),
            candidate("RightGame01", "Shadow Quest 2 - Main Theme (PS2) OST", 120.into()),
        ]
        .join("\n");
        assert_eq!(choose_candidate(lines.as_bytes(), "Shadow Quest 2", Some("PS2")).unwrap().as_deref(), Some("RightGame01"));
    }

    #[test]
    fn covers_remixes_albuns_playlists_ids_e_duracoes_inseguros_nao_sao_candidatos() {
        for (title, duration) in [
            ("Shadow Quest Main Theme Cover", 120.into()),
            ("Shadow Quest Main Theme Remix", 120.into()),
            ("Shadow Quest Complete Soundtrack Album Main Theme", 120.into()),
            ("Shadow Quest Main Theme", 601.into()),
            ("Shadow Quest Main Theme", 0.into()),
            ("Shadow Quest Main Theme", serde_json::Value::Null),
            ("Different Game Main Theme", 120.into()),
            ("Shadow Quest Battle Music", 120.into()),
        ] {
            let line = candidate("Abc_1234-XY", title, duration);
            assert_eq!(choose_candidate(line.as_bytes(), "Shadow Quest", None).unwrap(), None, "{title}");
        }
        for line in [
            candidate("../not-safe", "Shadow Quest Main Theme", 120.into()),
            serde_json::json!({"id":"Abc_1234-XY","title":"Shadow Quest Main Theme","duration":120,"_type":"playlist"})
                .to_string(),
        ] {
            assert_eq!(choose_candidate(line.as_bytes(), "Shadow Quest", None).unwrap(), None);
        }
        assert!(choose_candidate(&vec![b'x'; 1024 * 1024 + 1], "Shadow Quest", None).is_err());
        assert!(choose_candidate(b"not-json", "Shadow Quest", None).is_err());
    }

    #[test]
    fn download_pede_apenas_m4a_aac_nativo_com_tamanho_e_duracao_limitados() {
        let args = audio_args(Path::new(r"D:\Ferramentas\deno.exe"), "Abc_1234-XY");
        let value = |flag: &str| args[args.iter().position(|arg| arg == flag).unwrap() + 1].to_string_lossy().into_owned();
        assert_eq!(value("--format"), "bestaudio[ext=m4a][acodec^=mp4a][protocol=https]");
        assert_eq!(value("--max-filesize"), "33554432");
        assert_eq!(value("--match-filters"), "duration > 0 & duration <= 600 & !is_live");
        assert_eq!(value("--downloader"), "native");
        assert_eq!(value("--fixup"), "never");
        assert_eq!(value("--output"), "-");
        assert!(!args.iter().any(|arg| arg == "--extract-audio" || arg == "--audio-format"));
        assert_eq!(args.last().unwrap(), "https://www.youtube.com/watch?v=Abc_1234-XY");
    }

    #[test]
    fn ausencia_de_candidato_retorna_false_sem_gravar_audio() {
        let root = temp_folder("tema-ausente");
        let destination = root.join("tema.m4a");
        let mut calls = 0;
        let result = download_with(
            "Shadow Quest",
            None,
            &destination,
            Path::new(r"D:\Tools\deno.exe"),
            Instant::now() + DOWNLOAD_TIMEOUT,
            |_, _, _, limit| {
                calls += 1;
                assert_eq!(limit, 1024 * 1024);
                Ok(())
            },
        );
        assert_eq!(result, Ok(false));
        assert_eq!(calls, 1);
        assert!(!destination.exists());
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 0);
    }

    #[test]
    fn busca_e_audio_compartilham_prazo_e_promovem_apenas_m4a_valido() {
        let root = temp_folder("tema-download");
        let destination = root.join("tema.m4a");
        let deadline = Instant::now() + DOWNLOAD_TIMEOUT;
        let mut calls = 0;
        let result = download_with(
            "Shadow Quest",
            None,
            &destination,
            Path::new(r"D:\Tools\deno.exe"),
            deadline,
            |_, mut output, process_deadline, limit| {
                calls += 1;
                assert_eq!(process_deadline, deadline);
                if calls == 1 {
                    assert_eq!(limit, 1024 * 1024);
                    output.write_all(candidate("Abc_1234-XY", "Shadow Quest Main Theme", 120.into()).as_bytes()).unwrap();
                } else {
                    assert_eq!(limit, 32 * 1024 * 1024);
                    output.write_all(b"0000ftypM4A ").unwrap();
                }
                Ok(())
            },
        );
        assert_eq!(result, Ok(true));
        assert_eq!(calls, 2);
        assert_eq!(std::fs::read(&destination).unwrap(), b"0000ftypM4A ");
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 1);
    }

    #[test]
    fn busca_limitada_nao_considera_um_sexto_resultado() {
        let mut lines = (0..5).map(|_| candidate("WrongGame01", "Different Game Main Theme", 120.into())).collect::<Vec<_>>();
        lines.push(candidate("RightGame01", "Shadow Quest Main Theme", 120.into()));
        assert_eq!(choose_candidate(lines.join("\n").as_bytes(), "Shadow Quest", None).unwrap(), None);
        let alias = candidate("RightGame01", "Shadow Quest II Title Screen (PlayStation 2)", 120.into());
        assert_eq!(choose_candidate(alias.as_bytes(), "Shadow Quest 2", Some("PS2")).unwrap().as_deref(), Some("RightGame01"));
        assert_eq!(choose_candidate(alias.as_bytes(), "Shadow Quest", Some("PS2")).unwrap(), None);
    }

    #[test]
    fn prazo_esgotado_nao_inicia_busca_e_destinos_invalidos_nao_iniciam_processos() {
        let root = temp_folder("tema-prazo");
        let destination = root.join("tema.m4a");
        let past = Instant::now() - Duration::from_secs(1);
        let mut calls = 0;
        assert!(
            download_with("Shadow Quest", None, &destination, Path::new(r"D:\Tools\deno.exe"), past, |_, _, _, _| {
                calls += 1;
                Ok(())
            })
            .is_err()
        );
        assert_eq!(calls, 0);
        for (title, target) in
            [("", destination.clone()), ("Shadow Quest", root.join("tema.mp3")), ("Shadow Quest", PathBuf::from("tema.m4a"))]
        {
            assert!(
                download_with(
                    title,
                    None,
                    &target,
                    Path::new(r"D:\Tools\deno.exe"),
                    Instant::now() + DOWNLOAD_TIMEOUT,
                    |_, _, _, _| panic!("destino inválido não executa ferramenta")
                )
                .is_err()
            );
        }
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 0);
    }

    #[test]
    fn falhas_midia_invalida_e_excesso_de_bytes_removem_os_parciais() {
        let root = temp_folder("tema-falhas");
        for mode in ["process", "invalid", "large", "concurrent"] {
            let destination = root.join(format!("{mode}.m4a"));
            let mut calls = 0;
            assert!(
                download_with(
                    "Shadow Quest",
                    None,
                    &destination,
                    Path::new(r"D:\Tools\deno.exe"),
                    Instant::now() + DOWNLOAD_TIMEOUT,
                    |_, mut output, _, _| {
                        calls += 1;
                        if calls == 1 {
                            output.write_all(candidate("Abc_1234-XY", "Shadow Quest Main Theme", 120.into()).as_bytes()).unwrap();
                            return Ok(());
                        }
                        match mode {
                            "process" => return Err("falha simulada".into()),
                            "invalid" => output.write_all(b"isto nao e audio").unwrap(),
                            "large" => output.set_len(32 * 1024 * 1024 + 1).unwrap(),
                            "concurrent" => {
                                output.write_all(b"0000ftypM4A ").unwrap();
                                std::fs::write(&destination, b"arquivo concorrente").unwrap();
                            }
                            _ => unreachable!(),
                        }
                        Ok(())
                    }
                )
                .is_err(),
                "{mode}"
            );
            if mode == "concurrent" {
                assert_eq!(std::fs::read(&destination).unwrap(), b"arquivo concorrente");
                std::fs::remove_file(destination).unwrap();
            } else {
                assert!(!destination.exists());
            }
            assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        }
    }

    #[test]
    fn aceita_as_marcas_iso_bmff_usadas_no_m4a_nativo() {
        let root = temp_folder("tema-marcas");
        for brand in [b"M4A ", b"isom", b"iso2", b"iso5", b"iso6", b"mp41", b"mp42", b"dash"] {
            let destination = root.join(format!("{}.m4a", String::from_utf8_lossy(brand).trim()));
            let mut calls = 0;
            assert_eq!(
                download_with(
                    "Shadow Quest",
                    None,
                    &destination,
                    Path::new(r"D:\Tools\deno.exe"),
                    Instant::now() + DOWNLOAD_TIMEOUT,
                    |_, mut output, _, _| {
                        calls += 1;
                        if calls == 1 {
                            output.write_all(candidate("Abc_1234-XY", "Shadow Quest Main Theme", 120.into()).as_bytes()).unwrap();
                        } else {
                            output.write_all(b"0000ftyp").unwrap();
                            output.write_all(brand).unwrap();
                        }
                        Ok(())
                    }
                ),
                Ok(true),
                "{brand:?}"
            );
        }
    }
}
