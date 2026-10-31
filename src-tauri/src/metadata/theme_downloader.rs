//! Busca conservadora de música tema por título e plataforma, sem conversão de áudio.

use std::collections::HashSet;
use std::ffi::OsString;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{
    OnceLock,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

use super::trailer_downloader::{VerifiedYoutubeTools, isolated_args, promote_media, temporary_media_path, validate_video_id};

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_AUDIO_BYTES: u64 = 32 * 1024 * 1024;
const MAX_SEARCH_BYTES: u64 = 1024 * 1024;
const SEARCH_RESULTS: usize = 10;
const MAX_QUERIES: usize = 3;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCandidate {
    pub video_id: String,
    pub title: String,
    pub channel: Option<String>,
    pub duration: Option<f64>,
    pub view_count: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSearchResult {
    pub candidates: Vec<ThemeCandidate>,
    pub automatic_video_id: Option<String>,
}

pub trait ThemeDownloader: Send + Sync {
    fn search(&self, title: &str, platform: Option<&str>, query: Option<&str>) -> Result<ThemeSearchResult, String>;
    fn download_video(&self, video_id: &str, destination: &Path, cancel: &AtomicBool) -> Result<(), String>;
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
    fn search(&self, title: &str, platform: Option<&str>, query: Option<&str>) -> Result<ThemeSearchResult, String> {
        validate_search(title, platform, query)?;
        let deadline = Instant::now() + DOWNLOAD_TIMEOUT;
        let tools = VerifiedYoutubeTools::prepare(&self.tools_dir, deadline)?;
        search_with(&self.tools_dir, title, platform, query, tools.deno(), deadline, |args, output, deadline, limit| {
            tools.run(args, output, deadline, limit)
        })
    }

    fn download_video(&self, video_id: &str, destination: &Path, cancel: &AtomicBool) -> Result<(), String> {
        validate_video_id(video_id)?;
        validate_destination(destination)?;
        check_cancel(cancel)?;
        let deadline = Instant::now() + DOWNLOAD_TIMEOUT;
        let tools = VerifiedYoutubeTools::prepare(&self.tools_dir, deadline)?;
        download_video_with(video_id, destination, cancel, tools.deno(), deadline, |args, output, deadline, limit| {
            tools.run_cancelable(args, output, deadline, limit, cancel)
        })
    }
}

fn query_args(deno: &Path, query: &str) -> Vec<OsString> {
    let mut args = isolated_args(deno, "youtube,youtube:search");
    args.extend([
        "--flat-playlist".into(),
        "--playlist-end".into(),
        SEARCH_RESULTS.to_string().into(),
        "--skip-download".into(),
        "--print".into(),
        "%(.{id,title,channel,uploader,duration,view_count,_type,ie_key,live_status})j".into(),
        "--".into(),
        format!("ytsearch{SEARCH_RESULTS}:{query}").into(),
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
    channel: Option<String>,
    uploader: Option<String>,
    view_count: Option<u64>,
    #[serde(rename = "_type")]
    kind: Option<String>,
    ie_key: Option<String>,
    live_status: Option<String>,
}

#[cfg(test)]
fn choose_candidate(bytes: &[u8], title: &str, platform: Option<&str>) -> Result<Option<String>, String> {
    Ok(classify_candidates(parse_candidates(bytes)?, title, platform, false).automatic_video_id)
}

fn parse_candidates(bytes: &[u8]) -> Result<Vec<ThemeCandidate>, String> {
    if bytes.len() as u64 > MAX_SEARCH_BYTES {
        return Err("resposta da busca de música acima do limite".into());
    }
    let mut candidates = Vec::new();
    for line in bytes.split(|byte| *byte == b'\n').filter(|line| !line.iter().all(u8::is_ascii_whitespace)).take(SEARCH_RESULTS) {
        let candidate: Candidate = serde_json::from_slice(line).map_err(|_| "resposta da busca de música inválida")?;
        if validate_video_id(&candidate.id).is_err()
            || candidate.title.trim().is_empty()
            || candidate.title.len() > 2048
            || candidate.title.chars().any(char::is_control)
            || candidate.duration.is_some_and(|duration| !duration.is_finite() || duration <= 0.0 || duration > 600.0)
            || candidate.kind.as_deref().is_some_and(|kind| !matches!(kind, "url" | "video"))
            || candidate.ie_key.as_deref().is_some_and(|key| key != "Youtube")
            || candidate.live_status.as_deref().is_some_and(|status| !matches!(status, "not_live" | "was_live"))
        {
            continue;
        }
        candidates.push(ThemeCandidate {
            video_id: candidate.id,
            title: candidate.title,
            channel: candidate.channel.or(candidate.uploader).filter(|value| !value.trim().is_empty()),
            duration: candidate.duration,
            view_count: candidate.view_count,
        });
    }
    Ok(candidates)
}

fn candidate_score(candidate: &ThemeCandidate, game: &[String], platform: &[Vec<String>]) -> u8 {
    if game.is_empty() {
        return 0;
    }
    let mut words = tokens(&normalized_title(&candidate.title));
    let Some(position) = words.windows(game.len()).position(|part| part == game) else { return 0 };
    // O sufixo comercial pode aparecer antes dos descritores da faixa no vídeo.
    // Remove só depois da identidade completa: Jade/Amber e números continuam distintos.
    if words.get(position + game.len()).is_some_and(|word| word == "version") {
        words.remove(position + game.len());
    }
    let following = words.get(position + game.len());
    // Um número logo após o nome identifica outra sequência. Fora dele, números de faixa são válidos.
    if following.is_some_and(|word| word.chars().all(|c| c.is_ascii_digit())) {
        return 0;
    }
    let platform_after_game = platform.iter().any(|variant| words[position + game.len()..].starts_with(variant));
    let identity = platform_after_game
        || following.is_none_or(|word| {
            matches!(
                word.as_str(),
                "ost"
                    | "original"
                    | "soundtrack"
                    | "main"
                    | "theme"
                    | "title"
                    | "menu"
                    | "music"
                    | "opening"
                    | "ps1"
                    | "ps2"
                    | "ps3"
                    | "psx"
                    | "psp"
                    | "playstation"
                    | "snes"
                    | "gba"
                    | "gamecube"
                    | "wii"
                    | "nintendo"
            )
        });
    words.drain(position..position + game.len());
    if words.iter().any(|word| {
        matches!(
            word.as_str(),
            "cover"
                | "gameplay"
                | "walkthrough"
                | "commentary"
                | "remix"
                | "arrangement"
                | "arranged"
                | "piano"
                | "orchestra"
                | "orchestral"
                | "medley"
                | "compilation"
                | "complete"
                | "album"
                | "extended"
                | "remaster"
                | "remastered"
                | "remake"
                | "deluxe"
                | "definitive"
                | "edition"
        )
    }) {
        return 0;
    }
    let Some(matched_platform) = consume_platform_aliases(&mut words, platform) else { return 0 };
    let soundtrack = words.iter().any(|word| matches!(word.as_str(), "ost" | "soundtrack"));
    let primary = words.iter().any(|word| matches!(word.as_str(), "main" | "theme" | "title" | "menu" | "opening"));
    if !identity || candidate.duration.is_none() || !(soundtrack || primary) {
        return 0;
    }
    6 + u8::from(primary) * 2 + u8::from(soundtrack) * 2 + u8::from(matched_platform) * 2
}

fn consume_platform_aliases(words: &mut Vec<String>, expected: &[Vec<String>]) -> Option<bool> {
    if expected.is_empty() {
        return Some(false);
    }
    let mut aliases = [
        "PS1",
        "PS2",
        "PS3",
        "PS4",
        "PS5",
        "PSP",
        "GameCube",
        "Wii",
        "GB",
        "GBC",
        "GBA",
        "DS",
        "3DS",
        "SNES",
        "NES",
        "N64",
        "Mega Drive",
    ]
    .into_iter()
    .flat_map(platform_variants)
    .chain(expected.iter().cloned())
    .collect::<Vec<_>>();
    // Reconhece a identidade completa antes de consumir prefixos como PlayStation ou Game Boy.
    aliases.sort_by_key(|alias| std::cmp::Reverse(alias.len()));
    let mut matched = false;
    let mut position = 0;
    while position < words.len() {
        if let Some(alias) = aliases.iter().find(|alias| words[position..].starts_with(alias)) {
            if !expected.contains(alias) {
                return None;
            }
            words.drain(position..position + alias.len());
            matched = true;
        } else {
            position += 1;
        }
    }
    Some(matched)
}

fn classify_candidates(candidates: Vec<ThemeCandidate>, title: &str, platform: Option<&str>, manual: bool) -> ThemeSearchResult {
    let game = tokens(&normalized_title(title));
    let platform = platform.map(platform_variants).unwrap_or_default();
    let mut seen = HashSet::new();
    let mut ranked = candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate.video_id.clone()))
        .take(MAX_QUERIES * SEARCH_RESULTS)
        .map(|candidate| (candidate_score(&candidate, &game, &platform), candidate))
        .collect::<Vec<_>>();
    // Popularidade ordena opções equivalentes, mas não cria confiança nem resolve ambiguidade para instalar.
    ranked.sort_by(|(a_score, a), (b_score, b)| b_score.cmp(a_score).then_with(|| b.view_count.cmp(&a.view_count)));
    let automatic_video_id = ranked
        .first()
        .filter(|(score, _)| !manual && *score >= 8 && ranked.get(1).is_none_or(|(next, _)| *score >= next.saturating_add(2)))
        .map(|(_, candidate)| candidate.video_id.clone());
    ThemeSearchResult { candidates: ranked.into_iter().map(|(_, candidate)| candidate).collect(), automatic_video_id }
}

fn normalized_title(title: &str) -> String {
    static TAGS: OnceLock<regex::Regex> = OnceLock::new();
    let tags = TAGS.get_or_init(|| regex::Regex::new(r"(?i)[\(\[]\s*(?:(?:disc|disk|cd)\s*\d+|(?:v(?:er(?:sion)?)?\.?)\s*\d+(?:\.\d+)*|usa|europe|japan|world|rev\s*[a-z0-9.]+)\s*[\)\]]").unwrap());
    let clean = tags.replace_all(title, " ");
    let mut words = clean.split_whitespace().collect::<Vec<_>>();
    if words.len() > 1 && words.last().is_some_and(|word| word.eq_ignore_ascii_case("version")) {
        words.pop();
    }
    words.join(" ")
}

fn search_queries(title: &str, platform: Option<&str>, query: Option<&str>) -> Vec<String> {
    if let Some(query) = query {
        return vec![query.to_owned()];
    }
    let title = normalized_title(title);
    let platform = platform.filter(|value| !value.trim().is_empty()).map(|value| format!(" {value}")).unwrap_or_default();
    let mut seen = HashSet::new();
    [format!("{title}{platform} OST"), format!("{title} original soundtrack"), format!("{title} main theme")]
        .into_iter()
        .filter(|query| seen.insert(tokens(query)))
        .take(MAX_QUERIES)
        .collect()
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
        "playstation4" | "ps4" => &["PlayStation 4", "PS4"],
        "playstation5" | "ps5" => &["PlayStation 5", "PS5"],
        "playstationportable" | "psp" => &["PlayStation Portable", "PSP"],
        "nintendogamecube" | "gamecube" | "ngc" | "gc" => &["Nintendo GameCube", "GameCube", "NGC", "GC"],
        "nintendowii" | "wii" => &["Nintendo Wii", "Wii"],
        "gameboyadvance" | "nintendogameboyadvance" | "gba" => &["Game Boy Advance", "Nintendo Game Boy Advance", "GBA"],
        "gameboy" | "nintendogameboy" | "gb" => &["Game Boy", "Nintendo Game Boy", "GB"],
        "gameboycolor" | "nintendogameboycolor" | "gbc" => &["Game Boy Color", "Nintendo Game Boy Color", "GBC"],
        "nintendods" | "ds" | "nds" => &["Nintendo DS", "DS", "NDS"],
        "nintendo3ds" | "3ds" => &["Nintendo 3DS", "3DS"],
        "nintendo64" | "n64" => &["Nintendo 64", "Nintendo64", "N64"],
        "megadrive" | "segamegadrive" | "genesis" | "segagenesis" | "md" => {
            &["Mega Drive", "MegaDrive", "Sega Mega Drive", "Genesis", "Sega Genesis", "MD"]
        }
        "nintendoentertainmentsystem" | "nes" | "famicom" => &["Nintendo Entertainment System", "NES", "Famicom"],
        "supernintendo" | "supernintendoentertainmentsystem" | "snes" | "superfamicom" => {
            &["Super Nintendo Entertainment System", "Super Nintendo", "SNES", "Super Famicom"]
        }
        _ => return vec![tokens(platform)].into_iter().filter(|words| !words.is_empty()).collect(),
    };
    aliases.iter().map(|alias| tokens(alias)).collect()
}

fn validate_search(title: &str, platform: Option<&str>, query: Option<&str>) -> Result<(), String> {
    if title.trim().is_empty()
        || title.len() > 512
        || title.chars().any(char::is_control)
        || platform.is_some_and(|value| value.len() > 128 || value.chars().any(char::is_control))
        || query.is_some_and(|value| value.trim().is_empty() || value.len() > 512 || value.chars().any(char::is_control))
    {
        return Err("nome ou plataforma inválidos para a busca de música".into());
    }
    Ok(())
}

fn validate_destination(destination: &Path) -> Result<(), String> {
    if !destination.is_absolute()
        || destination.extension().is_none_or(|extension| extension != "m4a")
        || std::fs::symlink_metadata(destination).is_ok()
        || destination.parent().is_none_or(|parent| !parent.is_dir())
    {
        return Err("destino da música inválido".into());
    }
    Ok(())
}

fn search_with(
    root: &Path,
    title: &str,
    platform: Option<&str>,
    query: Option<&str>,
    deno: &Path,
    deadline: Instant,
    mut run: impl FnMut(&[OsString], File, Instant, u64) -> Result<(), String>,
) -> Result<ThemeSearchResult, String> {
    validate_search(title, platform, query)?;
    let mut candidates = Vec::new();
    for query in search_queries(title, platform, query) {
        check_deadline(deadline)?;
        let path = temporary_media_path(&root.join("music-search.json"));
        let output = create_output(&path)?;
        let result = (|| {
            run(&query_args(deno, &query), output, deadline, MAX_SEARCH_BYTES)?;
            check_deadline(deadline)?;
            let mut bytes = Vec::new();
            File::open(&path)
                .map_err(|_| "busca de música não recebida")?
                .take(MAX_SEARCH_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "falha ao ler a busca de música")?;
            parse_candidates(&bytes)
        })();
        let _ = std::fs::remove_file(&path);
        candidates.extend(result?);
    }
    Ok(classify_candidates(candidates, title, platform, query.is_some()))
}

fn download_video_with(
    video_id: &str,
    destination: &Path,
    cancel: &AtomicBool,
    deno: &Path,
    deadline: Instant,
    mut run: impl FnMut(&[OsString], File, Instant, u64) -> Result<(), String>,
) -> Result<(), String> {
    validate_video_id(video_id)?;
    validate_destination(destination)?;
    check_deadline(deadline)?;
    check_cancel(cancel)?;
    let audio_path = temporary_media_path(destination);
    let mut created_audio = false;
    let result = (|| {
        let audio = create_output(&audio_path)?;
        created_audio = true;
        run(&audio_args(deno, video_id), audio, deadline, MAX_AUDIO_BYTES)?;
        check_cancel(cancel)?;
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
        check_cancel(cancel)?;
        promote_media(&audio_path, destination)?;
        Ok(())
    })();
    if created_audio {
        let _ = std::fs::remove_file(audio_path);
    }
    result
}

fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) { Err("download de música cancelado".into()) } else { Ok(()) }
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
    fn faixa_com_nome_proprio_compositor_numero_e_qualidade_continua_elegivel() {
        let line = candidate("RightGame01", "Shadow Quest II OST - 01 - Dawn of Adventure - Mira Vale [HQ]", 120.into());
        assert_eq!(choose_candidate(line.as_bytes(), "Shadow Quest 2", None).unwrap().as_deref(), Some("RightGame01"));
    }

    #[test]
    fn duas_faixas_proximas_exigem_escolha() {
        let lines = [
            candidate("FirstGame01", "Shadow Quest Main Theme OST", 120.into()),
            candidate("OtherGame01", "Shadow Quest Title Theme OST", 120.into()),
        ]
        .join("\n");
        assert_eq!(choose_candidate(lines.as_bytes(), "Shadow Quest", None).unwrap(), None);
    }

    #[test]
    fn busca_preserva_opcionais_ausentes_e_arranjos_sem_recomendar() {
        let lines = [
            candidate("MissingGame", "Shadow Quest OST - Dawn", serde_json::Value::Null),
            candidate("CoverGame01", "Shadow Quest Main Theme Cover", 120.into()),
        ]
        .join("\n");
        let result = classify_candidates(parse_candidates(lines.as_bytes()).unwrap(), "Shadow Quest", None, false);
        assert_eq!(result.automatic_video_id, None);
        assert_eq!(result.candidates.len(), 2);
        let absent = result.candidates.iter().find(|item| item.video_id == "MissingGame").unwrap();
        assert_eq!(absent.duration, None);
        assert_eq!(absent.channel, None);
        assert_eq!(absent.view_count, None);
        assert!(serde_json::to_value(absent).unwrap()["viewCount"].is_null());
    }

    #[test]
    fn normaliza_disc_version_pontuacao_numerais_e_alias_da_plataforma() {
        let line = candidate("RightGame01", "Shadow: Quest II OST - Main Theme [PlayStation 2]", 120.into());
        assert_eq!(
            choose_candidate(line.as_bytes(), "Shadow Quest 2 (Disc 1) (Version 1.2)", Some("PS2")).unwrap().as_deref(),
            Some("RightGame01")
        );
    }

    #[test]
    fn edicao_e_sequencia_diferentes_nao_ganham_recomendacao() {
        for name in [
            "Shadow Quest II Main Theme",
            "Shadow Quest Remastered Main Theme",
            "Shadow Quest Deluxe Edition OST - Dawn",
            "Shadow Quest Other Adventure Main Theme",
        ] {
            let line = candidate("WrongGame01", name, 120.into());
            assert_eq!(choose_candidate(line.as_bytes(), "Shadow Quest", None).unwrap(), None, "{name}");
        }
        let line = candidate("WrongGame01", "Shadow Quest Main Theme PS3", 120.into());
        assert_eq!(choose_candidate(line.as_bytes(), "Shadow Quest", Some("PS2")).unwrap(), None);
    }

    #[test]
    fn remix_no_nome_do_jogo_nao_e_tratado_como_arranjo() {
        let line = candidate("RightGame01", "Shadow Quest Remix OST - Main Theme", 120.into());
        assert_eq!(choose_candidate(line.as_bytes(), "Shadow Quest Remix", None).unwrap().as_deref(), Some("RightGame01"));
    }

    #[test]
    fn sufixo_comercial_version_nao_exclui_faixa_da_edicao_correta() {
        let line = candidate("RightGame01", "Pocket Creatures Jade OST - Dawn of Adventure", 120.into());
        assert_eq!(
            choose_candidate(line.as_bytes(), "Pocket Creatures Jade Version", None).unwrap().as_deref(),
            Some("RightGame01")
        );
        for wrong in ["Pocket Creatures Amber OST - Dawn of Adventure", "Pocket Creatures Jade 2 OST - Dawn of Adventure"] {
            let line = candidate("WrongGame01", wrong, 120.into());
            assert_eq!(choose_candidate(line.as_bytes(), "Pocket Creatures Jade Version", None).unwrap(), None, "{wrong}");
        }
    }

    #[test]
    fn consultas_automaticas_simplificam_version_sem_perder_edicao_ou_numero() {
        assert_eq!(
            search_queries("Pocket Creatures Jade 2 Version (Disc 1)", Some("GBA"), None),
            [
                "Pocket Creatures Jade 2 GBA OST",
                "Pocket Creatures Jade 2 original soundtrack",
                "Pocket Creatures Jade 2 main theme",
            ]
        );
    }

    #[test]
    fn aliases_longos_da_plataforma_entre_jogo_e_faixa_nao_perdem_identidade() {
        for (platform, alias) in
            [("GBA", "Game Boy Advance"), ("PS2", "PlayStation 2"), ("PSP", "PlayStation Portable"), ("GC", "Nintendo GameCube")]
        {
            let line = candidate("RightGame01", &format!("Shadow Quest {alias} OST - Dawn of Adventure"), 120.into());
            assert_eq!(
                choose_candidate(line.as_bytes(), "Shadow Quest", Some(platform)).unwrap().as_deref(),
                Some("RightGame01"),
                "{alias}"
            );
        }
    }

    #[test]
    fn gameplay_e_fala_nao_vencem_ost_original_mas_continuam_na_revisao() {
        for marker in ["Gameplay", "Walkthrough", "Commentary"] {
            for name in [
                format!("{marker} Shadow Quest PS2 OST Main Theme"),
                format!("Shadow Quest PS2 {marker} OST Main Theme"),
                format!("Shadow Quest PS2 OST Main Theme {marker}"),
            ] {
                let wrong = candidate("WrongGame01", &name, 120.into());
                assert_eq!(choose_candidate(wrong.as_bytes(), "Shadow Quest", Some("PS2")).unwrap(), None, "{name}");
                let lines = format!("{wrong}\n{}", candidate("RightGame01", "Shadow Quest OST - Dawn of Adventure", 120.into()));
                let result = classify_candidates(parse_candidates(lines.as_bytes()).unwrap(), "Shadow Quest", Some("PS2"), false);
                assert_eq!(result.automatic_video_id.as_deref(), Some("RightGame01"), "{name}");
                assert_eq!(result.candidates.len(), 2);
            }
            let name = format!("Shadow {marker} Quest");
            let line = candidate("RightGame01", &format!("{name} OST - Dawn of Adventure"), 120.into());
            assert_eq!(choose_candidate(line.as_bytes(), &name, None).unwrap().as_deref(), Some("RightGame01"));
        }
    }

    #[test]
    fn aliases_de_n64_mega_drive_e_nes_reconhecem_equivalencia_e_conflitos() {
        for family in [
            &["Nintendo 64", "Nintendo64", "N64"][..],
            &["Mega Drive", "MegaDrive", "Sega Mega Drive", "Genesis", "Sega Genesis", "MD"][..],
            &["NES", "Nintendo Entertainment System", "Famicom"][..],
            &["SNES", "Super Nintendo", "Super Nintendo Entertainment System", "Super Famicom"][..],
        ] {
            for requested in family {
                for alias in family {
                    let line = candidate("RightGame01", &format!("Shadow Quest {alias} OST - Dawn"), 120.into());
                    assert_eq!(
                        choose_candidate(line.as_bytes(), "Shadow Quest", Some(requested)).unwrap().as_deref(),
                        Some("RightGame01"),
                        "{requested} versus {alias}"
                    );
                    let wrong = candidate("WrongGame01", &format!("Shadow Quest Main Theme OST ({alias})"), 120.into());
                    assert_eq!(
                        choose_candidate(wrong.as_bytes(), "Shadow Quest", Some("PS2")).unwrap(),
                        None,
                        "PS2 versus {alias}"
                    );
                }
            }
        }
        for (requested, wrong) in [
            ("NES", "Super Famicom"),
            ("NES", "Super Nintendo Entertainment System"),
            ("N64", "Nintendo DS"),
            ("Genesis", "Nintendo64"),
        ] {
            let line = candidate("WrongGame01", &format!("Shadow Quest {wrong} Main Theme OST"), 120.into());
            assert_eq!(
                choose_candidate(line.as_bytes(), "Shadow Quest", Some(requested)).unwrap(),
                None,
                "{requested} versus {wrong}"
            );
        }
    }

    #[test]
    fn aliases_com_prefixos_compartilhados_preservam_a_plataforma_completa() {
        for (requested, wrong) in [
            ("PS1", "PlayStation 2"),
            ("PS1", "PlayStation 3"),
            ("PS1", "PlayStation Portable"),
            ("PlayStation", "PS2"),
            ("PS1", "PlayStation 4"),
            ("PS1", "PlayStation 5"),
            ("GB", "Game Boy Advance"),
            ("GB", "Nintendo Game Boy Color"),
            ("DS", "Nintendo 3DS"),
            ("3DS", "Nintendo DS"),
            ("GBA", "Nintendo Game Boy"),
        ] {
            let line = candidate("WrongGame01", &format!("Shadow Quest {wrong} Main Theme OST"), 120.into());
            assert_eq!(
                choose_candidate(line.as_bytes(), "Shadow Quest", Some(requested)).unwrap(),
                None,
                "{requested} versus {wrong}"
            );
        }
        for (requested, alias) in [
            ("PS1", "PlayStation"),
            ("GBA", "Nintendo Game Boy Advance"),
            ("GB", "Game Boy"),
            ("DS", "Nintendo DS"),
            ("3DS", "Nintendo 3DS"),
        ] {
            let line = candidate("RightGame01", &format!("Shadow Quest {alias} Main Theme OST"), 120.into());
            assert_eq!(
                choose_candidate(line.as_bytes(), "Shadow Quest", Some(requested)).unwrap().as_deref(),
                Some("RightGame01"),
                "{requested} versus {alias}"
            );
        }
        for name in ["Shadow PlayStation 2 Quest", "Pocket Game Boy Advance", "Shadow Nintendo DS"] {
            let line = candidate("RightGame01", &format!("{name} Main Theme OST"), 120.into());
            assert_eq!(choose_candidate(line.as_bytes(), name, Some("PS1")).unwrap().as_deref(), Some("RightGame01"), "{name}");
        }
    }

    #[test]
    fn version_e_tags_na_candidata_sao_normalizados_sem_misturar_edicoes() {
        for game in ["Pocket Creatures Jade Version", "Pocket Creatures Jade"] {
            for name in [
                "Pocket Creatures Jade OST - Dawn of Adventure",
                "Pocket Creatures Jade Version OST - Dawn of Adventure",
                "Pocket Creatures Jade (Version 1.2) (Disc 1) OST - Dawn of Adventure",
                "Pocket Creatures Jade Version (Disc 1) OST - Dawn of Adventure",
            ] {
                let line = candidate("RightGame01", name, 120.into());
                assert_eq!(
                    choose_candidate(line.as_bytes(), game, None).unwrap().as_deref(),
                    Some("RightGame01"),
                    "{game} versus {name}"
                );
            }
            for wrong in [
                "Pocket Creatures Amber Version OST - Dawn",
                "Pocket Creatures Jade 2 Version OST - Dawn",
                "Pocket Creatures Jade Version 2 OST - Dawn",
            ] {
                let line = candidate("WrongGame01", wrong, 120.into());
                assert_eq!(choose_candidate(line.as_bytes(), game, None).unwrap(), None, "{game} versus {wrong}");
            }
        }
    }

    #[test]
    fn busca_manual_literal_nao_instala_e_consultas_limitam_e_deduplicam_ids() {
        let root = temp_folder("tema-consultas");
        let mut queries = Vec::new();
        let result = search_with(
            &root,
            "Shadow Quest",
            Some("PS2"),
            None,
            Path::new(r"D:\Tools\deno.exe"),
            Instant::now() + DOWNLOAD_TIMEOUT,
            |args, mut output, _, _| {
                queries.push(args.last().unwrap().to_string_lossy().into_owned());
                for index in 0..11 {
                    writeln!(output, "{}", candidate(&format!("Track{index:06}"), "Shadow Quest OST - Dawn", 120.into()))
                        .unwrap();
                }
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(queries.len(), 3);
        assert_eq!(result.candidates.len(), 10);
        assert!(!result.candidates.iter().any(|item| item.video_id == "Track000010"));
        let query = "Dawn \" --exec calc.exe";
        queries.clear();
        let result = search_with(
            &root,
            "Shadow Quest",
            None,
            Some(query),
            Path::new(r"D:\Tools\deno.exe"),
            Instant::now() + DOWNLOAD_TIMEOUT,
            |args, mut output, _, _| {
                queries.push(args.last().unwrap().to_string_lossy().into_owned());
                output.write_all(candidate("RightGame01", "Shadow Quest Main Theme", 120.into()).as_bytes()).unwrap();
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(queries, [format!("ytsearch10:{query}")]);
        assert_eq!(result.automatic_video_id, None);
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 0);
    }

    #[test]
    fn a_busca_mantem_consulta_literal_e_nao_herda_configuracoes() {
        let title = "Shadow Quest 2\" --exec calc.exe";
        let args = query_args(Path::new(r"D:\Ferramentas de teste\deno.exe"), &format!("{title} PS2 OST"));
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
        assert_eq!(value("--playlist-end"), "10");
        assert_eq!(args[args.len() - 2], "--");
        assert_eq!(args.last().unwrap(), &OsString::from(format!("ytsearch10:{title} PS2 OST")));
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
    fn cancelamento_antes_e_depois_de_receber_audio_nao_promove_e_remove_parciais() {
        let root = temp_folder("tema-cancelado");
        let destination = root.join("tema.m4a");
        let cancel = AtomicBool::new(true);
        assert!(
            download_video_with(
                "Abc_1234-XY",
                &destination,
                &cancel,
                Path::new(r"D:\Tools\deno.exe"),
                Instant::now() + DOWNLOAD_TIMEOUT,
                |_, _, _, _| panic!("cancelado não inicia processo")
            )
            .is_err()
        );
        cancel.store(false, Ordering::Release);
        let result = download_video_with(
            "Abc_1234-XY",
            &destination,
            &cancel,
            Path::new(r"D:\Tools\deno.exe"),
            Instant::now() + DOWNLOAD_TIMEOUT,
            |_, mut output, _, _| {
                output.write_all(b"0000ftypM4A ").unwrap();
                cancel.store(true, Ordering::Release);
                Ok(())
            },
        );
        assert!(result.unwrap_err().contains("cancelado"));
        assert!(!destination.exists());
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 0);
    }

    #[test]
    fn campos_da_plataforma_oficialidade_e_popularidade_nao_garantem_associacao() {
        let lines = [
            serde_json::json!({"id":"FirstGame01","title":"Shadow Quest OST - Dawn","duration":120,"channel":"Official Studio","channel_is_verified":true,"view_count":9000000}).to_string(),
            serde_json::json!({"id":"OtherGame01","title":"Shadow Quest OST - Night","duration":120,"channel":"Archive","view_count":10}).to_string(),
        ].join("\n");
        let result = classify_candidates(parse_candidates(lines.as_bytes()).unwrap(), "Shadow Quest", None, false);
        assert_eq!(result.automatic_video_id, None);
        assert_eq!(result.candidates[0].view_count, Some(9000000));
        assert_eq!(result.candidates[0].channel.as_deref(), Some("Official Studio"));
    }

    #[test]
    fn busca_invalida_ou_excessiva_limpa_saida_e_nao_consulta_depois_do_prazo() {
        let root = temp_folder("tema-busca-limites");
        for query in [Some(""), Some("com\ncontrole")] {
            assert!(
                search_with(
                    &root,
                    "Shadow Quest",
                    None,
                    query,
                    Path::new(r"D:\Tools\deno.exe"),
                    Instant::now() + DOWNLOAD_TIMEOUT,
                    |_, _, _, _| panic!("consulta inválida não executa ferramenta")
                )
                .is_err()
            );
        }
        for mode in ["excesso", "prazo", "erro"] {
            let deadline =
                if mode == "prazo" { Instant::now() - Duration::from_secs(1) } else { Instant::now() + DOWNLOAD_TIMEOUT };
            assert!(
                search_with(&root, "Shadow Quest", None, None, Path::new(r"D:\Tools\deno.exe"), deadline, |_, output, _, _| {
                    assert_ne!(mode, "prazo");
                    if mode == "erro" {
                        return Err("falha sintética".into());
                    }
                    output.set_len(MAX_SEARCH_BYTES + 1).unwrap();
                    Ok(())
                })
                .is_err()
            );
            assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        }
    }

    #[test]
    fn ausencia_de_candidato_termina_consultas_sem_gravar_audio() {
        let root = temp_folder("tema-ausente");
        let destination = root.join("tema.m4a");
        let mut calls = 0;
        let result = search_with(
            &root,
            "Shadow Quest",
            None,
            None,
            Path::new(r"D:\Tools\deno.exe"),
            Instant::now() + DOWNLOAD_TIMEOUT,
            |_, _, _, limit| {
                calls += 1;
                assert_eq!(limit, 1024 * 1024);
                Ok(())
            },
        );
        assert_eq!(result.unwrap(), ThemeSearchResult { candidates: vec![], automatic_video_id: None });
        assert_eq!(calls, 3);
        assert!(!destination.exists());
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 0);
    }

    #[test]
    fn download_recebe_prazo_e_promove_apenas_m4a_valido() {
        let root = temp_folder("tema-download");
        let destination = root.join("tema.m4a");
        let deadline = Instant::now() + DOWNLOAD_TIMEOUT;
        let mut calls = 0;
        let result = download_video_with(
            "Abc_1234-XY",
            &destination,
            &AtomicBool::new(false),
            Path::new(r"D:\Tools\deno.exe"),
            deadline,
            |_, mut output, process_deadline, limit| {
                calls += 1;
                assert_eq!(process_deadline, deadline);
                assert_eq!(limit, 32 * 1024 * 1024);
                output.write_all(b"0000ftypM4A ").unwrap();
                Ok(())
            },
        );
        assert_eq!(result, Ok(()));
        assert_eq!(calls, 1);
        assert_eq!(std::fs::read(&destination).unwrap(), b"0000ftypM4A ");
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 1);
    }

    #[test]
    fn busca_limitada_nao_considera_um_decimo_primeiro_resultado() {
        let mut lines = (0..10).map(|_| candidate("WrongGame01", "Different Game Main Theme", 120.into())).collect::<Vec<_>>();
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
            download_video_with(
                "Abc_1234-XY",
                &destination,
                &AtomicBool::new(false),
                Path::new(r"D:\Tools\deno.exe"),
                past,
                |_, _, _, _| {
                    calls += 1;
                    Ok(())
                }
            )
            .is_err()
        );
        assert_eq!(calls, 0);
        for (id, target) in [
            ("../bad-id", destination.clone()),
            ("Abc_1234-XY", root.join("tema.mp3")),
            ("Abc_1234-XY", PathBuf::from("tema.m4a")),
        ] {
            assert!(
                download_video_with(
                    id,
                    &target,
                    &AtomicBool::new(false),
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
            assert!(
                download_video_with(
                    "Abc_1234-XY",
                    &destination,
                    &AtomicBool::new(false),
                    Path::new(r"D:\Tools\deno.exe"),
                    Instant::now() + DOWNLOAD_TIMEOUT,
                    |_, mut output, _, _| {
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
            assert_eq!(
                download_video_with(
                    "Abc_1234-XY",
                    &destination,
                    &AtomicBool::new(false),
                    Path::new(r"D:\Tools\deno.exe"),
                    Instant::now() + DOWNLOAD_TIMEOUT,
                    |_, mut output, _, _| {
                        output.write_all(b"0000ftyp").unwrap();
                        output.write_all(brand).unwrap();
                        Ok(())
                    }
                ),
                Ok(()),
                "{brand:?}"
            );
        }
    }
}
