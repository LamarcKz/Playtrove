//! Os troféus que o RPCS3 guarda de cada jogo de PS3, em
//! <pasta do RPCS3>/dev_hdd0/home/<usuário>/trophy/<conjunto>/ (ex.: NPWR01234_00):
//! - TROPCONF.SFM: a lista dos troféus (XML), já no idioma escolhido no RPCS3;
//! - TROPUSR.DAT: o que o usuário pegou e quando (binário);
//! - TROP000.PNG, TROP001.PNG...: a imagem de cada troféu.
//!
//! O app só lê: quem desbloqueia é o próprio RPCS3, durante o jogo.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::UNIX_EPOCH;

use chrono::{DateTime, Duration, TimeZone, Utc};
use regex::Regex;

use super::types::TrophyGrade;
use crate::dates::iso;

/// O código de um conjunto de troféus do PS3 (ex.: NPWR01234_00).
pub fn is_trophy_set_id(value: &str) -> bool {
    static SET_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z]{4}\d{5}_\d{2}$").expect("expressão fixa"));
    SET_ID.is_match(value)
}

#[derive(Clone, Debug, PartialEq)]
pub struct TrophyDefinition {
    pub id: i64,
    pub name: String,
    pub detail: String,
    pub grade: TrophyGrade,
    pub hidden: bool,
    /// O pacote extra (DLC) do troféu, ou None para o jogo principal.
    pub group: Option<String>,
}

#[derive(Debug, PartialEq)]
pub struct TrophySetDefinition {
    pub title: String,
    pub trophies: Vec<TrophyDefinition>,
}

/// Os troféus pegos: o id e quando (ISO), ou None se o RPCS3 não guardou uma data que faça sentido.
pub type TrophyUnlocks = HashMap<i64, Option<String>>;

/// Um conjunto instalado pelo RPCS3, com a "assinatura" dos arquivos (muda quando eles mudam).
pub struct InstalledTrophySet {
    pub id: String,
    pub dir: PathBuf,
    pub stamp: String,
}

// ---------------------------------------------------------------- onde ficam

/// A pasta de troféus do usuário ativo do RPCS3. O usuário vem de GuiConfigs/persistent_settings.dat
/// ([Users] active_user; o padrão é 00000001) e o disco interno (dev_hdd0), do config/vfs.yml, quando ele
/// foi mudado de lugar.
pub fn find_trophy_dir(rpcs3_exe: &Path, read_text: &dyn Fn(&Path) -> Option<String>) -> PathBuf {
    let root = rpcs3_exe.parent().unwrap_or(Path::new("."));
    let user = active_user(read_text(&root.join("GuiConfigs").join("persistent_settings.dat")).as_deref())
        .unwrap_or_else(|| "00000001".into());
    hdd0_dir(root, read_text(&root.join("config").join("vfs.yml")).as_deref()).join("home").join(user).join("trophy")
}

/// Lê um arquivo de texto (None se não der).
pub fn read_text_file(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

/// O usuário ativo (8 dígitos) do persistent_settings.dat, que é um INI do Qt.
fn active_user(settings: Option<&str>) -> Option<String> {
    static USER: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"(?m)^\[Users\][^\[]*?^active_user\s*=\s*"?(\d{8})"?\s*$"#).expect("expressão fixa"));
    USER.captures(settings?).map(|captures| captures[1].to_string())
}

/// A pasta do dev_hdd0: a do vfs.yml (com $(EmulatorDir) = a pasta do RPCS3) ou a padrão.
fn hdd0_dir(root: &Path, vfs: Option<&str>) -> PathBuf {
    let value = |key: &str| -> Option<String> {
        let prefix = format!("{key}:");
        let line = vfs?.lines().find(|line| line.trim_start().starts_with(&prefix))?;
        let raw = line[line.find(&prefix)? + prefix.len()..].trim();
        let unquoted = ['"', '\'']
            .iter()
            .find_map(|quote| raw.strip_prefix(*quote).and_then(|rest| rest.strip_suffix(*quote)))
            .unwrap_or(raw);
        Some(unquoted.to_string())
    };
    let Some(configured) = value("/dev_hdd0/").filter(|path| !path.is_empty()) else {
        return root.join("dev_hdd0");
    };
    let emulator_dir =
        value("$(EmulatorDir)").filter(|dir| !dir.is_empty()).unwrap_or_else(|| format!("{}/", root.to_string_lossy()));
    let path = PathBuf::from(configured.replace("$(EmulatorDir)", &emulator_dir));
    if path.is_absolute() { path } else { root.join(path) }
}

/// Os conjuntos de troféus instalados (as pastas NPWR..., com a lista de troféus dentro).
pub fn list_trophy_sets(trophy_dir: &Path) -> Vec<InstalledTrophySet> {
    let stamp_of = |path: &Path| match std::fs::metadata(path) {
        Ok(metadata) => {
            let modified = metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok());
            let millis = modified.map_or(0, |duration| (duration.as_nanos() as f64 / 1_000_000.0).round() as u64);
            format!("{}:{millis}", metadata.len())
        }
        Err(_) => "-".into(),
    };
    let Ok(entries) = std::fs::read_dir(trophy_dir) else { return Vec::new() };
    entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| {
            let id = entry.file_name().to_string_lossy().into_owned();
            let dir = entry.path();
            (is_trophy_set_id(&id) && dir.join("TROPCONF.SFM").exists()).then(|| {
                let stamp = format!("{}|{}", stamp_of(&dir.join("TROPCONF.SFM")), stamp_of(&dir.join("TROPUSR.DAT")));
                InstalledTrophySet { id, dir, stamp }
            })
        })
        .collect()
}

/// Lê um conjunto instalado: a lista de troféus e os que foram pegos (sem TROPUSR.DAT, nenhum).
pub fn read_trophy_set(set: &InstalledTrophySet, now: DateTime<Utc>) -> Result<(TrophySetDefinition, TrophyUnlocks), String> {
    let conf = std::fs::read_to_string(set.dir.join("TROPCONF.SFM")).map_err(|error| error.to_string())?;
    let usr = set.dir.join("TROPUSR.DAT");
    let unlocks =
        if usr.exists() { parse_trop_usr(&std::fs::read(usr).map_err(|error| error.to_string())?, now)? } else { HashMap::new() };
    Ok((parse_trop_conf(&conf), unlocks))
}

/// O arquivo da imagem de um troféu na pasta do conjunto (TROP007.PNG).
pub fn trophy_icon_file(set_dir: &Path, trophy_id: i64) -> PathBuf {
    set_dir.join(format!("TROP{trophy_id:03}.PNG"))
}

// ---------------------------------------------------------------- TROPCONF.SFM

/// A lista de troféus (TROPCONF.SFM): o nome do jogo, os pacotes extras (<group>) e cada <trophy>, com o
/// tipo (ttype: P, G, S ou B), se é oculto e o pacote (gid).
pub fn parse_trop_conf(text: &str) -> TrophySetDefinition {
    static GROUP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<group\b([^>]*)>(.*?)</group>").expect("expressão fixa"));
    static TROPHY: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?s)<trophy\b([^>]*)>(.*?)</trophy>").expect("expressão fixa"));
    let xml = text.trim_start_matches('\u{feff}');
    let groups: HashMap<String, String> = GROUP
        .captures_iter(xml)
        .filter_map(|captures| Some((attribute(&captures[1], "id")?, element(&captures[2], "name")?)))
        .collect();
    let mut trophies: Vec<TrophyDefinition> = TROPHY
        .captures_iter(xml)
        .filter_map(|captures| {
            let attributes = &captures[1];
            let id = attribute(attributes, "id")?.parse::<i64>().ok().filter(|id| *id >= 0)?;
            let grade = match attribute(attributes, "ttype")?.to_uppercase().as_str() {
                "P" => TrophyGrade::Platina,
                "G" => TrophyGrade::Ouro,
                "S" => TrophyGrade::Prata,
                "B" => TrophyGrade::Bronze,
                _ => return None,
            };
            Some(TrophyDefinition {
                id,
                name: element(&captures[2], "name").unwrap_or_default(),
                detail: element(&captures[2], "detail").unwrap_or_default(),
                grade,
                hidden: attribute(attributes, "hidden").is_some_and(|hidden| hidden.to_lowercase().starts_with('y')),
                group: attribute(attributes, "gid").filter(|gid| !gid.is_empty()).and_then(|gid| groups.get(&gid).cloned()),
            })
        })
        .collect();
    trophies.sort_by_key(|trophy| trophy.id);
    TrophySetDefinition { title: element(xml, "title-name").unwrap_or_default(), trophies }
}

fn attribute(attributes: &str, name: &str) -> Option<String> {
    let pattern = Regex::new(&format!(r#"\b{}\s*=\s*"([^"]*)""#, regex::escape(name))).ok()?;
    pattern.captures(attributes).map(|captures| decode_xml(&captures[1]))
}

/// O texto de um elemento (o primeiro com esse nome), sem espaços sobrando.
fn element(xml: &str, name: &str) -> Option<String> {
    static CDATA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<!\[CDATA\[(.*?)\]\]>").expect("expressão fixa"));
    let pattern = Regex::new(&format!(r"(?s)<{0}\b[^>]*>(.*?)</{0}>", regex::escape(name))).ok()?;
    let content = pattern.captures(xml)?.get(1)?.as_str().to_string();
    let text = CDATA.replace_all(&content, "$1");
    Some(decode_xml(&text).split_whitespace().collect::<Vec<_>>().join(" "))
}

fn decode_xml(text: &str) -> String {
    static NUMERIC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)&#(x[0-9a-f]+|\d+);").expect("expressão fixa"));
    let numeric = NUMERIC.replace_all(text, |captures: &regex::Captures| {
        let code = &captures[1];
        let value = match code.strip_prefix(['x', 'X']) {
            Some(hex) => u32::from_str_radix(hex, 16).ok(),
            None => code.parse::<u32>().ok(),
        };
        value.and_then(char::from_u32).map(String::from).unwrap_or_default()
    });
    numeric.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

// ---------------------------------------------------------------- TROPUSR.DAT

/// Microssegundos entre 0001-01-01 e 1970-01-01: o relógio do PS3 conta desde o ano 1 (UTC).
const TICK_EPOCH: u64 = 62_135_596_800_000_000;

/// O que foi pego (TROPUSR.DAT): um cabeçalho (marca 0x818F54AD e quantas tabelas), as tabelas e, na
/// tabela 6, um registro por troféu com o id, se foi pego e quando.
pub fn parse_trop_usr(buffer: &[u8], now: DateTime<Utc>) -> Result<TrophyUnlocks, String> {
    let u32_at =
        |offset: usize| buffer.get(offset..offset + 4).map(|bytes| u32::from_be_bytes(bytes.try_into().unwrap_or_default()));
    let u64_at =
        |offset: usize| buffer.get(offset..offset + 8).map(|bytes| u64::from_be_bytes(bytes.try_into().unwrap_or_default()));
    if buffer.len() < 48 || u32_at(0) != Some(0x818f_54ad) {
        return Err("não é um TROPUSR.DAT".into());
    }
    let mut unlocks = HashMap::new();
    let tables = u32_at(8).unwrap_or(0) as usize;
    for table in 0..tables {
        let header = 48 + table * 32;
        if header + 32 > buffer.len() {
            break;
        }
        if u32_at(header) != Some(6) {
            continue;
        }
        // O tamanho de cada registro não conta os 16 bytes do começo dele.
        let entry_size = u32_at(header + 4).unwrap_or(0) as usize + 16;
        let count = u32_at(header + 12).unwrap_or(0) as usize;
        let offset = u64_at(header + 16).unwrap_or(0) as usize;
        for entry in 0..count {
            let start = offset + entry * entry_size;
            if start + 48 > buffer.len() {
                break;
            }
            if u32_at(start + 20) == Some(0) {
                continue;
            }
            let id = i64::from(u32_at(start + 16).unwrap_or(0));
            unlocks.insert(id, tick_to_iso(u64_at(start + 32).unwrap_or(0), now));
        }
    }
    Ok(unlocks)
}

/// A data de um "tick" do PS3 (microssegundos desde 0001-01-01, UTC), ou None se não fizer sentido.
pub fn tick_to_iso(tick: u64, now: DateTime<Utc>) -> Option<String> {
    if tick <= TICK_EPOCH {
        return None;
    }
    let millis = i64::try_from((tick - TICK_EPOCH) / 1000).ok()?;
    let date = DateTime::from_timestamp_millis(millis)?;
    // Antes do lançamento do PS3 ou depois de amanhã: o relógio do emulador estava errado.
    let launch = Utc.with_ymd_and_hms(2006, 11, 1, 0, 0, 0).single()?;
    (date >= launch && date <= now + Duration::days(1)).then(|| iso(date))
}

#[cfg(test)]
pub mod fake {
    //! Troféus de PS3 de mentira, como o RPCS3 guarda (os mesmos de tests/fakeTrophies.ts).

    use super::*;

    pub struct FakeTrophy {
        pub id: i64,
        pub name: &'static str,
        pub detail: &'static str,
        /// P = platina, G = ouro, S = prata, B = bronze.
        pub grade: char,
        pub hidden: bool,
        /// O id do pacote extra (DLC).
        pub group: Option<&'static str>,
    }

    fn escape(text: &str) -> String {
        text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
    }

    /// O TROPCONF.SFM (XML), como o RPCS3 deixa depois de instalar os troféus do jogo.
    pub fn build_trop_conf(id: &str, title: &str, trophies: &[FakeTrophy], groups: &[(&str, &str)]) -> String {
        let mut lines = vec![
            "<!--Sce-Np-Trophy-Signature: 00000000-->".to_string(),
            "<trophyconf version=\"1.1\">".into(),
            format!(" <npcommid>{id}</npcommid>"),
            " <trophyset-version>01.00</trophyset-version>".into(),
            format!(" <title-name>{}</title-name>", escape(title)),
            format!(" <title-detail>{}</title-detail>", escape(title)),
        ];
        for (group, name) in groups {
            lines.push(format!(" <group id=\"{group}\">\n  <name>{0}</name>\n  <detail>{0}</detail>\n </group>", escape(name)));
        }
        for trophy in trophies {
            let gid = trophy.group.map(|group| format!(" gid=\"{group}\"")).unwrap_or_default();
            lines.push(format!(
                " <trophy id=\"{:03}\" hidden=\"{}\" ttype=\"{}\" pid=\"{}\"{gid}>\n  <name>{}</name>\n  <detail>{}</detail>\n </trophy>",
                trophy.id,
                if trophy.hidden { "yes" } else { "no" },
                trophy.grade,
                if trophy.grade == 'P' { -1 } else { 0 },
                escape(trophy.name),
                escape(trophy.detail),
            ));
        }
        lines.push("</trophyconf>".into());
        lines.join("\n")
    }

    /// A data no relógio do PS3.
    pub fn to_tick(date: DateTime<Utc>) -> u64 {
        date.timestamp_millis() as u64 * 1000 + TICK_EPOCH
    }

    /// O TROPUSR.DAT: o cabeçalho, as tabelas 4 (o tipo de cada troféu) e 6 (se foi pego e quando), no
    /// mesmo formato do RPCS3. `unlocked` diz quando cada troféu foi pego.
    pub fn build_trop_usr(count: usize, unlocked: &[(i64, DateTime<Utc>)]) -> Vec<u8> {
        let (entry4, entry6) = (0x50 + 16, 0x60 + 16);
        let offset4 = 48 + 2 * 32;
        let offset6 = offset4 + count * entry4;
        let mut file = vec![0u8; offset6 + count * entry6];
        let put32 = |file: &mut Vec<u8>, at: usize, value: u32| file[at..at + 4].copy_from_slice(&value.to_be_bytes());
        put32(&mut file, 0, 0x818f_54ad);
        put32(&mut file, 4, 0x0001_0000);
        put32(&mut file, 8, 2);
        for (index, (kind, size, offset)) in [(4u32, 0x50u32, offset4), (6, 0x60, offset6)].into_iter().enumerate() {
            let header = 48 + index * 32;
            put32(&mut file, header, kind);
            put32(&mut file, header + 4, size);
            put32(&mut file, header + 8, 1);
            put32(&mut file, header + 12, count as u32);
            file[header + 16..header + 24].copy_from_slice(&(offset as u64).to_be_bytes());
        }
        for id in 0..count {
            let start4 = offset4 + id * entry4;
            put32(&mut file, start4, 4);
            put32(&mut file, start4 + 4, 0x50);
            put32(&mut file, start4 + 8, id as u32);
            put32(&mut file, start4 + 16, id as u32);
            put32(&mut file, start4 + 24, 0xffff_ffff);
            let start6 = offset6 + id * entry6;
            put32(&mut file, start6, 6);
            put32(&mut file, start6 + 4, 0x60);
            put32(&mut file, start6 + 8, id as u32);
            put32(&mut file, start6 + 16, id as u32);
            if let Some((_, date)) = unlocked.iter().find(|(trophy, _)| *trophy == id as i64) {
                put32(&mut file, start6 + 20, 1);
                file[start6 + 32..start6 + 40].copy_from_slice(&to_tick(*date).to_be_bytes());
                file[start6 + 40..start6 + 48].copy_from_slice(&to_tick(*date).to_be_bytes());
            }
        }
        file
    }

    /// Os troféus do jogo de mentira dos testes (Manobras Radicais 3).
    pub fn trophies() -> Vec<FakeTrophy> {
        vec![
            FakeTrophy {
                id: 0,
                name: "Lenda das Pistas",
                detail: "Pegue todos os outros troféus.",
                grade: 'P',
                hidden: false,
                group: None,
            },
            FakeTrophy {
                id: 1,
                name: "Primeira manobra",
                detail: "Faça a sua primeira manobra.",
                grade: 'B',
                hidden: false,
                group: None,
            },
            FakeTrophy {
                id: 2,
                name: "Rei do half-pipe",
                detail: "Vença o campeonato de half-pipe.",
                grade: 'S',
                hidden: false,
                group: None,
            },
            FakeTrophy {
                id: 3,
                name: "Segredo da cidade",
                detail: "Ache a pista escondida.",
                grade: 'G',
                hidden: true,
                group: None,
            },
            FakeTrophy {
                id: 4,
                name: "Pico nevado",
                detail: "Vença na montanha.",
                grade: 'B',
                hidden: false,
                group: Some("001"),
            },
        ]
    }

    pub const SET: &str = "NPWR99999_00";

    pub fn conf() -> String {
        build_trop_conf(SET, "Manobras Radicais 3", &trophies(), &[("001", "Pacote Montanha & Neve")])
    }
}

#[cfg(test)]
mod tests {
    use super::fake::*;
    use super::*;

    fn date(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn tropconf_nome_do_jogo_tipo_ocultos_e_o_pacote_extra() {
        let set = parse_trop_conf(&format!("\u{feff}{}", conf()));
        assert_eq!(set.title, "Manobras Radicais 3");
        let grades: Vec<(i64, TrophyGrade)> = set.trophies.iter().map(|trophy| (trophy.id, trophy.grade)).collect();
        assert_eq!(
            grades,
            [
                (0, TrophyGrade::Platina),
                (1, TrophyGrade::Bronze),
                (2, TrophyGrade::Prata),
                (3, TrophyGrade::Ouro),
                (4, TrophyGrade::Bronze)
            ]
        );
        assert_eq!(
            (set.trophies[3].name.as_str(), set.trophies[3].hidden, set.trophies[3].group.clone()),
            ("Segredo da cidade", true, None)
        );
        assert_eq!(set.trophies[4].detail, "Vença na montanha.");
        assert_eq!(set.trophies[4].group.as_deref(), Some("Pacote Montanha & Neve"));
    }

    #[test]
    fn tropusr_os_trofeus_pegos_e_quando() {
        let when = date("2026-09-20T21:30:00.000Z");
        let unlocks = parse_trop_usr(&build_trop_usr(5, &[(1, when), (2, when + Duration::minutes(1))]), Utc::now()).unwrap();
        assert_eq!(unlocks.len(), 2);
        assert_eq!(unlocks[&1].as_deref(), Some("2026-09-20T21:30:00.000Z"));
        assert_eq!(unlocks[&2].as_deref(), Some("2026-09-20T21:31:00.000Z"));
        assert!(parse_trop_usr(b"nao e um TROPUSR", Utc::now()).is_err());
    }

    #[test]
    fn datas_que_nao_fazem_sentido_ficam_sem_data() {
        let now = date("2026-09-24T12:00:00.000Z");
        assert_eq!(tick_to_iso(0, now), None);
        assert_eq!(tick_to_iso(to_tick(date("1999-01-01T00:00:00Z")), now), None);
        assert_eq!(tick_to_iso(to_tick(date("2030-01-01T00:00:00Z")), now), None);
        assert_eq!(tick_to_iso(to_tick(date("2026-09-24T11:00:00Z")), now).as_deref(), Some("2026-09-24T11:00:00.000Z"));
    }

    #[test]
    fn a_pasta_dos_trofeus_o_usuario_ativo_e_o_dev_hdd0_do_vfs() {
        let root = PathBuf::from(r"C:\Emuladores\RPCS3");
        let exe = root.join("rpcs3.exe");
        let settings = root.join("GuiConfigs").join("persistent_settings.dat");
        let vfs = root.join("config").join("vfs.yml");
        let files = |map: Vec<(PathBuf, &'static str)>| {
            move |path: &Path| map.iter().find(|(file, _)| file == path).map(|(_, text)| text.to_string())
        };

        assert_eq!(find_trophy_dir(&exe, &files(vec![])), root.join("dev_hdd0").join("home").join("00000001").join("trophy"));
        assert_eq!(
            find_trophy_dir(&exe, &files(vec![(settings, "[Playtime]\nBLUS30100=60000\n\n[Users]\nactive_user=00000002\n")])),
            root.join("dev_hdd0").join("home").join("00000002").join("trophy")
        );
        assert_eq!(
            find_trophy_dir(&exe, &files(vec![(vfs.clone(), "$(EmulatorDir): \"\"\n/dev_hdd0/: D:/PS3/hdd0/\n")])),
            PathBuf::from(r"D:\PS3\hdd0\home\00000001\trophy")
        );
        assert_eq!(
            find_trophy_dir(&exe, &files(vec![(vfs, "$(EmulatorDir): \"\"\n/dev_hdd0/: $(EmulatorDir)outro_hdd0/\n")])),
            root.join("outro_hdd0").join("home").join("00000001").join("trophy")
        );
    }
}
