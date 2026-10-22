//! O que o app sabe de cada emulador, a configuração (tabela emulators), a detecção automática, os
//! cores do RetroArch e o comando para abrir um jogo.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::LazyLock;

use regex::{Regex, RegexBuilder};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::library::compare_titles;

/// Os emuladores que o app sabe usar.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EmulatorId {
    Pcsx2,
    Duckstation,
    Retroarch,
    Rpcs3,
    Ppsspp,
    Dolphin,
    Azahar,
}

impl EmulatorId {
    pub fn id(self) -> &'static str {
        match self {
            EmulatorId::Pcsx2 => "pcsx2",
            EmulatorId::Duckstation => "duckstation",
            EmulatorId::Retroarch => "retroarch",
            EmulatorId::Rpcs3 => "rpcs3",
            EmulatorId::Ppsspp => "ppsspp",
            EmulatorId::Dolphin => "dolphin",
            EmulatorId::Azahar => "azahar",
        }
    }

    pub fn from_id(id: &str) -> Option<EmulatorId> {
        PRESETS.iter().map(|preset| preset.id).find(|emulator| emulator.id() == id)
    }
}

/// O que o app sabe sobre cada emulador.
pub struct EmulatorPreset {
    pub id: EmulatorId,
    pub name: &'static str,
    /// Consoles que ele roda, para mostrar na tela (None: vários, um core para cada, como o RetroArch).
    platforms: Option<&'static str>,
    /// Nome do executável, para reconhecer o emulador (ex.: nos atalhos do menu Iniciar), sem diferenciar maiúsculas.
    executable: &'static str,
    /// Onde ele costuma ficar quando é instalado (e não portátil). %VARIÁVEL% vira a variável do Windows.
    common_paths: &'static [&'static str],
    /// Extensões de ROM que ele abre, sem o ponto. No RetroArch elas vêm do core.
    extensions: &'static [&'static str],
    /// Argumentos para abrir uma ROM (e o caminho do core, no RetroArch). O emulador precisa fechar
    /// junto com o jogo, para o app contar o tempo. Nada de forçar tela cheia: vale a configuração de
    /// cada emulador (pedido do usuário em 2026-09-19).
    args: fn(&str, Option<&str>) -> Vec<String>,
    /// Abrir maximizado: depois que o emulador abre, o app maximiza a janela dele (emulator_window.rs).
    /// Só uma janela comum: se ele estiver em tela cheia na configuração dele, fica como está.
    pub maximize: bool,
}

const PRESETS: [EmulatorPreset; 7] = [
    EmulatorPreset {
        id: EmulatorId::Pcsx2,
        name: "PCSX2",
        platforms: Some("PlayStation 2"),
        executable: r"^pcsx2-qt.*\.exe$",
        common_paths: &[r"%ProgramFiles%\PCSX2\pcsx2-qt.exe", r"%LOCALAPPDATA%\Programs\PCSX2\pcsx2-qt.exe"],
        extensions: &["iso", "chd", "cso", "zso", "gz", "bin", "img", "mdf", "nrg", "elf"],
        // -batch: o PCSX2 fecha quando o jogo fecha.
        args: |rom, _| strings(&["-batch", "--", rom]),
        maximize: false,
    },
    EmulatorPreset {
        id: EmulatorId::Duckstation,
        name: "DuckStation",
        platforms: Some("PlayStation"),
        executable: r"^duckstation-(qt|nogui).*\.exe$",
        common_paths: &[
            r"%LOCALAPPDATA%\Programs\DuckStation\duckstation-qt-x64-ReleaseLTCG.exe",
            r"%ProgramFiles%\DuckStation\duckstation-qt-x64-ReleaseLTCG.exe",
        ],
        extensions: &["cue", "chd", "pbp", "m3u", "iso", "img", "ecm", "mds", "bin"],
        // -batch: o DuckStation fecha quando o jogo fecha.
        args: |rom, _| strings(&["-batch", "--", rom]),
        maximize: false,
    },
    EmulatorPreset {
        id: EmulatorId::Retroarch,
        name: "RetroArch",
        platforms: None,
        executable: r"^retroarch\.exe$",
        common_paths: &[
            r"C:\RetroArch-Win64\retroarch.exe",
            r"%ProgramFiles%\RetroArch\retroarch.exe",
            r"%ProgramFiles(x86)%\Steam\steamapps\common\RetroArch\retroarch.exe",
        ],
        extensions: &[],
        // -L: o core que roda o jogo. O RetroArch fecha sozinho quando o jogo fecha.
        args: |rom, core| strings(&["-L", core.unwrap_or_default(), rom]),
        // Abre maximizado, em janela (pedido do usuário em 2026-10-14).
        maximize: true,
    },
    EmulatorPreset {
        id: EmulatorId::Rpcs3,
        name: "RPCS3",
        platforms: Some("PlayStation 3"),
        executable: r"^rpcs3\.exe$",
        common_paths: &[r"%ProgramFiles%\RPCS3\rpcs3.exe", r"%LOCALAPPDATA%\Programs\RPCS3\rpcs3.exe"],
        // Além das ISOs, as pastas de jogo extraídas (PS3_GAME/USRDIR/EBOOT.BIN), achadas pela varredura.
        extensions: &["iso"],
        // --no-gui: só o jogo, sem a lista de jogos do RPCS3, e ele fecha junto com o jogo.
        args: |rom, _| strings(&["--no-gui", rom]),
        maximize: false,
    },
    EmulatorPreset {
        id: EmulatorId::Ppsspp,
        name: "PPSSPP",
        platforms: Some("PlayStation Portable"),
        // Só o de 64 bits (e o de ARM): a pasta do PPSSPP traz também o de 32, PPSSPPWindows.exe.
        executable: r"^ppssppwindows(64|arm64)\.exe$",
        common_paths: &[r"%ProgramFiles%\PPSSPP\PPSSPPWindows64.exe"],
        extensions: &["iso", "cso", "chd", "pbp", "elf"],
        // --pause-menu-exit: o "Sair" do menu de pausa fecha o PPSSPP (e não volta para a lista de jogos).
        args: |rom, _| strings(&["--pause-menu-exit", rom]),
        maximize: false,
    },
    EmulatorPreset {
        id: EmulatorId::Dolphin,
        name: "Dolphin",
        platforms: Some("GameCube / Wii"),
        executable: r"^dolphin\.exe$",
        common_paths: &[r"%ProgramFiles%\Dolphin\Dolphin.exe", r"%ProgramFiles%\Dolphin-x64\Dolphin.exe"],
        extensions: &["iso", "gcm", "rvz", "wia", "wbfs", "ciso", "gcz", "dol", "elf", "wad"],
        // -b: sem a lista de jogos do Dolphin, e ele fecha junto com o jogo; -e: o jogo.
        args: |rom, _| strings(&["-b", "-e", rom]),
        maximize: false,
    },
    EmulatorPreset {
        id: EmulatorId::Azahar,
        name: "Azahar",
        platforms: Some("Nintendo 3DS"),
        executable: r"^azahar\.exe$",
        common_paths: &[r"%ProgramFiles%\Azahar\azahar.exe", r"%LOCALAPPDATA%\Programs\Azahar\azahar.exe"],
        extensions: &["3ds", "cci", "cxi", "3dsx", "app", "zcci", "zcxi", "z3dsx", "elf", "axf"],
        // O Azahar não tem uma opção para fechar junto com o jogo: o tempo conta até ele ser fechado.
        args: |rom, _| strings(&[rom]),
        maximize: false,
    },
];

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

/// Os nomes dos executáveis, já prontos para comparar (na ordem de PRESETS).
static EXECUTABLES: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    PRESETS
        .iter()
        .map(|preset| RegexBuilder::new(preset.executable).case_insensitive(true).build().expect("nome de executável inválido"))
        .collect()
});

/// Os dados fixos de um emulador.
pub fn get_preset(id: EmulatorId) -> &'static EmulatorPreset {
    PRESETS.iter().find(|preset| preset.id == id).expect("todo emulador tem os dados fixos")
}

/// O nome do arquivo é o executável deste emulador?
fn is_executable(preset: &EmulatorPreset, file_name: &str) -> bool {
    PRESETS.iter().position(|item| item.id == preset.id).is_some_and(|index| EXECUTABLES[index].is_match(file_name))
}

// ---------------------------------------------------------------- configuração (tabela emulators)

/// Um emulador, como a aba Emuladores mostra.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorInfo {
    id: EmulatorId,
    name: &'static str,
    platforms: Option<&'static str>,
    path: Option<String>,
    found: bool,
}

/// O executável configurado de cada emulador.
pub fn get_emulator_paths(db: &Connection) -> rusqlite::Result<HashMap<EmulatorId, String>> {
    let mut query = db.prepare("SELECT id, path FROM emulators")?;
    let rows = query.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
    let mut paths = HashMap::new();
    for row in rows {
        let (id, path) = row?;
        if let Some(id) = EmulatorId::from_id(&id) {
            paths.insert(id, path);
        }
    }
    Ok(paths)
}

/// Grava o executável de um emulador.
pub fn set_emulator_path(db: &Connection, id: EmulatorId, path: &str) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO emulators (id, path) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET path = excluded.path",
        (id.id(), path),
    )?;
    Ok(())
}

/// Os emuladores, com o executável configurado e se ele existe.
pub fn list_emulators(db: &Connection, exists: &dyn Fn(&str) -> bool) -> rusqlite::Result<Vec<EmulatorInfo>> {
    let mut paths = get_emulator_paths(db)?;
    Ok(PRESETS
        .iter()
        .map(|preset| {
            let path = paths.remove(&preset.id);
            let found = path.as_deref().is_some_and(exists);
            EmulatorInfo { id: preset.id, name: preset.name, platforms: preset.platforms, path, found }
        })
        .collect())
}

// ---------------------------------------------------------------- detecção automática

/// De onde a detecção lê as coisas (separado para os testes poderem trocar por um computador de mentira).
pub trait DetectionSources {
    /// Atalhos (.lnk) para olhar: menu Iniciar e Área de Trabalho.
    fn shortcuts(&self) -> Vec<String>;
    /// Para onde um atalho aponta (ou None).
    fn read_shortcut(&self, path: &str) -> Option<String>;
    fn exists(&self, path: &str) -> bool;
    /// O que tem numa pasta (nome e se é pasta; vazio se ela não existir), para procurar perto dos
    /// emuladores achados.
    fn list_dir(&self, path: &str) -> Vec<(String, bool)>;
    /// Uma variável de ambiente, para os caminhos comuns (ex.: %ProgramFiles%).
    fn env(&self, name: &str) -> Option<String>;
}

/// Quantas pastas acima da pasta de um emulador achado a procura por perto sobe.
const NEARBY_LEVELS: usize = 2;
/// Quantas pastas ela desce a partir de cada uma dessas.
const NEARBY_DEPTH: usize = 2;
/// Limite de pastas olhadas, para nunca demorar.
const NEARBY_MAX_FOLDERS: usize = 400;

/// Procura cada emulador: primeiro nos atalhos (emuladores portáteis costumam ter um no menu Iniciar),
/// depois nos lugares de instalação comuns e, por fim, perto dos emuladores já achados (`known` são os
/// executáveis que já funcionam): quem usa emuladores portáteis costuma deixar todos na mesma pasta.
/// Atalhos quebrados (apontando para algo que não existe mais) são ignorados.
pub fn detect_emulators(sources: &dyn DetectionSources, known: &[String]) -> HashMap<EmulatorId, String> {
    let targets: Vec<String> = sources
        .shortcuts()
        .iter()
        .filter_map(|shortcut| sources.read_shortcut(shortcut))
        .filter(|target| sources.exists(target))
        .collect();

    let mut found = HashMap::new();
    for preset in &PRESETS {
        let from_shortcut = targets.iter().find(|target| is_executable(preset, &file_name(target))).cloned();
        let from_common_path =
            || preset.common_paths.iter().map(|path| expand_env(path, sources)).find(|path| sources.exists(path));
        if let Some(path) = from_shortcut.or_else(from_common_path) {
            found.insert(preset.id, path);
        }
    }

    let missing: Vec<&EmulatorPreset> = PRESETS.iter().filter(|preset| !found.contains_key(&preset.id)).collect();
    if !missing.is_empty() {
        let anchors: Vec<String> = found.values().cloned().chain(known.iter().cloned()).collect();
        let nearby = find_nearby(&anchors, &missing, sources);
        found.extend(nearby);
    }
    found
}

/// Procura os emuladores que faltam nas pastas vizinhas aos já achados: sobe até NEARBY_LEVELS pastas a
/// partir da pasta de cada um e desce até NEARBY_DEPTH. Ex.: com o PCSX2 em
/// EMULATOR/Emulador/PCSX2/pcsx2-v2/pcsx2-qt.exe, acha EMULATOR/Emulador/RPCS3/rpcs3-v0/rpcs3.exe. Pastas
/// largas demais (a raiz do disco, Arquivos de Programas, a pasta do usuário) não são vasculhadas.
fn find_nearby(anchors: &[String], missing: &[&EmulatorPreset], sources: &dyn DetectionSources) -> HashMap<EmulatorId, String> {
    let mut roots: Vec<String> = Vec::new();
    for anchor in anchors {
        let Some(mut dir) = Path::new(anchor).parent() else { continue };
        for _ in 0..NEARBY_LEVELS {
            let Some(parent) = dir.parent() else { break };
            if is_too_broad(&parent.to_string_lossy(), sources) {
                break;
            }
            dir = parent;
            let root = dir.to_string_lossy().into_owned();
            if !roots.contains(&root) {
                roots.push(root);
            }
        }
    }

    let mut found = HashMap::new();
    let mut visited = HashSet::new();
    for root in &roots {
        visit_nearby(root, 0, missing, sources, &mut visited, &mut found);
    }
    found
}

fn visit_nearby(
    dir: &str,
    depth: usize,
    missing: &[&EmulatorPreset],
    sources: &dyn DetectionSources,
    visited: &mut HashSet<String>,
    found: &mut HashMap<EmulatorId, String>,
) {
    if visited.len() >= NEARBY_MAX_FOLDERS || !visited.insert(dir.to_lowercase()) {
        return;
    }
    for (name, is_directory) in sources.list_dir(dir) {
        let path = Path::new(dir).join(&name).to_string_lossy().into_owned();
        if is_directory {
            if depth < NEARBY_DEPTH {
                visit_nearby(&path, depth + 1, missing, sources, visited, found);
            }
            continue;
        }
        if let Some(preset) = missing.iter().find(|preset| !found.contains_key(&preset.id) && is_executable(preset, &name)) {
            found.insert(preset.id, path);
        }
    }
}

/// Pasta larga demais para vasculhar: a raiz de um disco ou uma pasta do sistema ou do usuário.
fn is_too_broad(dir: &str, sources: &dyn DetectionSources) -> bool {
    let normalize = |path: &str| path.trim_end_matches(['\\', '/']).to_lowercase();
    let target = normalize(dir);
    if target.len() == 2 && target.ends_with(':') {
        return true;
    }
    let mut broad: Vec<String> =
        ["ProgramFiles", "ProgramFiles(x86)", "ProgramData", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PUBLIC", "SystemRoot"]
            .iter()
            .filter_map(|name| sources.env(name))
            .collect();
    if let Some(users) = sources
        .env("USERPROFILE")
        .and_then(|profile| Path::new(&profile).parent().map(|parent| parent.to_string_lossy().into_owned()))
    {
        broad.push(users);
    }
    broad.iter().any(|path| normalize(path) == target)
}

/// Preenche os emuladores que ainda não têm um executável válido com o que a detecção achar. Os que já
/// funcionam (inclusive os escolhidos pelo usuário) não mudam.
pub fn fill_missing_emulators(db: &Connection, sources: &dyn DetectionSources) -> rusqlite::Result<()> {
    let current = list_emulators(db, &|path| sources.exists(path))?;
    let known: Vec<String> =
        current.iter().filter(|emulator| emulator.found).filter_map(|emulator| emulator.path.clone()).collect();
    let detected = detect_emulators(sources, &known);
    for emulator in current.iter().filter(|emulator| !emulator.found) {
        if let Some(path) = detected.get(&emulator.id) {
            set_emulator_path(db, emulator.id, path)?;
        }
    }
    Ok(())
}

/// Troca %VARIÁVEL% pelo valor dela (a que não existir fica como está).
fn expand_env(path: &str, sources: &dyn DetectionSources) -> String {
    static VARIABLE: LazyLock<Regex> = LazyLock::new(|| Regex::new("%([^%]+)%").expect("expressão fixa"));
    VARIABLE
        .replace_all(path, |captures: &regex::Captures| sources.env(&captures[1]).unwrap_or_else(|| captures[0].to_string()))
        .into_owned()
}

/// O nome do arquivo de um caminho (com barras de qualquer tipo).
fn file_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_string()
}

// ---------------------------------------------------------------- RetroArch

/// Um core do RetroArch instalado (cada core roda um ou mais consoles).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetroArchCore {
    /// Nome do arquivo sem a extensão (ex.: "mgba_libretro").
    pub id: String,
    name: String,
    system: String,
    /// Extensões de ROM que o core abre, sem o ponto e em minúsculas.
    extensions: Vec<String>,
}

/// Lê um arquivo .info de core do RetroArch (linhas `chave = "valor"`).
fn parse_core_info(text: &str) -> HashMap<String, String> {
    static LINE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"^\s*(\w+)\s*=\s*"?(.*?)"?\s*$"#).expect("expressão fixa"));
    text.lines()
        .filter_map(|line| LINE.captures(line))
        .map(|captures| (captures[1].to_string(), captures[2].to_string()))
        .collect()
}

/// Os cores instalados no RetroArch (arquivos .dll da pasta "cores"), com o nome, o console e as
/// extensões que vêm do arquivo .info de cada um (pasta "info").
pub fn list_retroarch_cores(retroarch_exe: &str) -> Vec<RetroArchCore> {
    let Some(root) = Path::new(retroarch_exe).parent() else { return Vec::new() };
    let Ok(entries) = std::fs::read_dir(root.join("cores")) else { return Vec::new() };
    let mut cores: Vec<RetroArchCore> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|file| file.to_lowercase().ends_with(".dll"))
        .map(|file| {
            let id = file[..file.len() - 4].to_string();
            let info = std::fs::read_to_string(root.join("info").join(format!("{id}.info")))
                .map(|text| parse_core_info(&text))
                .unwrap_or_default();
            let field = |key: &str| info.get(key).filter(|value| !value.is_empty()).cloned();
            RetroArchCore {
                name: field("display_name").unwrap_or_else(|| id.clone()),
                system: field("systemname").unwrap_or_default(),
                extensions: info
                    .get("supported_extensions")
                    .map(|list| list.split('|').filter(|ext| !ext.is_empty()).map(str::to_lowercase).collect())
                    .unwrap_or_default(),
                id,
            }
        })
        .collect();
    cores.sort_by(|a, b| compare_titles(&a.name, &b.name).then_with(|| a.name.cmp(&b.name)));
    cores
}

/// Extensões que uma pasta de ROMs aceita: as do emulador ou, no RetroArch, as do core mais .zip e .7z.
pub fn rom_extensions(emulator: EmulatorId, core: Option<&RetroArchCore>) -> Vec<String> {
    if emulator != EmulatorId::Retroarch {
        return get_preset(emulator).extensions.iter().map(|ext| ext.to_string()).collect();
    }
    let core_extensions = core.map(|core| core.extensions.clone()).unwrap_or_default();
    let mut extensions: Vec<String> = Vec::new();
    for extension in core_extensions.into_iter().chain(["zip".to_string(), "7z".to_string()]) {
        if !extensions.contains(&extension) {
            extensions.push(extension);
        }
    }
    extensions
}

// ---------------------------------------------------------------- abrir um jogo

/// O comando para abrir uma ROM: o executável do emulador e os argumentos.
pub fn build_launch_command(
    emulator: EmulatorId,
    emulator_path: &str,
    rom_path: &str,
    core: Option<&str>,
) -> (String, Vec<String>) {
    let core_path = core.map(|core| {
        let folder = Path::new(emulator_path).parent().unwrap_or(Path::new(""));
        folder.join("cores").join(format!("{core}.dll")).to_string_lossy().into_owned()
    });
    (emulator_path.to_string(), (get_preset(emulator).args)(rom_path, core_path.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::run_migrations;

    const PCSX2: &str = r"C:\Emuladores\PCSX2\pcsx2-qt.exe";
    const PCSX2_ANTIGO: &str = r"C:\Emuladores\PCSX2-v2.9\pcsx2-qt.exe";
    const DUCKSTATION: &str = r"C:\Emuladores\DuckStation\duckstation-qt-x64-ReleaseLTCG.exe";
    const RETROARCH: &str = r"C:\RetroArch-Win64\retroarch.exe";

    /// Um computador de mentira: atalhos, para onde eles apontam e os arquivos que existem.
    struct FakeSources {
        shortcuts: Vec<(String, String)>,
        files: HashSet<String>,
        folders: HashMap<String, Vec<(String, bool)>>,
    }

    fn fake_sources(shortcuts: &[(&str, &str)], files: &[&str]) -> FakeSources {
        let mut folders: HashMap<String, Vec<(String, bool)>> = HashMap::new();
        for file in files {
            let parts: Vec<&str> = file.split('\\').collect();
            for index in (1..parts.len()).rev() {
                let folder = parts[..index].join("\\").to_lowercase();
                let entry = (parts[index].to_string(), index < parts.len() - 1);
                let list = folders.entry(folder).or_default();
                if !list.contains(&entry) {
                    list.push(entry);
                }
            }
        }
        FakeSources {
            shortcuts: shortcuts.iter().map(|(link, target)| (link.to_string(), target.to_string())).collect(),
            files: files.iter().map(|file| file.to_string()).collect(),
            folders,
        }
    }

    impl DetectionSources for FakeSources {
        fn shortcuts(&self) -> Vec<String> {
            self.shortcuts.iter().map(|(link, _)| link.clone()).collect()
        }
        fn read_shortcut(&self, path: &str) -> Option<String> {
            self.shortcuts.iter().find(|(link, _)| link == path).map(|(_, target)| target.clone())
        }
        fn exists(&self, path: &str) -> bool {
            self.files.contains(path)
        }
        fn list_dir(&self, path: &str) -> Vec<(String, bool)> {
            self.folders.get(&path.to_lowercase()).cloned().unwrap_or_default()
        }
        fn env(&self, name: &str) -> Option<String> {
            match name {
                "ProgramFiles" => Some(r"C:\Program Files".to_string()),
                "LOCALAPPDATA" => Some(r"C:\Users\teste\AppData\Local".to_string()),
                "USERPROFILE" => Some(r"C:\Users\teste".to_string()),
                _ => None,
            }
        }
    }

    fn found(list: &[(EmulatorId, &str)]) -> HashMap<EmulatorId, String> {
        list.iter().map(|(id, path)| (*id, path.to_string())).collect()
    }

    #[test]
    fn acha_pelos_atalhos_ignorando_os_quebrados_e_pelos_lugares_comuns() {
        let sources = fake_sources(
            &[
                ("Menu/PCSX2 antigo.lnk", PCSX2_ANTIGO), // atalho quebrado: o executável não existe mais
                ("Menu/PCSX2.lnk", PCSX2),
                ("Desktop/DuckStation.lnk", DUCKSTATION),
                ("Desktop/Discord.lnk", r"C:\Discord\Discord.exe"),
            ],
            &[PCSX2, DUCKSTATION, RETROARCH, r"C:\Discord\Discord.exe"],
        );
        assert_eq!(
            detect_emulators(&sources, &[]),
            found(&[(EmulatorId::Pcsx2, PCSX2), (EmulatorId::Duckstation, DUCKSTATION), (EmulatorId::Retroarch, RETROARCH)])
        );
    }

    #[test]
    fn nao_acha_o_que_nao_existe() {
        assert!(detect_emulators(&fake_sources(&[("Menu/PCSX2.lnk", PCSX2)], &[]), &[]).is_empty());
    }

    #[test]
    fn acha_um_emulador_portatil_na_pasta_vizinha_de_outro() {
        let pcsx2 = r"C:\Jogos\Emuladores\PCSX2\pcsx2-v2.8\pcsx2-qt.exe";
        let rpcs3 = r"C:\Jogos\Emuladores\RPCS3\rpcs3-v0.0.42\rpcs3.exe";
        let sources = fake_sources(&[("Menu/PCSX2.lnk", pcsx2)], &[pcsx2, rpcs3, r"C:\Jogos\Emuladores\leia-me.txt"]);
        assert_eq!(detect_emulators(&sources, &[]), found(&[(EmulatorId::Pcsx2, pcsx2), (EmulatorId::Rpcs3, rpcs3)]));
    }

    #[test]
    fn ppsspp_dolphin_e_azahar_portateis_e_do_ppsspp_fica_o_de_64_bits() {
        let pcsx2 = r"C:\Jogos\Emuladores\PCSX2\pcsx2-qt.exe";
        let ppsspp32 = r"C:\Jogos\Emuladores\PPSSPP\PPSSPPWindows.exe";
        let ppsspp = r"C:\Jogos\Emuladores\PPSSPP\PPSSPPWindows64.exe";
        let dolphin = r"C:\Jogos\Emuladores\Dolphin-x64\Dolphin.exe";
        let azahar = r"C:\Jogos\Emuladores\Azahar\azahar.exe";
        let sources = fake_sources(&[("Menu/PCSX2.lnk", pcsx2)], &[pcsx2, ppsspp32, ppsspp, dolphin, azahar]);
        assert_eq!(
            detect_emulators(&sources, &[]),
            found(&[
                (EmulatorId::Pcsx2, pcsx2),
                (EmulatorId::Ppsspp, ppsspp),
                (EmulatorId::Dolphin, dolphin),
                (EmulatorId::Azahar, azahar)
            ])
        );
    }

    #[test]
    fn nao_vasculha_pastas_largas_demais() {
        let pcsx2 = r"C:\Program Files\PCSX2\pcsx2-qt.exe";
        let rpcs3 = r"C:\Program Files\Emuladores\RPCS3\rpcs3.exe";
        let sources = fake_sources(&[("Menu/PCSX2.lnk", pcsx2)], &[pcsx2, rpcs3]);
        assert_eq!(detect_emulators(&sources, &[]), found(&[(EmulatorId::Pcsx2, pcsx2)]));
    }

    #[test]
    fn preenche_so_os_emuladores_que_ainda_nao_funcionam() {
        let mut db = Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        let escolhido = r"D:\Meu PCSX2\pcsx2-qt.exe";
        set_emulator_path(&db, EmulatorId::Pcsx2, escolhido).unwrap(); // escolhido pelo usuário: continua
        set_emulator_path(&db, EmulatorId::Duckstation, r"D:\apagado\duckstation-qt.exe").unwrap(); // não existe mais: troca
        let sources =
            fake_sources(&[("Menu/PCSX2.lnk", PCSX2), ("Menu/DuckStation.lnk", DUCKSTATION)], &[escolhido, PCSX2, DUCKSTATION]);

        fill_missing_emulators(&db, &sources).unwrap();

        assert_eq!(
            get_emulator_paths(&db).unwrap(),
            found(&[(EmulatorId::Pcsx2, escolhido), (EmulatorId::Duckstation, DUCKSTATION)])
        );
        let list: Vec<(EmulatorId, bool)> = list_emulators(&db, &|path| sources.exists(path))
            .unwrap()
            .iter()
            .map(|emulator| (emulator.id, emulator.found))
            .collect();
        assert_eq!(
            list,
            [
                (EmulatorId::Pcsx2, true),
                (EmulatorId::Duckstation, true),
                (EmulatorId::Retroarch, false),
                (EmulatorId::Rpcs3, false),
                (EmulatorId::Ppsspp, false),
                (EmulatorId::Dolphin, false),
                (EmulatorId::Azahar, false),
            ]
        );
    }

    #[test]
    fn le_os_arquivos_info_dos_cores() {
        let info = parse_core_info(
            "# comentário\r\ndisplay_name = \"Nintendo - Game Boy Advance (mGBA)\"\r\nsupported_extensions = \"gb|gbc|gba\"\r\nsystemname = \"Game Boy Advance\"\r\n",
        );
        assert_eq!(info["display_name"], "Nintendo - Game Boy Advance (mGBA)");
        assert_eq!(info["supported_extensions"], "gb|gbc|gba");
        assert_eq!(info["systemname"], "Game Boy Advance");
    }

    #[test]
    fn lista_os_cores_instalados_e_core_sem_info_fica_com_o_nome_do_arquivo() {
        let root = std::env::temp_dir().join(format!("playtrove-teste-cores-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("cores")).unwrap();
        std::fs::create_dir_all(root.join("info")).unwrap();
        for file in ["retroarch.exe", r"cores\mgba_libretro.dll", r"cores\desmume_libretro.dll", r"cores\leia-me.txt"] {
            std::fs::write(root.join(file), "").unwrap();
        }
        std::fs::write(
            root.join(r"info\mgba_libretro.info"),
            "display_name = \"Nintendo - Game Boy Advance (mGBA)\"\nsupported_extensions = \"GB|gbc|gba\"\nsystemname = \"Game Boy Advance\"\n",
        )
        .unwrap();
        let cores = list_retroarch_cores(&root.join("retroarch.exe").to_string_lossy());
        assert_eq!(
            cores,
            [
                RetroArchCore {
                    id: "desmume_libretro".into(),
                    name: "desmume_libretro".into(),
                    system: String::new(),
                    extensions: vec![]
                },
                RetroArchCore {
                    id: "mgba_libretro".into(),
                    name: "Nintendo - Game Boy Advance (mGBA)".into(),
                    system: "Game Boy Advance".into(),
                    extensions: strings(&["gb", "gbc", "gba"]),
                },
            ]
        );
        assert!(list_retroarch_cores(&root.join("vazio").join("retroarch.exe").to_string_lossy()).is_empty());
    }

    #[test]
    fn extensoes_aceitas_sao_as_do_emulador_ou_as_do_core_mais_zip_e_7z() {
        assert!(rom_extensions(EmulatorId::Pcsx2, None).contains(&"iso".to_string()));
        assert!(rom_extensions(EmulatorId::Duckstation, None).contains(&"cue".to_string()));
        let core = RetroArchCore {
            id: "mgba_libretro".into(),
            name: "mGBA".into(),
            system: "GBA".into(),
            extensions: strings(&["gba", "zip"]),
        };
        assert_eq!(rom_extensions(EmulatorId::Retroarch, Some(&core)), ["gba", "zip", "7z"]);
    }

    #[test]
    fn os_comandos_fecham_junto_com_o_jogo_sem_forcar_tela_cheia() {
        let rom = r"D:\ROMs\jogo.iso";
        let args = |id| build_launch_command(id, r"C:\Emu\emu.exe", rom, None).1;
        assert_eq!(args(EmulatorId::Pcsx2), ["-batch", "--", rom]);
        assert_eq!(args(EmulatorId::Duckstation), ["-batch", "--", rom]);
        assert_eq!(args(EmulatorId::Rpcs3), ["--no-gui", rom]);
        assert_eq!(args(EmulatorId::Ppsspp), ["--pause-menu-exit", rom]);
        assert_eq!(args(EmulatorId::Dolphin), ["-b", "-e", rom]);
        assert_eq!(args(EmulatorId::Azahar), [rom]);
        let (command, retroarch) = build_launch_command(EmulatorId::Retroarch, RETROARCH, rom, Some("mgba_libretro"));
        assert_eq!(command, RETROARCH);
        assert_eq!(retroarch, ["-L", r"C:\RetroArch-Win64\cores\mgba_libretro.dll", rom]);
        assert!(get_preset(EmulatorId::Retroarch).maximize);
        assert!(!get_preset(EmulatorId::Pcsx2).maximize);
    }
}
