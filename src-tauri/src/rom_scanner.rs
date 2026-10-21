//! As pastas de ROMs (tabela rom_folders) e a varredura que coloca os jogos delas na biblioteca. O mesmo
//! do app em Electron (src/main/romScanner.ts).

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use crate::discs::{ps3_game_folder, read_ps3_title};
use crate::emulators::{EmulatorId, RetroArchCore, get_emulator_paths, get_preset, list_retroarch_cores, rom_extensions};
use crate::errors::{AppError, AppResult};
use crate::i18n::Language;
use crate::library::{EmulatedGame, add_emulated_game, compare_titles};

/// Até quantas subpastas a varredura desce (ex.: PS1/Jogo/jogo.cue são 2).
const MAX_DEPTH: usize = 4;

/// Nome do jogo a partir do nome do arquivo, no padrão Redump/No-Intro: tira a extensão e as etiquetas
/// entre parênteses e colchetes, como (USA), (En,Fr,De) e [SLUS-20300]. O número do disco fica, para
/// jogos com vários discos: "Jogo (Disc 2)". Ex.: "Pista Real 4 (Europe, Australia) (En,Fr,De,Es,It).iso"
/// → "Pista Real 4".
fn title_from_file_name(file_name: &str) -> String {
    static EXTENSION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.[^.]+$").expect("expressão fixa"));
    static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*[\[(]([^\])]*)[\])]").expect("expressão fixa"));
    static DISC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^disc \d+$").expect("expressão fixa"));
    static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("expressão fixa"));
    let base = EXTENSION.replace(file_name, "").into_owned();
    let without_tags = TAG.replace_all(&base, |captures: &regex::Captures| {
        let inside = captures[1].trim();
        if DISC.is_match(inside) { format!(" ({inside})") } else { String::new() }
    });
    let cleaned = SPACES.replace_all(&without_tags.replace('_', " "), " ").trim().to_string();
    if cleaned.is_empty() { base } else { cleaned }
}

/// O nome do jogo pelo arquivo. Nos jogos de PS3 em pasta, o nome vem do próprio disco.
fn title_for_rom(rom_path: &Path) -> String {
    let file_name = |path: &Path| path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    match ps3_game_folder(rom_path) {
        Some(folder) => read_ps3_title(rom_path).unwrap_or_else(|| title_from_file_name(&file_name(&folder))),
        None => title_from_file_name(&file_name(rom_path)),
    }
}

/// Os jogos de PS3 de uma pasta: as ISOs e as pastas de jogo extraídas (aquelas com
/// PS3_GAME/USRDIR/EBOOT.BIN, que é o arquivo que o RPCS3 abre).
fn find_ps3_games(folder: &Path, depth: usize) -> std::io::Result<Vec<String>> {
    let mut games = Vec::new();
    for entry in std::fs::read_dir(folder)? {
        let entry = entry?;
        let path = entry.path();
        if !entry.file_type()?.is_dir() {
            if extension_of(&path) == "iso" {
                games.push(path.to_string_lossy().into_owned());
            }
            continue;
        }
        let eboot = path.join("PS3_GAME").join("USRDIR").join("EBOOT.BIN");
        if eboot.exists() {
            games.push(eboot.to_string_lossy().into_owned());
        } else if depth < MAX_DEPTH {
            games.extend(find_ps3_games(&path, depth + 1)?);
        }
    }
    sort_paths(&mut games);
    Ok(games)
}

/// Os arquivos de ROM de uma pasta e das subpastas dela, com as extensões aceitas. Um .bin com um .cue
/// na mesma pasta fica de fora: quem abre o jogo é o .cue (jogos de PS1).
fn find_roms(folder: &Path, extensions: &[String], depth: usize) -> std::io::Result<Vec<String>> {
    let entries: Vec<_> = std::fs::read_dir(folder)?.collect::<std::io::Result<_>>()?;
    let has_cue =
        entries.iter().any(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()) && extension_of(&entry.path()) == "cue");

    let mut roms = Vec::new();
    for entry in entries {
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            if depth < MAX_DEPTH {
                roms.extend(find_roms(&path, extensions, depth + 1)?);
            }
            continue;
        }
        let extension = extension_of(&path);
        if !extensions.iter().any(|accepted| accepted.eq_ignore_ascii_case(&extension)) || (extension == "bin" && has_cue) {
            continue;
        }
        roms.push(path.to_string_lossy().into_owned());
    }
    sort_paths(&mut roms);
    Ok(roms)
}

fn sort_paths(paths: &mut [String]) {
    paths.sort_by(|a, b| compare_titles(a, b).then_with(|| a.cmp(b)));
}

fn extension_of(path: &Path) -> String {
    path.extension().map(|extension| extension.to_string_lossy().to_lowercase()).unwrap_or_default()
}

// ---------------------------------------------------------------- pastas de ROMs (tabela rom_folders)

/// Uma pasta de ROMs: os arquivos dela abrem num emulador (e num core, no RetroArch).
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RomFolder {
    id: i64,
    path: String,
    emulator_id: EmulatorId,
    core: Option<String>,
    platform: String,
}

/// O que uma varredura de pastas encontrou.
#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    /// Títulos dos jogos novos que entraram na biblioteca.
    pub added: Vec<String>,
    /// Ids dos jogos novos (na mesma ordem de `added`).
    pub added_ids: Vec<i64>,
    /// Quantos arquivos já estavam na biblioteca.
    already_in_library: usize,
    /// Problemas (ex.: pasta que não existe mais).
    errors: Vec<String>,
}

/// As pastas de ROMs configuradas.
pub fn list_rom_folders(db: &Connection) -> rusqlite::Result<Vec<RomFolder>> {
    let mut query = db.prepare("SELECT id, path, emulator_id, core, platform FROM rom_folders ORDER BY path")?;
    let rows = query.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get(3)?, row.get(4)?))
    })?;
    let mut folders = Vec::new();
    for row in rows {
        let (id, path, emulator, core, platform) = row?;
        // Uma pasta de um emulador que o app não conhece mais não aparece (nem é varrida).
        if let Some(emulator_id) = EmulatorId::from_id(&emulator) {
            folders.push(RomFolder { id, path, emulator_id, core, platform });
        }
    }
    Ok(folders)
}

/// Adiciona uma pasta de ROMs, conferindo se ela existe e se a configuração faz sentido.
pub fn add_rom_folder(
    db: &Connection,
    language: Language,
    path: &str,
    emulator_id: EmulatorId,
    core: Option<String>,
    platform: &str,
) -> AppResult<RomFolder> {
    let error = |key: &str| AppError::text(language, &format!("errors.{key}"), &[]);
    if !Path::new(path).is_dir() {
        return Err(error("folderMissing"));
    }
    if emulator_id == EmulatorId::Retroarch && core.is_none() {
        return Err(error("chooseCore"));
    }
    let platform = platform.trim();
    if platform.is_empty() {
        return Err(error("typeConsole"));
    }
    if db.query_row("SELECT 1 FROM rom_folders WHERE path = ?1", [path], |_| Ok(())).optional()?.is_some() {
        return Err(error("folderAlreadyAdded"));
    }

    let core = if emulator_id == EmulatorId::Retroarch { core } else { None };
    db.execute(
        "INSERT INTO rom_folders (path, emulator_id, core, platform) VALUES (?1, ?2, ?3, ?4)",
        (path, emulator_id.id(), &core, platform),
    )?;
    Ok(RomFolder { id: db.last_insert_rowid(), path: path.to_string(), emulator_id, core, platform: platform.to_string() })
}

/// Tira uma pasta da lista (os jogos dela continuam na biblioteca).
pub fn remove_rom_folder(db: &Connection, id: i64) -> rusqlite::Result<()> {
    db.execute("DELETE FROM rom_folders WHERE id = ?1", [id])?;
    Ok(())
}

/// Procura jogos nas pastas (todas, ou só as dos ids pedidos) e coloca os novos na biblioteca. Jogos que
/// já estão (mesmo arquivo de ROM) não entram de novo.
pub fn scan_rom_folders(db: &Connection, language: Language, ids: Option<&[i64]>) -> AppResult<ScanResult> {
    let mut result = ScanResult::default();
    let folders: Vec<RomFolder> =
        list_rom_folders(db)?.into_iter().filter(|folder| ids.is_none_or(|ids| ids.contains(&folder.id))).collect();
    let retroarch_path = get_emulator_paths(db)?.remove(&EmulatorId::Retroarch);
    let mut cores: Option<Vec<RetroArchCore>> = None;

    for folder in &folders {
        if !Path::new(&folder.path).exists() {
            result.errors.push(AppError::text(language, "errors.folderGone", &[&folder.path]).to_string());
            continue;
        }
        let mut core = None;
        if folder.emulator_id == EmulatorId::Retroarch {
            let installed = cores.get_or_insert_with(|| match &retroarch_path {
                Some(path) if Path::new(path).exists() => list_retroarch_cores(path),
                _ => Vec::new(),
            });
            core = installed.iter().find(|item| Some(&item.id) == folder.core.as_ref()).cloned();
            if core.is_none() {
                let core_name = folder.core.clone().unwrap_or_default();
                result.errors.push(AppError::text(language, "errors.coreMissing", &[&core_name, &folder.path]).to_string());
                continue;
            }
        }

        let library = get_preset(folder.emulator_id).name;
        // O RPCS3 abre ISOs e pastas de jogo; os outros, arquivos com as extensões que eles aceitam.
        let roms = if folder.emulator_id == EmulatorId::Rpcs3 {
            find_ps3_games(Path::new(&folder.path), 0)?
        } else {
            find_roms(Path::new(&folder.path), &rom_extensions(folder.emulator_id, core.as_ref()), 0)?
        };
        for rom_path in &roms {
            let title = title_for_rom(Path::new(rom_path));
            let game = EmulatedGame {
                title: &title,
                rom_path,
                platform: &folder.platform,
                library,
                emulator: folder.emulator_id,
                core: folder.core.as_deref(),
            };
            match add_emulated_game(db, language, &game)? {
                Some(id) => {
                    result.added.push(title);
                    result.added_ids.push(id);
                }
                None => result.already_in_library += 1,
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::discs::fake_discs::build_param_sfo;
    use crate::emulators::set_emulator_path;
    use crate::test_support::{create_files, memory_database, temp_folder};

    const PT: Language = Language::PtBr;

    /// Os caminhos encontrados, a partir da pasta e com "/" (para comparar com facilidade).
    fn relative(root: &Path, paths: &[String]) -> Vec<String> {
        let prefix = root.to_string_lossy().len() + 1;
        paths.iter().map(|path| path[prefix..].replace('\\', "/")).collect()
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    fn titles(db: &Connection) -> Vec<String> {
        let mut query = db.prepare("SELECT title FROM games").unwrap();
        let mut titles: Vec<String> = query.query_map([], |row| row.get(0)).unwrap().map(Result::unwrap).collect();
        titles.sort();
        titles
    }

    #[test]
    fn tira_a_extensao_e_as_etiquetas_do_padrao_redump_e_no_intro() {
        assert_eq!(title_from_file_name("Pista Real 4 (Europe, Australia) (En,Fr,De,Es,It).iso"), "Pista Real 4");
        assert_eq!(title_from_file_name("Salto Estelar (USA) (En,Ja,Fr,De,Es,It,Ko).iso"), "Salto Estelar");
        assert_eq!(
            title_from_file_name("Criaturas Lendárias - Edição Fogo (USA, Europe).zip"),
            "Criaturas Lendárias - Edição Fogo"
        );
        assert_eq!(
            title_from_file_name("Corrida Noturna - Edição Turbo (USA) [SLUS-20100].iso"),
            "Corrida Noturna - Edição Turbo"
        );
        assert_eq!(title_from_file_name("Cidade Neon (USA).cue"), "Cidade Neon");
        assert_eq!(title_from_file_name("Lenda Sombria VII (USA) (Disc 2).cue"), "Lenda Sombria VII (Disc 2)");
        assert_eq!(title_from_file_name("super_mario_world.sfc"), "super mario world");
        assert_eq!(title_from_file_name("(USA).iso"), "(USA)");
    }

    #[test]
    fn acha_as_roms_nas_subpastas_e_ignora_outras_extensoes() {
        let root = temp_folder("roms-subpastas");
        create_files(&root, &[("Salto Estelar.iso", ""), ("CL4/CORRIDA LUNAR 4.ISO", ""), ("leia-me.txt", ""), ("capa.jpg", "")]);
        assert_eq!(
            relative(&root, &find_roms(&root, &strings(&["iso"]), 0).unwrap()),
            ["CL4/CORRIDA LUNAR 4.ISO", "Salto Estelar.iso"]
        );
    }

    #[test]
    fn jogos_de_ps1_fica_so_o_cue_quando_ha_bin_na_mesma_pasta() {
        let root = temp_folder("roms-cue");
        create_files(
            &root,
            &[
                ("Cidade Neon/Cidade Neon (USA).cue", ""),
                ("Cidade Neon/Cidade Neon (USA) (Track 1).bin", ""),
                ("Cidade Neon/Cidade Neon (USA) (Track 2).bin", ""),
                ("Avulso/Jogo sem cue.bin", ""),
            ],
        );
        assert_eq!(
            relative(&root, &find_roms(&root, &strings(&["cue", "bin"]), 0).unwrap()),
            ["Avulso/Jogo sem cue.bin", "Cidade Neon/Cidade Neon (USA).cue"]
        );
    }

    #[test]
    fn desce_ate_4_subpastas() {
        let root = temp_folder("roms-fundo");
        create_files(&root, &[("a/b/c/d/ok.iso", ""), ("a/b/c/d/e/fundo-demais.iso", "")]);
        assert_eq!(relative(&root, &find_roms(&root, &strings(&["iso"]), 0).unwrap()), ["a/b/c/d/ok.iso"]);
    }

    #[test]
    fn valida_a_pasta_antes_de_adicionar() {
        let db = memory_database();
        let root = temp_folder("pasta-valida");
        let path = root.to_string_lossy().into_owned();
        let missing = root.join("nao-existe").to_string_lossy().into_owned();
        let error = |result: AppResult<RomFolder>| result.unwrap_err().to_string();
        assert!(error(add_rom_folder(&db, PT, &missing, EmulatorId::Pcsx2, None, "PS2")).contains("Essa pasta não existe"));
        assert!(error(add_rom_folder(&db, PT, &path, EmulatorId::Retroarch, None, "GBA")).contains("core"));
        assert!(error(add_rom_folder(&db, PT, &path, EmulatorId::Pcsx2, None, "  ")).contains("console"));
        add_rom_folder(&db, PT, &path, EmulatorId::Pcsx2, Some("ignorado".into()), " PlayStation 2 ").unwrap();
        assert_eq!(
            list_rom_folders(&db).unwrap(),
            [RomFolder {
                id: 1,
                path: path.clone(),
                emulator_id: EmulatorId::Pcsx2,
                core: None,
                platform: "PlayStation 2".into()
            }]
        );
        assert!(error(add_rom_folder(&db, PT, &path, EmulatorId::Pcsx2, None, "PS2")).contains("já está na lista"));
    }

    #[test]
    fn procurar_coloca_os_jogos_novos_e_procurar_de_novo_nao_duplica() {
        let db = memory_database();
        let root = temp_folder("varredura");
        create_files(&root, &[("Salto Estelar (USA).iso", ""), ("Pista Real 4 (Europe).iso", "")]);
        let folder = add_rom_folder(&db, PT, &root.to_string_lossy(), EmulatorId::Pcsx2, None, "PlayStation 2").unwrap();

        let first = scan_rom_folders(&db, PT, None).unwrap();
        assert_eq!(first.added, ["Pista Real 4", "Salto Estelar"]);
        assert_eq!(first.added_ids, [1, 2]);
        let (platform, library, emulator, rom): (String, String, String, String) = db
            .query_row("SELECT platform, library, emulator_id, rom_path FROM games WHERE id = 1", [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap();
        assert_eq!((platform.as_str(), library.as_str(), emulator.as_str()), ("PlayStation 2", "PCSX2", "pcsx2"));
        assert_eq!(rom, root.join("Pista Real 4 (Europe).iso").to_string_lossy());

        let again = scan_rom_folders(&db, PT, Some(&[folder.id])).unwrap();
        assert_eq!((again.added.len(), again.already_in_library), (0, 2));
        assert_eq!(titles(&db).len(), 2);
    }

    #[test]
    fn tirar_a_pasta_nao_tira_os_jogos_e_pasta_apagada_vira_aviso() {
        let db = memory_database();
        let root = temp_folder("pasta-apagada");
        create_files(&root, &[("Salto Estelar.iso", "")]);
        let path = root.to_string_lossy().into_owned();
        let folder = add_rom_folder(&db, PT, &path, EmulatorId::Pcsx2, None, "PlayStation 2").unwrap();
        scan_rom_folders(&db, PT, None).unwrap();

        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(scan_rom_folders(&db, PT, None).unwrap().errors, [format!("A pasta {path} não existe mais.")]);

        remove_rom_folder(&db, folder.id).unwrap();
        assert!(list_rom_folders(&db).unwrap().is_empty());
        assert_eq!(titles(&db).len(), 1);
    }

    #[test]
    fn retroarch_usa_as_extensoes_do_core_da_pasta() {
        let db = memory_database();
        let retroarch = temp_folder("retroarch-core");
        create_files(
            &retroarch,
            &[
                ("retroarch.exe", ""),
                ("cores/mgba_libretro.dll", ""),
                (
                    "info/mgba_libretro.info",
                    "display_name = \"Nintendo - Game Boy Advance (mGBA)\"\nsupported_extensions = \"gb|gbc|gba\"\n",
                ),
            ],
        );
        set_emulator_path(&db, EmulatorId::Retroarch, &retroarch.join("retroarch.exe").to_string_lossy()).unwrap();
        let roms = temp_folder("retroarch-roms");
        create_files(
            &roms,
            &[("Criaturas Lendárias - Edição Fogo (USA, Europe).zip", ""), ("Runas de Ouro.gba", ""), ("Jogo de PS2.iso", "")],
        );
        add_rom_folder(&db, PT, &roms.to_string_lossy(), EmulatorId::Retroarch, Some("mgba_libretro".into()), "Game Boy Advance")
            .unwrap();

        assert_eq!(scan_rom_folders(&db, PT, None).unwrap().added, ["Criaturas Lendárias - Edição Fogo", "Runas de Ouro"]);
        let core: String = db.query_row("SELECT core FROM games LIMIT 1", [], |row| row.get(0)).unwrap();
        assert_eq!(core, "mgba_libretro");
    }

    #[test]
    fn retroarch_core_que_nao_esta_instalado_vira_aviso() {
        let db = memory_database();
        let roms = temp_folder("retroarch-sem-core");
        create_files(&roms, &[("Runas de Ouro.gba", "")]);
        add_rom_folder(&db, PT, &roms.to_string_lossy(), EmulatorId::Retroarch, Some("mgba_libretro".into()), "Game Boy Advance")
            .unwrap();
        let result = scan_rom_folders(&db, PT, None).unwrap();
        assert!(result.added.is_empty());
        assert!(result.errors[0].contains("O core mgba_libretro não foi encontrado"), "{}", result.errors[0]);
    }

    #[test]
    fn ps3_acha_as_isos_e_as_pastas_de_jogo_e_o_nome_vem_do_disco() {
        let root = temp_folder("ps3-pastas");
        create_files(
            &root,
            &[
                ("Manobras Radicais 3 (USA).iso", ""),
                ("Jogo Extraído [BLUS12345]/PS3_GAME/USRDIR/EBOOT.BIN", ""),
                ("Jogo Extraído [BLUS12345]/PS3_GAME/ICON0.PNG", ""),
                ("Outra pasta/leia-me.txt", ""),
            ],
        );
        std::fs::write(
            root.join("Jogo Extraído [BLUS12345]").join("PS3_GAME").join("PARAM.SFO"),
            build_param_sfo(&[("TITLE_ID", "BLUS12345"), ("TITLE", "Jogo de Verdade")]),
        )
        .unwrap();
        let games = find_ps3_games(&root, 0).unwrap();
        assert_eq!(
            relative(&root, &games),
            ["Jogo Extraído [BLUS12345]/PS3_GAME/USRDIR/EBOOT.BIN", "Manobras Radicais 3 (USA).iso"]
        );
        assert_eq!(title_for_rom(Path::new(&games[0])), "Jogo de Verdade");
        assert_eq!(title_for_rom(Path::new(&games[1])), "Manobras Radicais 3");
    }

    #[test]
    fn a_varredura_coloca_os_jogos_de_ps3_na_biblioteca() {
        let db = memory_database();
        let root = temp_folder("ps3-varredura");
        create_files(&root, &[("Manobras Radicais 3 (USA).iso", ""), ("Corrida Lunar 5/PS3_GAME/USRDIR/EBOOT.BIN", "")]);
        add_rom_folder(&db, PT, &root.to_string_lossy(), EmulatorId::Rpcs3, None, "PlayStation 3").unwrap();
        assert_eq!(scan_rom_folders(&db, PT, None).unwrap().added, ["Corrida Lunar 5", "Manobras Radicais 3"]);
        let library: String = db.query_row("SELECT library FROM games LIMIT 1", [], |row| row.get(0)).unwrap();
        assert_eq!(library, "RPCS3");
    }
}
