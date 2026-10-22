//! Leitura dos discos dos jogos (só o necessário, sem carregar o arquivo inteiro): o código do jogo
//! (ex.: SLUS-20100), que é como os emuladores identificam cada jogo nos registros de tempo jogado, e o
//! nome dos jogos de PS3.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use crate::achievements::trophy_files::is_trophy_set_id;

/// Setor lógico de um CD/DVD (ISO 9660).
const SECTOR: usize = 2048;

/// Formatos de GameCube e Wii que o Dolphin abre e que têm o código do jogo legível (as ISOs também).
const GAMECUBE_WII_FILES: [&str; 5] = ["gcm", "rvz", "wia", "wbfs", "ciso"];
/// Formatos de 3DS com o cabeçalho NCSD ou NCCH (os comprimidos, .zcci e afins, ficam de fora).
const NINTENDO_3DS_FILES: [&str; 4] = ["3ds", "cci", "cxi", "app"];

/// O código do jogo no disco, que é como os emuladores identificam cada jogo nos registros de tempo:
/// - PS1 e PS2: do arquivo SYSTEM.CNF (BOOT = cdrom:\SLUS_001.00;1 → SLUS-00100);
/// - PS3: do PARAM.SFO (TITLE_ID, ex.: BLUS30100), na ISO ou na pasta do jogo (EBOOT.BIN);
/// - PSP: do PARAM.SFO (DISC_ID, ex.: ULUS10041), na ISO (PSP_GAME/PARAM.SFO) ou no EBOOT.PBP;
/// - GameCube e Wii: os 6 primeiros caracteres do disco (ex.: GALE01), na ISO e no RVZ, WIA, WBFS e CISO;
/// - 3DS: o id do programa, em hexadecimal (ex.: 0004000000055D00), no .3ds/.cci e no .cxi.
///
/// Devolve None quando não dá para ler (formato comprimido, como CHD e CSO, ou disco estranho).
pub fn read_disc_serial(rom_path: &Path) -> Option<String> {
    if let Some(folder) = ps3_game_folder(rom_path) {
        let sfo = std::fs::read(folder.join("PS3_GAME").join("PARAM.SFO")).ok()?;
        return string_field(&parse_param_sfo(&sfo)?, "TITLE_ID");
    }
    let extension = extension_of(rom_path);
    if extension == "pbp" {
        return read_pbp_disc_id(rom_path);
    }
    if NINTENDO_3DS_FILES.contains(&extension.as_str()) {
        return read_3ds_program_id(rom_path);
    }
    if GAMECUBE_WII_FILES.contains(&extension.as_str()) {
        return read_gamecube_wii_id(rom_path);
    }
    let mut disc = open_disc_image(rom_path)?;
    if let Some(system_cnf) = read_iso_file(&mut disc, &["SYSTEM.CNF"]) {
        return serial_from_system_cnf(&latin1(&system_cnf));
    }
    if let Some(sfo) = read_iso_file(&mut disc, &["PS3_GAME", "PARAM.SFO"]) {
        return string_field(&parse_param_sfo(&sfo)?, "TITLE_ID");
    }
    if let Some(sfo) = read_iso_file(&mut disc, &["PSP_GAME", "PARAM.SFO"]) {
        return string_field(&parse_param_sfo(&sfo)?, "DISC_ID");
    }
    // As ISOs de GameCube e Wii não são ISO 9660: o código fica logo no começo do disco.
    if extension == "iso" { read_gamecube_wii_id(rom_path) } else { None }
}

/// O DISC_ID de um jogo de PSP em EBOOT.PBP (o formato dos jogos da PSN): o PARAM.SFO vem dentro dele.
fn read_pbp_disc_id(rom_path: &Path) -> Option<String> {
    let header = read_bytes(rom_path, 0, 0x28)?;
    if header.get(..4)? != b"\0PBP" {
        return None;
    }
    let start = u32_le(&header, 0x08)?;
    let end = u32_le(&header, 0x0c)?;
    if end <= start || end - start > 64 * 1024 {
        return None;
    }
    string_field(&parse_param_sfo(&read_bytes(rom_path, start as u64, (end - start) as usize)?)?, "DISC_ID")
}

/// O código de um disco de GameCube ou Wii (ex.: GALE01). Cada formato guarda uma cópia do começo do
/// disco num lugar: a ISO, no começo; o RVZ e o WIA, no cabeçalho deles (0x58); o WBFS, depois do
/// primeiro setor dele; e o CISO, depois do mapa de blocos (0x8000). O disco é conferido pela marca do
/// GameCube (0x1C) ou do Wii (0x18).
fn read_gamecube_wii_id(rom_path: &Path) -> Option<String> {
    let start = read_bytes(rom_path, 0, 0x20)?;
    let offset: u64 = match start.get(..4)? {
        b"RVZ\x01" | b"WIA\x01" => 0x58,
        b"WBFS" => 1u64.checked_shl(u32::from(*start.get(8)?))?,
        b"CISO" => 0x8000,
        _ => 0,
    };
    let header = if offset == 0 { start } else { read_bytes(rom_path, offset, 0x20)? };
    let is_gamecube = u32_be(&header, 0x1c)? == 0xc233_9f3d;
    let is_wii = u32_be(&header, 0x18)? == 0x5d1c_9ea3;
    if !is_gamecube && !is_wii {
        return None;
    }
    let id = latin1(header.get(..6)?);
    id.chars().all(|character| character.is_ascii_uppercase() || character.is_ascii_digit()).then_some(id)
}

/// O id do programa de um jogo de 3DS, em hexadecimal (ex.: 0004000000055D00): no cabeçalho NCCH, que
/// no .cxi fica no começo e no .3ds/.cci, na primeira partição (a tabela do NCSD diz onde, em blocos de
/// 0x200 bytes).
fn read_3ds_program_id(rom_path: &Path) -> Option<String> {
    let start = read_bytes(rom_path, 0, 0x200)?;
    let ncch = if start.get(0x100..0x104)? == b"NCSD" { u64::from(u32_le(&start, 0x120)?) * 0x200 } else { 0 };
    let header = if ncch == 0 { start } else { read_bytes(rom_path, ncch, 0x200)? };
    if header.get(0x100..0x104)? != b"NCCH" {
        return None;
    }
    let id = u64::from_le_bytes(header.get(0x118..0x120)?.try_into().ok()?);
    (id != 0).then(|| format!("{id:016X}"))
}

/// Lê `length` bytes de um arquivo a partir de `position` (menos, se o arquivo acabar antes).
fn read_bytes(path: &Path, position: u64, length: usize) -> Option<Vec<u8>> {
    let mut file = File::open(path).ok()?;
    file.seek(SeekFrom::Start(position)).ok()?;
    let mut buffer = Vec::with_capacity(length);
    file.take(length as u64).read_to_end(&mut buffer).ok()?;
    Some(buffer)
}

/// O nome de um jogo de PS3 em pasta (EBOOT.BIN), pelo PARAM.SFO; None se não for um.
pub fn read_ps3_title(rom_path: &Path) -> Option<String> {
    let folder = ps3_game_folder(rom_path)?;
    string_field(&parse_param_sfo(&std::fs::read(folder.join("PS3_GAME").join("PARAM.SFO")).ok()?)?, "TITLE")
}

/// Os conjuntos de troféus de um jogo de PS3 (as pastas de PS3_GAME/TROPDIR, ex.: NPWR01234_00), na ISO
/// ou na pasta do jogo. É assim que o app sabe quais troféus do RPCS3 são de qual jogo.
pub fn read_ps3_trophy_sets(rom_path: &Path) -> Vec<String> {
    if let Some(folder) = ps3_game_folder(rom_path) {
        let Ok(entries) = std::fs::read_dir(folder.join("PS3_GAME").join("TROPDIR")) else { return Vec::new() };
        return entries
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_uppercase())
            .filter(|name| is_trophy_set_id(name))
            .collect();
    }
    if extension_of(rom_path) != "iso" {
        return Vec::new();
    }
    let Some(mut disc) = open_disc_image(rom_path) else { return Vec::new() };
    match find_iso_entry(&mut disc, &["PS3_GAME", "TROPDIR"]) {
        Some(dir) if dir.is_directory => list_directory(&mut disc, &dir)
            .into_iter()
            .filter(|record| record.is_directory && is_trophy_set_id(&record.name))
            .map(|record| record.name)
            .collect(),
        _ => Vec::new(),
    }
}

/// A pasta de um jogo de PS3 extraído, se a ROM for o EBOOT.BIN dele (…/PS3_GAME/USRDIR/EBOOT.BIN).
pub fn ps3_game_folder(rom_path: &Path) -> Option<PathBuf> {
    let is_named =
        |path: &Path, name: &str| path.file_name().is_some_and(|file| file.to_string_lossy().eq_ignore_ascii_case(name));
    if !is_named(rom_path, "EBOOT.BIN") {
        return None;
    }
    let usrdir = rom_path.parent()?;
    let ps3_game = usrdir.parent()?;
    if !is_named(usrdir, "USRDIR") || !is_named(ps3_game, "PS3_GAME") {
        return None;
    }
    ps3_game.parent().map(Path::to_path_buf)
}

/// "BOOT2 = cdrom0:\SLUS_201.00;1" → "SLUS-20100".
fn serial_from_system_cnf(text: &str) -> Option<String> {
    static BOOT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?im)^\s*BOOT2?\s*=\s*(.+)$").expect("expressão fixa"));
    static FILE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)^([A-Z]{4})[_-]?(\d{3})\.?(\d{2})$").expect("expressão fixa"));
    static VERSION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r";\d+$").expect("expressão fixa"));
    let boot = BOOT.captures(text)?.get(1)?.as_str().trim().to_string();
    let file = boot.rsplit(['\\', '/', ':']).next()?;
    let file = VERSION.replace(file, "");
    let parts = FILE.captures(&file)?;
    Some(format!("{}-{}{}", parts[1].to_uppercase(), &parts[2], &parts[3]))
}

/// Um campo do PARAM.SFO: texto ou número.
#[derive(Debug, PartialEq)]
enum SfoValue {
    Text(String),
    Number(u32),
}

/// Os campos de um PARAM.SFO (arquivo de informações dos jogos de PS3 e PSP). None se não for um.
fn parse_param_sfo(buffer: &[u8]) -> Option<HashMap<String, SfoValue>> {
    if u32_le(buffer, 0)? != 0x4653_5000 {
        return None;
    }
    let key_table = u32_le(buffer, 8)? as usize;
    let data_table = u32_le(buffer, 12)? as usize;
    let entries = u32_le(buffer, 16)? as usize;
    let mut fields = HashMap::new();
    for index in 0..entries {
        let base = 20 + index * 16;
        let key_start = key_table + usize::from(u16_le(buffer, base)?);
        let key_end = key_start + buffer.get(key_start..)?.iter().position(|byte| *byte == 0)?;
        let key = String::from_utf8_lossy(&buffer[key_start..key_end]).into_owned();
        let format = u16_le(buffer, base + 2)?;
        let length = u32_le(buffer, base + 4)? as usize;
        let data_start = data_table + u32_le(buffer, base + 12)? as usize;
        let value = if format == 0x0404 {
            SfoValue::Number(u32_le(buffer, data_start)?)
        } else {
            let text = String::from_utf8_lossy(buffer.get(data_start..data_start + length)?);
            SfoValue::Text(text.trim_end_matches('\0').to_string())
        };
        fields.insert(key, value);
    }
    Some(fields)
}

fn string_field(fields: &HashMap<String, SfoValue>, key: &str) -> Option<String> {
    match fields.get(key) {
        Some(SfoValue::Text(text)) if !text.is_empty() => Some(text.clone()),
        _ => None,
    }
}

fn u16_le(buffer: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(buffer.get(offset..offset + 2)?.try_into().ok()?))
}

fn u32_le(buffer: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(buffer.get(offset..offset + 4)?.try_into().ok()?))
}

fn u32_be(buffer: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(buffer.get(offset..offset + 4)?.try_into().ok()?))
}

/// Bytes como texto latin1 (cada byte é um caractere).
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| char::from(*byte)).collect()
}

fn extension_of(path: &Path) -> String {
    path.extension().map(|extension| extension.to_string_lossy().to_lowercase()).unwrap_or_default()
}

// ---------------------------------------------------------------- imagens de disco

/// Um disco aberto: lê setores lógicos de 2048 bytes. Numa imagem "crua", cada setor tem `sector_size`
/// bytes, e os 2048 de dados começam em `data_offset`.
struct DiscImage {
    file: File,
    sector_size: u64,
    data_offset: u64,
}

impl DiscImage {
    /// Lê `count` setores a partir do `lba` (o que passar do fim do arquivo vem zerado).
    fn read_sectors(&mut self, lba: u32, count: usize) -> Vec<u8> {
        let mut out = vec![0; SECTOR * count];
        for index in 0..count {
            let position = (u64::from(lba) + index as u64) * self.sector_size + self.data_offset;
            if self.file.seek(SeekFrom::Start(position)).is_err() {
                break;
            }
            let chunk = &mut out[index * SECTOR..(index + 1) * SECTOR];
            let mut filled = 0;
            while filled < SECTOR {
                match self.file.read(&mut chunk[filled..]) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => filled += read,
                }
            }
        }
        out
    }
}

/// Abre uma imagem de disco para leitura dos setores:
/// - .iso: setores de 2048 bytes;
/// - .cue: a primeira faixa do .bin que ele indica (MODE1/2352 ou MODE2/2352);
/// - .bin sozinho: descobre o formato pela marca de sincronismo do setor.
///
/// Formatos comprimidos (.chd, .cso, .zip...) ficam de fora.
fn open_disc_image(rom_path: &Path) -> Option<DiscImage> {
    let raw = |path: &Path, sector_size, data_offset| Some(DiscImage { file: File::open(path).ok()?, sector_size, data_offset });
    match extension_of(rom_path).as_str() {
        "iso" => raw(rom_path, 2048, 0),
        "cue" => {
            static FILE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?im)^\s*FILE\s+"([^"]+)""#).expect("expressão fixa"));
            static TRACK: LazyLock<Regex> =
                LazyLock::new(|| Regex::new(r"(?im)^\s*TRACK\s+\d+\s+(MODE1|MODE2)/2352").expect("expressão fixa"));
            let cue = latin1(&std::fs::read(rom_path).ok()?);
            let file = FILE.captures(&cue)?.get(1)?.as_str().to_string();
            let mode = TRACK.captures(&cue)?.get(1)?.as_str().to_uppercase();
            raw(&rom_path.parent()?.join(file), 2352, if mode == "MODE1" { 16 } else { 24 })
        }
        "bin" => {
            const SYNC: [u8; 12] = [0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0];
            let header = read_bytes(rom_path, 0, 16)?;
            if header.len() < 16 || header[..12] != SYNC {
                return raw(rom_path, 2048, 0);
            }
            raw(rom_path, 2352, if header[15] == 1 { 16 } else { 24 })
        }
        _ => None,
    }
}

/// Um registro de diretório do ISO 9660.
struct DirectoryRecord {
    name: String,
    lba: u32,
    size: u32,
    is_directory: bool,
}

/// Lê um arquivo do disco pelo caminho (ex.: ["PS3_GAME", "PARAM.SFO"]); None se ele não existir.
fn read_iso_file(disc: &mut DiscImage, path: &[&str]) -> Option<Vec<u8>> {
    let file = find_iso_entry(disc, path)?;
    if file.is_directory || file.size > 1024 * 1024 {
        return None;
    }
    let mut data = disc.read_sectors(file.lba, (file.size as usize).div_ceil(SECTOR));
    data.truncate(file.size as usize);
    Some(data)
}

/// Acha um arquivo ou pasta do disco pelo caminho; None se não existir (ou se não for ISO 9660).
fn find_iso_entry(disc: &mut DiscImage, path: &[&str]) -> Option<DirectoryRecord> {
    let volume = disc.read_sectors(16, 1);
    if volume.get(1..6)? != b"CD001" {
        return None;
    }
    let mut current = parse_record(&volume, 156)?;
    for part in path {
        if !current.is_directory {
            return None;
        }
        current = list_directory(disc, &current).into_iter().find(|record| record.name == part.to_uppercase())?;
    }
    Some(current)
}

/// Os registros de um diretório (sem as entradas "." e "..").
fn list_directory(disc: &mut DiscImage, directory: &DirectoryRecord) -> Vec<DirectoryRecord> {
    let sectors = (directory.size as usize).div_ceil(SECTOR).min(64);
    let data = disc.read_sectors(directory.lba, sectors);
    let mut records = Vec::new();
    let mut offset = 0;
    while offset < data.len() {
        let length = usize::from(data[offset]);
        if length == 0 {
            // Registros não atravessam setores: pula para o começo do próximo.
            offset = (offset / SECTOR + 1) * SECTOR;
            continue;
        }
        if let Some(record) = parse_record(&data, offset)
            && !record.name.trim().is_empty()
        {
            records.push(record);
        }
        offset += length;
    }
    records
}

fn parse_record(buffer: &[u8], offset: usize) -> Option<DirectoryRecord> {
    static VERSION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r";\d+$").expect("expressão fixa"));
    let name_length = usize::from(*buffer.get(offset + 32)?);
    let raw_name = latin1(buffer.get(offset + 33..offset + 33 + name_length)?);
    let name = VERSION.replace(&raw_name, "");
    Some(DirectoryRecord {
        name: name.strip_suffix('.').unwrap_or(&name).to_uppercase(),
        lba: u32_le(buffer, offset + 2)?,
        size: u32_le(buffer, offset + 10)?,
        is_directory: buffer.get(offset + 25)? & 2 != 0,
    })
}

#[cfg(test)]
pub mod fake_discs {
    //! Discos de mentira para os testes (os mesmos de tests/fakeDiscs.ts): imagens ISO 9660, a versão
    //! "crua" de CD (os .bin de PS1), o PARAM.SFO, o EBOOT.PBP e os começos de disco da Nintendo.

    use super::SECTOR;

    fn write_record(disc: &mut [u8], offset: usize, name: &str, lba: u32, size: u32, is_directory: bool) -> usize {
        let length = 33 + name.len() + usize::from(name.len().is_multiple_of(2));
        disc[offset] = length as u8;
        disc[offset + 2..offset + 6].copy_from_slice(&lba.to_le_bytes());
        disc[offset + 10..offset + 14].copy_from_slice(&size.to_le_bytes());
        disc[offset + 25] = if is_directory { 2 } else { 0 };
        disc[offset + 32] = name.len() as u8;
        disc[offset + 33..offset + 33 + name.len()].copy_from_slice(name.as_bytes());
        length
    }

    /// Uma pasta do disco de mentira: a chave, o setor e as entradas (nome, setor, tamanho, é pasta).
    type Directory = (String, u32, Vec<(String, u32, u32, bool)>);

    /// Um disco ISO 9660: o descritor no setor 16, o diretório raiz no 17 e um setor para cada arquivo.
    pub fn build_iso(files: &[(&[&str], &[u8])]) -> Vec<u8> {
        let mut disc = vec![0; SECTOR * 32];
        disc[16 * SECTOR] = 1;
        disc[16 * SECTOR + 1..16 * SECTOR + 6].copy_from_slice(b"CD001");
        write_record(&mut disc, 16 * SECTOR + 156, " ", 17, SECTOR as u32, true);

        // As entradas de cada pasta: (chave da pasta, setor, [(nome, setor, tamanho, é pasta)]).
        let mut directories: Vec<Directory> = vec![(String::new(), 17, Vec::new())];
        let mut next_lba = 18;
        for (path, content) in files {
            let mut parent = String::new();
            for part in &path[..path.len() - 1] {
                let key = format!("{parent}/{part}");
                if !directories.iter().any(|(name, _, _)| *name == key) {
                    let lba = next_lba;
                    next_lba += 1;
                    directories.push((key.clone(), lba, Vec::new()));
                    let parent_entries = &mut directories.iter_mut().find(|(name, _, _)| *name == parent).unwrap().2;
                    parent_entries.push((part.to_string(), lba, SECTOR as u32, true));
                }
                parent = key;
            }
            let lba = next_lba;
            next_lba += 1;
            disc[lba as usize * SECTOR..lba as usize * SECTOR + content.len()].copy_from_slice(content);
            let entries = &mut directories.iter_mut().find(|(name, _, _)| *name == parent).unwrap().2;
            entries.push((format!("{};1", path[path.len() - 1]), lba, content.len() as u32, false));
        }
        for (_, lba, entries) in &directories {
            let mut offset = *lba as usize * SECTOR;
            for (name, entry_lba, size, is_directory) in entries {
                offset += write_record(&mut disc, offset, name, *entry_lba, *size, *is_directory);
            }
        }
        disc
    }

    /// O mesmo disco no formato "cru" de CD (2352 bytes por setor), como os .bin de PS1.
    pub fn to_raw_bin(disc: &[u8], mode: u8) -> Vec<u8> {
        let sectors = disc.len() / SECTOR;
        let mut raw = vec![0; sectors * 2352];
        for index in 0..sectors {
            let start = index * 2352;
            raw[start..start + 12].copy_from_slice(&[0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0]);
            raw[start + 15] = mode;
            let data = start + if mode == 1 { 16 } else { 24 };
            raw[data..data + SECTOR].copy_from_slice(&disc[index * SECTOR..(index + 1) * SECTOR]);
        }
        raw
    }

    /// Um PARAM.SFO de mentira (o arquivo de informações dos jogos de PS3 e PSP).
    pub fn build_param_sfo(fields: &[(&str, &str)]) -> Vec<u8> {
        let key_table = 20 + fields.len() * 16;
        let keys: Vec<u8> = fields.iter().flat_map(|(key, _)| format!("{key}\0").into_bytes()).collect();
        let data_table = key_table + keys.len();
        let values: Vec<Vec<u8>> = fields.iter().map(|(_, value)| format!("{value}\0").into_bytes()).collect();
        let mut sfo = vec![0; data_table + values.iter().map(Vec::len).sum::<usize>()];
        sfo[..4].copy_from_slice(b"\0PSF");
        sfo[4..8].copy_from_slice(&0x0000_0101u32.to_le_bytes());
        sfo[8..12].copy_from_slice(&(key_table as u32).to_le_bytes());
        sfo[12..16].copy_from_slice(&(data_table as u32).to_le_bytes());
        sfo[16..20].copy_from_slice(&(fields.len() as u32).to_le_bytes());
        let (mut key_offset, mut data_offset) = (0, 0);
        for (index, (key, _)) in fields.iter().enumerate() {
            let base = 20 + index * 16;
            sfo[base..base + 2].copy_from_slice(&(key_offset as u16).to_le_bytes());
            sfo[base + 2..base + 4].copy_from_slice(&0x0204u16.to_le_bytes());
            sfo[base + 4..base + 8].copy_from_slice(&(values[index].len() as u32).to_le_bytes());
            sfo[base + 8..base + 12].copy_from_slice(&(values[index].len() as u32).to_le_bytes());
            sfo[base + 12..base + 16].copy_from_slice(&(data_offset as u32).to_le_bytes());
            sfo[data_table + data_offset..data_table + data_offset + values[index].len()].copy_from_slice(&values[index]);
            key_offset += key.len() + 1;
            data_offset += values[index].len();
        }
        sfo[key_table..key_table + keys.len()].copy_from_slice(&keys);
        sfo
    }

    /// Um EBOOT.PBP de PSP de mentira, com o PARAM.SFO logo depois do cabeçalho.
    pub fn build_pbp(sfo: &[u8]) -> Vec<u8> {
        let mut header = vec![0; 0x28];
        header[..4].copy_from_slice(b"\0PBP");
        header[4..8].copy_from_slice(&0x0001_0000u32.to_le_bytes());
        for index in 0..8 {
            let offset = 0x28 + if index == 0 { 0 } else { sfo.len() as u32 };
            header[8 + index * 4..12 + index * 4].copy_from_slice(&offset.to_le_bytes());
        }
        [header, sfo.to_vec()].concat()
    }

    /// O começo de um disco de GameCube ou de Wii: o código do jogo e a marca do console.
    pub fn build_nintendo_disc(id: &str, wii: bool) -> Vec<u8> {
        let mut disc = vec![0; 0x440];
        disc[..id.len()].copy_from_slice(id.as_bytes());
        if wii {
            disc[0x18..0x1c].copy_from_slice(&0x5d1c_9ea3u32.to_be_bytes());
        } else {
            disc[0x1c..0x20].copy_from_slice(&0xc233_9f3du32.to_be_bytes());
        }
        disc
    }

    /// O mesmo disco nos formatos do Dolphin: o RVZ no cabeçalho (0x58), o WBFS depois do primeiro setor
    /// (aqui, de 512 bytes) e o CISO depois do mapa de blocos (0x8000).
    pub fn to_dolphin_format(disc: &[u8], format: &str) -> Vec<u8> {
        match format {
            "rvz" => {
                let mut file = vec![0; 0x58 + 0x80];
                file[..4].copy_from_slice(b"RVZ\x01");
                file[0x58..0x58 + 0x80].copy_from_slice(&disc[..0x80]);
                file
            }
            "wbfs" => {
                let mut file = vec![0; 0x200 + 0x100];
                file[..4].copy_from_slice(b"WBFS");
                file[8] = 9;
                file[0x200..0x300].copy_from_slice(&disc[..0x100]);
                file
            }
            _ => {
                let mut file = vec![0; 0x8000 + disc.len()];
                file[..4].copy_from_slice(b"CISO");
                file[0x8000..].copy_from_slice(disc);
                file
            }
        }
    }

    /// Um jogo de 3DS de mentira: o .cxi (só o NCCH) ou o .3ds (o NCCH na primeira partição do NCSD).
    pub fn build_3ds_rom(program_id: u64, cxi: bool) -> Vec<u8> {
        let mut ncch = vec![0; 0x200];
        ncch[0x100..0x104].copy_from_slice(b"NCCH");
        ncch[0x118..0x120].copy_from_slice(&program_id.to_le_bytes());
        if cxi {
            return ncch;
        }
        let mut file = vec![0; 0x4000 + ncch.len()];
        file[0x100..0x104].copy_from_slice(b"NCSD");
        file[0x120..0x124].copy_from_slice(&((0x4000 / 0x200) as u32).to_le_bytes());
        file[0x4000..].copy_from_slice(&ncch);
        file
    }
}

#[cfg(test)]
mod tests {
    use super::fake_discs::*;
    use super::*;
    use crate::test_support::temp_folder;

    #[test]
    fn le_o_codigo_de_ps2_e_de_ps1_e_ignora_o_resto() {
        assert_eq!(
            serial_from_system_cnf("BOOT2 = cdrom0:\\SLUS_201.00;1\nVER = 1.00\nVMODE = NTSC").as_deref(),
            Some("SLUS-20100")
        );
        assert_eq!(serial_from_system_cnf("BOOT = cdrom:\\SLUS_001.00;1\nTCB = 4\nEVENT = 10").as_deref(), Some("SLUS-00100"));
        assert_eq!(serial_from_system_cnf("BOOT2 = cdrom0:\\SCES_511.00;1").as_deref(), Some("SCES-51100"));
        assert_eq!(serial_from_system_cnf("nada aqui"), None);
    }

    #[test]
    fn iso_de_ps2_o_codigo_vem_do_system_cnf() {
        let dir = temp_folder("disco-ps2");
        let iso = dir.join("Jogo (USA).iso");
        std::fs::write(&iso, build_iso(&[(&["SYSTEM.CNF"], b"BOOT2 = cdrom0:\\SLUS_201.00;1\r\n")])).unwrap();
        assert_eq!(read_disc_serial(&iso).as_deref(), Some("SLUS-20100"));
    }

    #[test]
    fn bin_e_cue_de_ps1_com_setores_de_2352_bytes() {
        let dir = temp_folder("disco-ps1");
        let disc = build_iso(&[(&["SYSTEM.CNF"], b"BOOT = cdrom:\\SLUS_002.00;1\r\n")]);
        std::fs::write(dir.join("Jogo (USA).bin"), to_raw_bin(&disc, 2)).unwrap();
        std::fs::write(
            dir.join("Jogo (USA).cue"),
            "FILE \"Jogo (USA).bin\" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n",
        )
        .unwrap();
        assert_eq!(read_disc_serial(&dir.join("Jogo (USA).cue")).as_deref(), Some("SLUS-00200"));
        assert_eq!(read_disc_serial(&dir.join("Jogo (USA).bin")).as_deref(), Some("SLUS-00200"));
    }

    #[test]
    fn iso_de_ps3_o_codigo_vem_do_param_sfo() {
        let dir = temp_folder("disco-ps3");
        let iso = dir.join("Manobras Radicais 3 (USA).iso");
        let sfo = build_param_sfo(&[("TITLE_ID", "BLUS30100"), ("TITLE", "Manobras Radicais 3")]);
        std::fs::write(&iso, build_iso(&[(&["PS3_GAME", "PARAM.SFO"], &sfo)])).unwrap();
        assert_eq!(read_disc_serial(&iso).as_deref(), Some("BLUS30100"));
    }

    #[test]
    fn pasta_de_jogo_de_ps3_codigo_e_nome_vem_do_param_sfo() {
        let dir = temp_folder("pasta-ps3");
        let game = dir.join("Manobras Radicais 3 [BLUS30100]");
        std::fs::create_dir_all(game.join("PS3_GAME").join("USRDIR")).unwrap();
        let eboot = game.join("PS3_GAME").join("USRDIR").join("EBOOT.BIN");
        std::fs::write(&eboot, "").unwrap();
        std::fs::write(
            game.join("PS3_GAME").join("PARAM.SFO"),
            build_param_sfo(&[("TITLE_ID", "BLUS30100"), ("TITLE", "Manobras Radicais 3")]),
        )
        .unwrap();

        assert_eq!(ps3_game_folder(&eboot), Some(game.clone()));
        assert_eq!(ps3_game_folder(&dir.join("outro.iso")), None);
        assert_eq!(read_disc_serial(&eboot).as_deref(), Some("BLUS30100"));
        assert_eq!(read_ps3_title(&eboot).as_deref(), Some("Manobras Radicais 3"));
    }

    #[test]
    fn psp_o_codigo_vem_do_param_sfo_na_iso_e_no_eboot_pbp() {
        let dir = temp_folder("disco-psp");
        let sfo = build_param_sfo(&[("DISC_ID", "ULUS10041"), ("TITLE", "Pista Portátil")]);
        std::fs::write(dir.join("Pista Portátil (USA).iso"), build_iso(&[(&["PSP_GAME", "PARAM.SFO"], &sfo)])).unwrap();
        std::fs::write(dir.join("EBOOT.PBP"), build_pbp(&sfo)).unwrap();
        assert_eq!(read_disc_serial(&dir.join("Pista Portátil (USA).iso")).as_deref(), Some("ULUS10041"));
        assert_eq!(read_disc_serial(&dir.join("EBOOT.PBP")).as_deref(), Some("ULUS10041"));
    }

    #[test]
    fn gamecube_e_wii_o_codigo_do_comeco_do_disco_na_iso_e_nos_formatos_do_dolphin() {
        let dir = temp_folder("disco-nintendo");
        let gamecube = build_nintendo_disc("GALE01", false);
        let wii = build_nintendo_disc("RSBE01", true);
        std::fs::write(dir.join("Luta Galáctica.iso"), &gamecube).unwrap();
        std::fs::write(dir.join("Luta Galáctica.rvz"), to_dolphin_format(&gamecube, "rvz")).unwrap();
        std::fs::write(dir.join("Luta Galáctica.ciso"), to_dolphin_format(&gamecube, "ciso")).unwrap();
        std::fs::write(dir.join("Festa no Parque.wbfs"), to_dolphin_format(&wii, "wbfs")).unwrap();
        std::fs::write(dir.join("Festa no Parque.iso"), &wii).unwrap();
        for (file, id) in [
            ("Luta Galáctica.iso", "GALE01"),
            ("Luta Galáctica.rvz", "GALE01"),
            ("Luta Galáctica.ciso", "GALE01"),
            ("Festa no Parque.wbfs", "RSBE01"),
            ("Festa no Parque.iso", "RSBE01"),
        ] {
            assert_eq!(read_disc_serial(&dir.join(file)).as_deref(), Some(id), "{file}");
        }
    }

    #[test]
    fn tres_ds_o_id_do_programa_no_3ds_e_no_cxi() {
        let dir = temp_folder("disco-3ds");
        std::fs::write(dir.join("Aventura de Bolso.3ds"), build_3ds_rom(0x0004_0000_0005_5d00, false)).unwrap();
        std::fs::write(dir.join("Aventura de Bolso.cxi"), build_3ds_rom(0x0004_0000_0005_5d00, true)).unwrap();
        std::fs::write(dir.join("Homebrew.3ds"), "não é um jogo de 3DS").unwrap();
        assert_eq!(read_disc_serial(&dir.join("Aventura de Bolso.3ds")).as_deref(), Some("0004000000055D00"));
        assert_eq!(read_disc_serial(&dir.join("Aventura de Bolso.cxi")).as_deref(), Some("0004000000055D00"));
        assert_eq!(read_disc_serial(&dir.join("Homebrew.3ds")), None);
    }

    #[test]
    fn formatos_comprimidos_e_arquivos_estranhos_nao_quebram() {
        let dir = temp_folder("disco-estranho");
        std::fs::write(dir.join("Jogo.chd"), "qualquer coisa").unwrap();
        std::fs::write(dir.join("Jogo.iso"), "isto não é um disco").unwrap();
        assert_eq!(read_disc_serial(&dir.join("Jogo.chd")), None);
        assert_eq!(read_disc_serial(&dir.join("Jogo.iso")), None);
        assert_eq!(read_disc_serial(&dir.join("não existe.iso")), None);
    }

    #[test]
    fn param_sfo_textos_e_numeros() {
        let sfo = parse_param_sfo(&build_param_sfo(&[("TITLE_ID", "BLUS30100"), ("TITLE", "Manobras Radicais 3")])).unwrap();
        assert_eq!(sfo["TITLE_ID"], SfoValue::Text("BLUS30100".into()));
        assert_eq!(sfo["TITLE"], SfoValue::Text("Manobras Radicais 3".into()));
    }

    #[test]
    fn o_conjunto_de_trofeus_de_um_jogo_na_pasta_e_na_iso() {
        const SET: &str = "NPWR99999_00";
        let dir = temp_folder("disco-tropdir");
        crate::test_support::create_files(
            &dir,
            &[(&format!("Pasta/PS3_GAME/TROPDIR/{SET}/TROPHY.TRP"), "trp"), ("Pasta/PS3_GAME/USRDIR/EBOOT.BIN", "")],
        );
        assert_eq!(read_ps3_trophy_sets(&dir.join("Pasta").join("PS3_GAME").join("USRDIR").join("EBOOT.BIN")), [SET]);

        let iso = dir.join("Manobras Radicais 3 (USA).iso");
        let sfo = build_param_sfo(&[("TITLE_ID", "BLUS30100"), ("TITLE", "Manobras Radicais 3")]);
        std::fs::write(
            &iso,
            build_iso(&[(&["PS3_GAME", "PARAM.SFO"], &sfo), (&["PS3_GAME", "TROPDIR", SET, "TROPHY.TRP"], b"trp")]),
        )
        .unwrap();
        assert_eq!(read_ps3_trophy_sets(&iso), [SET]);
        // Disco sem troféus, ou que não é de PS3: nada.
        std::fs::write(dir.join("Outro.iso"), build_iso(&[(&["SYSTEM.CNF"], b"BOOT2 = cdrom0:\\SLUS_201.00;1")])).unwrap();
        assert!(read_ps3_trophy_sets(&dir.join("Outro.iso")).is_empty());
        assert!(read_ps3_trophy_sets(&dir.join("não existe.iso")).is_empty());
    }
}
