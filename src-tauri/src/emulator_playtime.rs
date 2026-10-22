//! Tempo jogado registrado pelos próprios emuladores. Assim o app mostra também o que foi jogado abrindo
//! o emulador direto, sem passar pelo botão Jogar (pedido do usuário em 2026-09-19):
//! - PCSX2 e DuckStation: playtime.dat, por código do disco (ex.: SLUS-20100);
//! - RPCS3: GuiConfigs/persistent_settings.dat, por código do jogo (ex.: BLUS30100);
//! - PPSSPP: a seção [PlayTime] do ppsspp.ini, por código do disco (ex.: ULUS10041);
//! - Dolphin: Config/TimePlayed.ini, por código do disco (ex.: GALE01), sem a última vez jogado;
//! - Azahar: sysdata/play_time.bin, pelo id do programa, também sem a última vez jogado;
//! - RetroArch: um arquivo .lrtl por jogo em playlists/logs (se o registro de tempo estiver ligado nele).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use chrono::{DateTime, Duration, Local, NaiveDate, TimeZone, Utc};
use regex::Regex;
use rusqlite::Connection;

use crate::dates::iso;
use crate::discs::read_disc_serial;
use crate::emulators::EmulatorId;

/// O que um emulador registrou para um jogo.
#[derive(Clone, Debug, PartialEq)]
pub struct EmulatorPlaytime {
    pub seconds: i64,
    /// ISO, ou None se ele não guardou.
    pub last_played_at: Option<String>,
}

/// Onde estão os registros de tempo de cada emulador (None quando não existem).
#[derive(Debug, Default, PartialEq)]
pub struct PlaytimeFiles {
    pcsx2: Option<PathBuf>,
    duckstation: Option<PathBuf>,
    rpcs3: Option<PathBuf>,
    ppsspp: Option<PathBuf>,
    dolphin: Option<PathBuf>,
    azahar: Option<PathBuf>,
    /// Pasta dos registros do RetroArch (playlists/logs).
    retroarch_logs: Option<PathBuf>,
}

/// As pastas do Windows onde os emuladores instalados guardam os dados.
pub struct PlaytimeFolders {
    pub documents: PathBuf,
    pub local_app_data: Option<PathBuf>,
    pub app_data: Option<PathBuf>,
}

/// O registro do RetroArch para uma ROM (pelo nome do arquivo).
type RetroArchLookup = Box<dyn Fn(&str) -> Option<EmulatorPlaytime>>;

/// Os registros lidos, prontos para consultar por jogo.
pub struct EmulatorRecords {
    by_serial: HashMap<EmulatorId, HashMap<String, EmulatorPlaytime>>,
    retroarch: RetroArchLookup,
}

/// Tempo jogado fora do app que vira uma sessão (para a atividade por dia). Menos que isso é ruído.
const MIN_IMPORTED_SESSION_SECONDS: i64 = 60;
/// Na primeira leitura de um jogo, o tempo só entra na atividade se a última vez jogado for recente.
const IMPORT_WINDOW_DAYS: i64 = 30;

// ---------------------------------------------------------------- leitura dos arquivos

fn unix_iso(seconds: f64) -> Option<String> {
    (seconds.is_finite() && seconds > 0.0).then(|| DateTime::from_timestamp_millis((seconds * 1000.0) as i64)).flatten().map(iso)
}

/// Um número como o Number() do JavaScript lê (None se não for um número).
fn number(text: &str) -> Option<f64> {
    text.trim().parse::<f64>().ok().filter(|value| value.is_finite())
}

/// playtime.dat do PCSX2 e do DuckStation: uma linha por jogo, "CÓDIGO SEGUNDOS ÚLTIMA_VEZ" (unix).
fn parse_playtime_dat(text: &str) -> HashMap<String, EmulatorPlaytime> {
    let mut records = HashMap::new();
    for line in text.lines() {
        let mut fields = line.split_whitespace();
        let (Some(serial), Some(seconds)) = (fields.next(), fields.next().and_then(number)) else { continue };
        let last_played_at = fields.next().and_then(number).and_then(unix_iso);
        records.insert(serial.to_uppercase(), EmulatorPlaytime { seconds: seconds as i64, last_played_at });
    }
    records
}

/// As linhas `chave = valor` de uma seção de um arquivo .ini (as chaves em maiúsculas, na ordem).
fn ini_section(text: &str, name: &str) -> Vec<(String, String)> {
    static HEADER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*\[(.+)\]\s*$").expect("expressão fixa"));
    static ENTRY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*([^=]+?)\s*=\s*(.*?)\s*$").expect("expressão fixa"));
    let mut entries: Vec<(String, String)> = Vec::new();
    let mut section = String::new();
    for line in text.lines() {
        if let Some(header) = HEADER.captures(line) {
            section = header[1].to_string();
            continue;
        }
        if section != name {
            continue;
        }
        if let Some(entry) = ENTRY.captures(line) {
            let key = entry[1].to_uppercase();
            match entries.iter_mut().find(|(existing, _)| *existing == key) {
                Some(existing) => existing.1 = entry[2].to_string(),
                None => entries.push((key, entry[2].to_string())),
            }
        }
    }
    entries
}

/// persistent_settings.dat do RPCS3: seções [Playtime] (milissegundos) e [LastPlayed] (data local).
fn parse_rpcs3_settings(text: &str) -> HashMap<String, EmulatorPlaytime> {
    let playtime: HashMap<String, String> = ini_section(text, "Playtime").into_iter().collect();
    let last_played: HashMap<String, String> = ini_section(text, "LastPlayed").into_iter().collect();
    playtime
        .keys()
        .chain(last_played.keys())
        .map(|serial| {
            let milliseconds = playtime.get(serial).map_or(Some(0.0), |value| number(value));
            let record = EmulatorPlaytime {
                seconds: milliseconds.map_or(0, |milliseconds| (milliseconds / 1000.0).round() as i64),
                last_played_at: last_played.get(serial).and_then(|text| parse_local_date_time(text)),
            };
            (serial.clone(), record)
        })
        .collect()
}

/// ppsspp.ini: a seção [PlayTime], com "SEGUNDOS,ÚLTIMA_VEZ" (unix) por código do disco.
fn parse_ppsspp_ini(text: &str) -> HashMap<String, EmulatorPlaytime> {
    let mut records = HashMap::new();
    for (serial, value) in ini_section(text, "PlayTime") {
        let mut parts = value.split(',');
        let Some(seconds) = parts.next().and_then(number) else { continue };
        let last_played_at = parts.next().and_then(number).and_then(unix_iso);
        records.insert(serial, EmulatorPlaytime { seconds: seconds as i64, last_played_at });
    }
    records
}

/// TimePlayed.ini do Dolphin: a seção [TimePlayed], com os milissegundos por código do disco.
fn parse_dolphin_time_played(text: &str) -> HashMap<String, EmulatorPlaytime> {
    ini_section(text, "TimePlayed")
        .into_iter()
        .filter_map(|(serial, value)| {
            number(&value).map(|milliseconds| {
                (serial, EmulatorPlaytime { seconds: (milliseconds / 1000.0).round() as i64, last_played_at: None })
            })
        })
        .collect()
}

/// play_time.bin do Azahar: 16 bytes por jogo, o id do programa e os segundos (os dois de 64 bits).
fn parse_azahar_play_time(data: &[u8]) -> HashMap<String, EmulatorPlaytime> {
    data.as_chunks::<16>()
        .0
        .iter()
        .filter_map(|entry| {
            let program_id = u64::from_le_bytes(entry[..8].try_into().ok()?);
            let seconds = u64::from_le_bytes(entry[8..].try_into().ok()?);
            (program_id != 0)
                .then(|| (format!("{program_id:016X}"), EmulatorPlaytime { seconds: seconds as i64, last_played_at: None }))
        })
        .collect()
}

/// Um registro do RetroArch (.lrtl): tempo "H:MM:SS" e última vez (data local).
fn parse_retroarch_log(text: &str) -> Option<EmulatorPlaytime> {
    static RUNTIME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\d+):(\d{2}):(\d{2})$").expect("expressão fixa"));
    let log: serde_json::Value = serde_json::from_str(text).ok()?;
    let parts = RUNTIME.captures(log.get("runtime")?.as_str()?)?;
    let part = |index: usize| parts[index].parse::<i64>().unwrap_or(0);
    Some(EmulatorPlaytime {
        seconds: part(1) * 3600 + part(2) * 60 + part(3),
        last_played_at: log.get("last_played").and_then(|value| value.as_str()).and_then(parse_local_date_time),
    })
}

/// "2026-09-12T21:27:47" ou "2026-09-12 19:37:50" (horário do computador) → ISO.
fn parse_local_date_time(text: &str) -> Option<String> {
    static DATE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})").expect("expressão fixa"));
    let parts = DATE.captures(text)?;
    let value = |index: usize| parts[index].parse::<u32>().ok();
    let date = NaiveDate::from_ymd_opt(parts[1].parse().ok()?, value(2)?, value(3)?)?;
    let local = date.and_hms_opt(value(4)?, value(5)?, value(6)?)?;
    // Uma hora que não existe (a que o horário de verão pula) vale como a seguinte, como no JavaScript.
    let moment = Local
        .from_local_datetime(&local)
        .earliest()
        .or_else(|| Local.from_local_datetime(&(local + Duration::hours(1))).earliest())?;
    Some(iso(moment.with_timezone(&Utc)))
}

// ---------------------------------------------------------------- onde ficam os arquivos

/// Os registros de tempo de cada emulador configurado:
/// - PCSX2: na pasta dele se for portátil (portable.ini ou portable.txt), senão em Documentos\PCSX2\inis;
/// - DuckStation: na pasta dele se for portátil (portable.txt), senão em AppData\Local\DuckStation
///   (versões novas) ou Documentos\DuckStation (antigas);
/// - RPCS3: sempre na pasta dele (GuiConfigs);
/// - PPSSPP: no memstick ao lado dele (portátil) ou, com o installed.txt, em Documentos\PPSSPP (ou na
///   pasta que o installed.txt indicar);
/// - Dolphin: na pasta User ao lado dele se for portátil (portable.txt), senão em Documentos\Dolphin
///   Emulator (versões antigas) ou AppData\Roaming\Dolphin Emulator;
/// - Azahar: na pasta user ao lado dele (portátil), senão em AppData\Roaming\Azahar;
/// - RetroArch: playlists\logs na pasta dele (ou na pasta de listas configurada no retroarch.cfg).
pub fn find_playtime_files(emulator_paths: &HashMap<EmulatorId, String>, folders: &PlaytimeFolders) -> PlaytimeFiles {
    let first_existing = |paths: Vec<Option<PathBuf>>| paths.into_iter().flatten().find(|path| path.exists());
    let dir_of = |id: EmulatorId| emulator_paths.get(&id).and_then(|path| Path::new(path).parent().map(Path::to_path_buf));
    let in_app_data =
        |parts: &[&str]| folders.app_data.as_ref().map(|root| parts.iter().fold(root.clone(), |path, part| path.join(part)));

    let pcsx2 = dir_of(EmulatorId::Pcsx2).and_then(|dir| {
        let portable = dir.join("portable.ini").exists() || dir.join("portable.txt").exists();
        let root = if portable { dir } else { folders.documents.join("PCSX2") };
        first_existing(vec![Some(root.join("inis").join("playtime.dat"))])
    });
    let duckstation = dir_of(EmulatorId::Duckstation).and_then(|dir| {
        if dir.join("portable.txt").exists() {
            return first_existing(vec![Some(dir.join("playtime.dat"))]);
        }
        first_existing(vec![
            folders.local_app_data.as_ref().map(|local| local.join("DuckStation").join("playtime.dat")),
            Some(folders.documents.join("DuckStation").join("playtime.dat")),
        ])
    });
    let rpcs3 = dir_of(EmulatorId::Rpcs3)
        .and_then(|dir| first_existing(vec![Some(dir.join("GuiConfigs").join("persistent_settings.dat"))]));
    let ppsspp = dir_of(EmulatorId::Ppsspp).and_then(|dir| {
        let memstick = ppsspp_memstick(&dir, &folders.documents);
        first_existing(vec![Some(memstick.join("PSP").join("SYSTEM").join("ppsspp.ini"))])
    });
    let dolphin = dir_of(EmulatorId::Dolphin).and_then(|dir| {
        if dir.join("portable.txt").exists() {
            return first_existing(vec![Some(dir.join("User").join("Config").join("TimePlayed.ini"))]);
        }
        first_existing(vec![
            Some(folders.documents.join("Dolphin Emulator").join("Config").join("TimePlayed.ini")),
            in_app_data(&["Dolphin Emulator", "Config", "TimePlayed.ini"]),
        ])
    });
    let azahar = dir_of(EmulatorId::Azahar).and_then(|dir| {
        if dir.join("user").exists() {
            return first_existing(vec![Some(dir.join("user").join("sysdata").join("play_time.bin"))]);
        }
        first_existing(vec![in_app_data(&["Azahar", "sysdata", "play_time.bin"])])
    });
    let retroarch_logs =
        dir_of(EmulatorId::Retroarch).and_then(|dir| first_existing(vec![Some(retroarch_playlists(&dir).join("logs"))]));

    PlaytimeFiles { pcsx2, duckstation, rpcs3, ppsspp, dolphin, azahar, retroarch_logs }
}

/// O "cartão de memória" do PPSSPP: a pasta memstick ao lado dele (portátil) ou, se houver o
/// installed.txt, Documentos\PPSSPP (ou a pasta escrita na primeira linha do installed.txt).
fn ppsspp_memstick(ppsspp_dir: &Path, documents: &Path) -> PathBuf {
    let installed = ppsspp_dir.join("installed.txt");
    if !installed.exists() {
        return ppsspp_dir.join("memstick");
    }
    let custom =
        std::fs::read_to_string(&installed).ok().and_then(|text| text.lines().next().map(|line| PathBuf::from(line.trim())));
    match custom {
        Some(path) if path.is_absolute() => path,
        _ => documents.join("PPSSPP"),
    }
}

/// A pasta de listas do RetroArch: a do retroarch.cfg (":" é a pasta do próprio RetroArch) ou a padrão.
fn retroarch_playlists(retroarch_dir: &Path) -> PathBuf {
    static SETTING: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"(?m)^\s*playlist_directory\s*=\s*"([^"]*)""#).expect("expressão fixa"));
    let configured = std::fs::read_to_string(retroarch_dir.join("retroarch.cfg"))
        .ok()
        .and_then(|config| SETTING.captures(&config).map(|captures| captures[1].to_string()))
        .filter(|value| !value.is_empty() && value != "default")
        .map(|value| match value.strip_prefix(':') {
            Some(relative) => retroarch_dir.join(relative.trim_start_matches(['\\', '/'])),
            None => PathBuf::from(value),
        });
    match configured {
        Some(path) if path.is_absolute() => path,
        _ => retroarch_dir.join("playlists"),
    }
}

/// Lê todos os registros (um arquivo que falhar é tratado como vazio).
pub fn read_emulator_records(files: PlaytimeFiles) -> EmulatorRecords {
    let read = |path: &Option<PathBuf>, parse: fn(&str) -> HashMap<String, EmulatorPlaytime>| {
        path.as_ref().and_then(|path| std::fs::read_to_string(path).ok()).map(|text| parse(&text))
    };
    let mut by_serial = HashMap::new();
    let parsed = [
        (EmulatorId::Pcsx2, read(&files.pcsx2, parse_playtime_dat)),
        (EmulatorId::Duckstation, read(&files.duckstation, parse_playtime_dat)),
        (EmulatorId::Rpcs3, read(&files.rpcs3, parse_rpcs3_settings)),
        (EmulatorId::Ppsspp, read(&files.ppsspp, parse_ppsspp_ini)),
        (EmulatorId::Dolphin, read(&files.dolphin, parse_dolphin_time_played)),
        // O único registro binário.
        (
            EmulatorId::Azahar,
            files.azahar.as_ref().and_then(|path| std::fs::read(path).ok()).map(|data| parse_azahar_play_time(&data)),
        ),
    ];
    for (emulator, records) in parsed {
        if let Some(records) = records {
            by_serial.insert(emulator, records);
        }
    }

    let logs = files.retroarch_logs;
    let log_folders: Vec<PathBuf> = logs
        .as_ref()
        .and_then(|logs| std::fs::read_dir(logs).ok())
        .map(|entries| {
            entries.filter_map(|entry| entry.ok()).filter(|entry| entry.path().is_dir()).map(|entry| entry.path()).collect()
        })
        .unwrap_or_default();
    EmulatorRecords {
        by_serial,
        retroarch: Box::new(move |rom_path| {
            // Um arquivo por jogo, com o nome da ROM, na pasta do core (ou direto em logs, se o registro
            // for o "agregado"). Vale o maior, se houver mais de um core.
            let stem = Path::new(rom_path).file_stem()?.to_string_lossy().into_owned();
            logs.iter()
                .chain(log_folders.iter())
                .filter_map(|folder| std::fs::read_to_string(folder.join(format!("{stem}.lrtl"))).ok())
                .filter_map(|text| parse_retroarch_log(&text))
                .fold(None, |best: Option<EmulatorPlaytime>, record| match best {
                    Some(best) if best.seconds >= record.seconds => Some(best),
                    _ => Some(record),
                })
        }),
    }
}

// ---------------------------------------------------------------- juntar com a biblioteca

struct SyncRow {
    id: i64,
    emulator: EmulatorId,
    rom_path: String,
    serial: Option<String>,
    emulator_playtime_seconds: i64,
    emulator_last_played_at: Option<String>,
    emulator_synced_at: Option<String>,
}

/// Atualiza o tempo registrado pelos emuladores em cada jogo. A tela mostra o maior entre esse e o
/// contado pelo app (os dois medem as mesmas sessões quando o jogo é aberto pelo botão Jogar; o do
/// emulador inclui também o que foi jogado fora do app). O tempo jogado fora do app vira uma sessão,
/// para entrar na atividade por dia das Estatísticas (veja `session_to_import`). Devolve quantos jogos
/// mudaram.
pub fn sync_emulator_playtime(db: &Connection, records: &EmulatorRecords, now: DateTime<Utc>) -> rusqlite::Result<usize> {
    let rows: Vec<SyncRow> = db
        .prepare(
            "SELECT id, emulator_id, rom_path, serial, emulator_playtime_seconds, emulator_last_played_at, emulator_synced_at
             FROM games WHERE emulator_id IS NOT NULL AND rom_path IS NOT NULL",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                SyncRow {
                    id: row.get(0)?,
                    emulator: EmulatorId::Pcsx2,
                    rom_path: row.get(2)?,
                    serial: row.get(3)?,
                    emulator_playtime_seconds: row.get(4)?,
                    emulator_last_played_at: row.get(5)?,
                    emulator_synced_at: row.get(6)?,
                },
            ))
        })?
        .filter_map(|row| match row {
            Ok((emulator, row)) => EmulatorId::from_id(&emulator).map(|emulator| Ok(SyncRow { emulator, ..row })),
            Err(error) => Some(Err(error)),
        })
        .collect::<rusqlite::Result<_>>()?;

    let mut changed = 0;
    for row in rows {
        let Some(record) = lookup(db, &row, records)? else { continue };
        let same = record.seconds == row.emulator_playtime_seconds && record.last_played_at == row.emulator_last_played_at;
        if same && row.emulator_synced_at.is_some() {
            continue;
        }

        let transaction = db.unchecked_transaction()?;
        let counted: i64 = match &row.emulator_synced_at {
            Some(synced_at) => transaction.query_row(
                "SELECT COALESCE(SUM(seconds), 0) FROM play_sessions WHERE game_id = ?1 AND source = 'app' AND ended_at > ?2",
                (row.id, synced_at),
                |result| result.get(0),
            )?,
            // Na primeira leitura desconta tudo o que já virou sessão, de onde quer que tenha vindo.
            None => transaction.query_row(
                "SELECT COALESCE(SUM(seconds), 0) FROM play_sessions WHERE game_id = ?1",
                [row.id],
                |result| result.get(0),
            )?,
        };
        if let Some((ended_at, seconds)) = session_to_import(&row, &record, counted, now) {
            let started_at = DateTime::parse_from_rfc3339(&ended_at)
                .map(|end| iso(end.with_timezone(&Utc) - Duration::seconds(seconds)))
                .unwrap_or_else(|_| ended_at.clone());
            transaction.execute(
                "INSERT INTO play_sessions (game_id, started_at, ended_at, seconds, source) VALUES (?1, ?2, ?3, ?4, 'emulador')",
                (row.id, started_at, &ended_at, seconds),
            )?;
        }
        transaction.execute(
            "UPDATE games SET emulator_playtime_seconds = ?1, emulator_last_played_at = ?2, emulator_synced_at = ?3 WHERE id = ?4",
            (record.seconds, &record.last_played_at, iso(now), row.id),
        )?;
        transaction.commit()?;
        changed += 1;
    }
    Ok(changed)
}

/// Quanto tempo desta leitura vira uma sessão na atividade por dia, e em que dia ela termina (None =
/// nenhuma). Na primeira leitura de um jogo entra tudo o que o emulador já tinha registrado, no dia da
/// última vez jogado (escolha do usuário em 2026-09-19), e só se esse dia for dos últimos 30 dias, que é
/// o período do gráfico; como o emulador guarda só a última data, o que foi jogado em dias anteriores cai
/// nela também. Nas leituras seguintes entra o que apareceu desde a anterior. Nos dois casos, o tempo que
/// já virou sessão é descontado (na primeira leitura, todas as sessões do jogo; depois, as que o app
/// contou desde a leitura anterior), para não aparecer duas vezes.
fn session_to_import(row: &SyncRow, record: &EmulatorPlaytime, counted: i64, now: DateTime<Utc>) -> Option<(String, i64)> {
    let first = row.emulator_synced_at.is_none();
    let seconds = if first { record.seconds } else { record.seconds - row.emulator_playtime_seconds } - counted;
    if seconds < MIN_IMPORTED_SESSION_SECONDS {
        return None;
    }
    if !first {
        return Some((record.last_played_at.clone().unwrap_or_else(|| iso(now)), seconds));
    }
    let last_played_at = record.last_played_at.as_ref()?;
    let oldest = now - Duration::days(IMPORT_WINDOW_DAYS);
    let last_played = DateTime::parse_from_rfc3339(last_played_at).ok()?;
    (last_played >= oldest).then(|| (last_played_at.clone(), seconds))
}

/// O registro do emulador para um jogo (o código do disco é lido uma vez e guardado no banco).
fn lookup(db: &Connection, row: &SyncRow, records: &EmulatorRecords) -> rusqlite::Result<Option<EmulatorPlaytime>> {
    if row.emulator == EmulatorId::Retroarch {
        return Ok((records.retroarch)(&row.rom_path));
    }
    let Some(by_serial) = records.by_serial.get(&row.emulator) else { return Ok(None) };
    let mut serial = row.serial.clone();
    if serial.is_none() && Path::new(&row.rom_path).exists() {
        // "" = já tentou e não achou (ex.: CHD comprimido): não lê o disco de novo.
        let read = read_disc_serial(Path::new(&row.rom_path)).unwrap_or_default();
        db.execute("UPDATE games SET serial = ?1 WHERE id = ?2", (&read, row.id))?;
        serial = Some(read);
    }
    Ok(serial.filter(|serial| !serial.is_empty()).and_then(|serial| by_serial.get(&serial.to_uppercase()).cloned()))
}

/// Lê o código guardado de um jogo (para os testes conferirem).
#[cfg(test)]
fn stored_serial(db: &Connection, game_id: i64) -> Option<String> {
    use rusqlite::OptionalExtension;
    db.query_row("SELECT serial FROM games WHERE id = ?1", [game_id], |row| row.get(0)).optional().ok().flatten().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::discs::fake_discs::{build_3ds_rom, build_iso, build_nintendo_disc, build_param_sfo};
    use crate::i18n::Language;
    use crate::library::{EmulatedGame, add_emulated_game, record_play_session};
    use crate::test_support::{create_files, memory_database, temp_folder};

    /// Uma linha do playtime.dat, do jeitinho que o PCSX2 e o DuckStation escrevem (campos alinhados).
    fn line(serial: &str, seconds: i64, last_played: i64) -> String {
        format!("{serial:<32} {seconds:<20} {last_played:<20}")
    }

    fn unix(seconds: i64) -> String {
        iso(DateTime::from_timestamp(seconds, 0).unwrap())
    }

    /// Uma data e hora no horário do computador, em ISO (ano, mês, dia, hora, minuto).
    fn local_iso(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> String {
        iso(Local.with_ymd_and_hms(year, month, day, hour, minute, 0).unwrap().with_timezone(&Utc))
    }

    fn local(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
        Local.with_ymd_and_hms(year, month, day, hour, minute, 0).unwrap().with_timezone(&Utc)
    }

    fn record(seconds: i64, last_played_at: Option<&str>) -> EmulatorPlaytime {
        EmulatorPlaytime { seconds, last_played_at: last_played_at.map(str::to_string) }
    }

    #[test]
    fn playtime_dat_do_pcsx2_e_do_duckstation() {
        let records = parse_playtime_dat(
            &[line("SLUS-20100", 2237, 1789843213), line("SLUS-00100", 0, 0), "linha estranha".into(), String::new()].join("\n"),
        );
        assert_eq!(records["SLUS-20100"], record(2237, Some(&unix(1789843213))));
        assert_eq!(records["SLUS-00100"], record(0, None));
        assert_eq!(records.len(), 2);
    }

    #[test]
    fn persistent_settings_dat_do_rpcs3() {
        let records = parse_rpcs3_settings("[Playtime]\nBLUS30100=294145\n\n[LastPlayed]\nBLUS30100=2026-09-12T21:27:47\n");
        let expected = iso(Local.with_ymd_and_hms(2026, 9, 12, 21, 27, 47).unwrap().with_timezone(&Utc));
        assert_eq!(records["BLUS30100"], record(294, Some(&expected)));
    }

    #[test]
    fn ppsspp_ini_secao_playtime() {
        let records = parse_ppsspp_ini(
            "[General]\nFirstRun = False\n[PlayTime]\nULUS10041 = 5400,1789843213\nULES00151 = 30,0\n[Recent]\nFileName0 = x.iso\n",
        );
        assert_eq!(records["ULUS10041"], record(5400, Some(&unix(1789843213))));
        assert_eq!(records["ULES00151"], record(30, None));
        assert_eq!(records.len(), 2);
    }

    #[test]
    fn time_played_ini_do_dolphin() {
        let records = parse_dolphin_time_played("[TimePlayed]\nGALE01 = 7265000\nRSBE01 = estranho\n");
        assert_eq!(records["GALE01"], record(7265, None));
        assert_eq!(records.len(), 1);
    }

    #[test]
    fn play_time_bin_do_azahar() {
        let mut data = Vec::new();
        for (id, seconds) in [(0x0004_0000_0005_5d00u64, 3600u64), (0, 99), (0x0004_0000_000e_e000, 45)] {
            data.extend(id.to_le_bytes());
            data.extend(seconds.to_le_bytes());
        }
        let records = parse_azahar_play_time(&data);
        assert_eq!(records["0004000000055D00"], record(3600, None));
        assert_eq!(records["00040000000EE000"], record(45, None));
        assert_eq!(records.len(), 2);
    }

    #[test]
    fn registro_do_retroarch() {
        let log = r#"{"version": "1.0", "runtime": "1:02:25", "last_played": "2026-09-12 19:37:50", "play_count": "4"}"#;
        let expected = iso(Local.with_ymd_and_hms(2026, 9, 12, 19, 37, 50).unwrap().with_timezone(&Utc));
        assert_eq!(parse_retroarch_log(log), Some(record(3745, Some(&expected))));
        assert_eq!(parse_retroarch_log("{}"), None);
        assert_eq!(parse_retroarch_log("não é json"), None);
    }

    fn folders(dir: &Path) -> PlaytimeFolders {
        PlaytimeFolders {
            documents: dir.join("Documentos"),
            local_app_data: Some(dir.join("LocalAppData")),
            app_data: Some(dir.join("AppData")),
        }
    }

    fn paths(dir: &Path, list: &[(EmulatorId, &str)]) -> HashMap<EmulatorId, String> {
        list.iter().map(|(id, path)| (*id, dir.join(path).to_string_lossy().into_owned())).collect()
    }

    #[test]
    fn pcsx2_portatil_duckstation_no_appdata_rpcs3_e_retroarch_na_pasta_deles() {
        let dir = temp_folder("tempo-pastas");
        create_files(
            &dir,
            &[
                ("PCSX2/portable.ini", ""),
                ("PCSX2/inis/playtime.dat", ""),
                ("PCSX2/pcsx2-qt.exe", ""),
                ("DuckStation/duckstation-qt.exe", ""),
                ("LocalAppData/DuckStation/playtime.dat", ""),
                ("RPCS3/rpcs3.exe", ""),
                ("RPCS3/GuiConfigs/persistent_settings.dat", ""),
                ("RetroArch/retroarch.exe", ""),
                ("RetroArch/playlists/logs/mGBA/Jogo.lrtl", ""),
            ],
        );
        let emulators = paths(
            &dir,
            &[
                (EmulatorId::Pcsx2, "PCSX2/pcsx2-qt.exe"),
                (EmulatorId::Duckstation, "DuckStation/duckstation-qt.exe"),
                (EmulatorId::Rpcs3, "RPCS3/rpcs3.exe"),
                (EmulatorId::Retroarch, "RetroArch/retroarch.exe"),
            ],
        );
        let files = find_playtime_files(&emulators, &folders(&dir));
        assert_eq!(files.pcsx2, Some(dir.join("PCSX2").join("inis").join("playtime.dat")));
        assert_eq!(files.duckstation, Some(dir.join("LocalAppData").join("DuckStation").join("playtime.dat")));
        assert_eq!(files.rpcs3, Some(dir.join("RPCS3").join("GuiConfigs").join("persistent_settings.dat")));
        assert_eq!(files.retroarch_logs, Some(dir.join("RetroArch").join("playlists").join("logs")));
    }

    #[test]
    fn ppsspp_dolphin_e_azahar_portateis_tudo_na_pasta_deles() {
        let dir = temp_folder("tempo-portateis");
        create_files(
            &dir,
            &[
                ("PPSSPP/PPSSPPWindows64.exe", ""),
                ("PPSSPP/memstick/PSP/SYSTEM/ppsspp.ini", ""),
                ("Dolphin/Dolphin.exe", ""),
                ("Dolphin/portable.txt", ""),
                ("Dolphin/User/Config/TimePlayed.ini", ""),
                ("Azahar/azahar.exe", ""),
                ("Azahar/user/sysdata/play_time.bin", ""),
            ],
        );
        let emulators = paths(
            &dir,
            &[
                (EmulatorId::Ppsspp, "PPSSPP/PPSSPPWindows64.exe"),
                (EmulatorId::Dolphin, "Dolphin/Dolphin.exe"),
                (EmulatorId::Azahar, "Azahar/azahar.exe"),
            ],
        );
        let files = find_playtime_files(&emulators, &folders(&dir));
        assert_eq!(files.ppsspp, Some(dir.join("PPSSPP").join("memstick").join("PSP").join("SYSTEM").join("ppsspp.ini")));
        assert_eq!(files.dolphin, Some(dir.join("Dolphin").join("User").join("Config").join("TimePlayed.ini")));
        assert_eq!(files.azahar, Some(dir.join("Azahar").join("user").join("sysdata").join("play_time.bin")));
    }

    #[test]
    fn ppsspp_dolphin_e_azahar_instalados_em_documentos_e_no_appdata() {
        let dir = temp_folder("tempo-instalados");
        create_files(
            &dir,
            &[
                ("PPSSPP/PPSSPPWindows64.exe", ""),
                ("PPSSPP/installed.txt", ""),
                ("Documentos/PPSSPP/PSP/SYSTEM/ppsspp.ini", ""),
                ("Dolphin/Dolphin.exe", ""),
                ("AppData/Dolphin Emulator/Config/TimePlayed.ini", ""),
                ("Azahar/azahar.exe", ""),
                ("AppData/Azahar/sysdata/play_time.bin", ""),
            ],
        );
        let emulators = paths(
            &dir,
            &[
                (EmulatorId::Ppsspp, "PPSSPP/PPSSPPWindows64.exe"),
                (EmulatorId::Dolphin, "Dolphin/Dolphin.exe"),
                (EmulatorId::Azahar, "Azahar/azahar.exe"),
            ],
        );
        let files = find_playtime_files(&emulators, &folders(&dir));
        assert_eq!(files.ppsspp, Some(dir.join("Documentos").join("PPSSPP").join("PSP").join("SYSTEM").join("ppsspp.ini")));
        assert_eq!(files.dolphin, Some(dir.join("AppData").join("Dolphin Emulator").join("Config").join("TimePlayed.ini")));
        assert_eq!(files.azahar, Some(dir.join("AppData").join("Azahar").join("sysdata").join("play_time.bin")));

        // Um Dolphin antigo guardava em Documentos, e essa pasta continua valendo enquanto existir.
        create_files(&dir, &[("Documentos/Dolphin Emulator/Config/TimePlayed.ini", "")]);
        let files = find_playtime_files(&emulators, &folders(&dir));
        assert_eq!(files.dolphin, Some(dir.join("Documentos").join("Dolphin Emulator").join("Config").join("TimePlayed.ini")));
    }

    #[test]
    fn sem_emulador_configurado_nao_ha_o_que_ler() {
        let dir = temp_folder("tempo-nada");
        assert_eq!(find_playtime_files(&HashMap::new(), &folders(&dir)), PlaytimeFiles::default());
    }

    #[test]
    fn ppsspp_dolphin_e_azahar_o_codigo_vem_do_jogo_e_o_tempo_do_registro() {
        let dir = temp_folder("tempo-codigos");
        create_files(
            &dir,
            &[
                ("PPSSPP/PPSSPPWindows64.exe", ""),
                ("PPSSPP/memstick/PSP/SYSTEM/ppsspp.ini", "[PlayTime]\nULUS10041 = 5400,1789843213\n"),
                ("Dolphin/Dolphin.exe", ""),
                ("Dolphin/portable.txt", ""),
                ("Dolphin/User/Config/TimePlayed.ini", "[TimePlayed]\nGALE01 = 7200000\n"),
                ("Azahar/azahar.exe", ""),
            ],
        );
        std::fs::create_dir_all(dir.join("Roms")).unwrap();
        std::fs::create_dir_all(dir.join("Azahar").join("user").join("sysdata")).unwrap();
        let mut azahar = 0x0004_0000_0005_5d00u64.to_le_bytes().to_vec();
        azahar.extend(1800u64.to_le_bytes());
        std::fs::write(dir.join("Azahar").join("user").join("sysdata").join("play_time.bin"), azahar).unwrap();
        let sfo = build_param_sfo(&[("DISC_ID", "ULUS10041")]);
        std::fs::write(dir.join("Roms").join("Pista Portátil (USA).iso"), build_iso(&[(&["PSP_GAME", "PARAM.SFO"], &sfo)]))
            .unwrap();
        std::fs::write(dir.join("Roms").join("Luta Galáctica (USA).iso"), build_nintendo_disc("GALE01", false)).unwrap();
        std::fs::write(dir.join("Roms").join("Aventura de Bolso (USA).3ds"), build_3ds_rom(0x0004_0000_0005_5d00, false))
            .unwrap();

        let db = memory_database();
        for (title, file, emulator) in [
            ("Pista Portátil", "Pista Portátil (USA).iso", EmulatorId::Ppsspp),
            ("Luta Galáctica", "Luta Galáctica (USA).iso", EmulatorId::Dolphin),
            ("Aventura de Bolso", "Aventura de Bolso (USA).3ds", EmulatorId::Azahar),
        ] {
            let rom = dir.join("Roms").join(file).to_string_lossy().into_owned();
            let game = EmulatedGame { title, rom_path: &rom, platform: "Console", library: emulator.id(), emulator, core: None };
            add_emulated_game(&db, Language::PtBr, &game).unwrap();
        }
        let emulators = paths(
            &dir,
            &[
                (EmulatorId::Ppsspp, "PPSSPP/PPSSPPWindows64.exe"),
                (EmulatorId::Dolphin, "Dolphin/Dolphin.exe"),
                (EmulatorId::Azahar, "Azahar/azahar.exe"),
            ],
        );
        let records = read_emulator_records(find_playtime_files(&emulators, &folders(&dir)));
        assert_eq!(sync_emulator_playtime(&db, &records, Utc::now()).unwrap(), 3);

        let mut query =
            db.prepare("SELECT title, emulator_playtime_seconds, emulator_last_played_at FROM games ORDER BY title").unwrap();
        let games: Vec<(String, i64, Option<String>)> =
            query.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap().map(Result::unwrap).collect();
        assert_eq!(
            games,
            [
                ("Aventura de Bolso".to_string(), 1800, None),
                ("Luta Galáctica".to_string(), 7200, None),
                ("Pista Portátil".to_string(), 5400, Some(unix(1789843213))),
            ]
        );
    }

    const SERIAL: &str = "SLUS-20100";

    /// Um banco com um jogo de PS2 e o código do disco já guardado.
    fn setup() -> (Connection, i64) {
        let db = memory_database();
        let game = EmulatedGame {
            title: "Corrida Noturna",
            rom_path: r"D:\PS2\Corrida Noturna.iso",
            platform: "PlayStation 2",
            library: "PCSX2",
            emulator: EmulatorId::Pcsx2,
            core: None,
        };
        let id = add_emulated_game(&db, Language::PtBr, &game).unwrap().unwrap();
        db.execute("UPDATE games SET serial = ?1 WHERE id = ?2", (SERIAL, id)).unwrap();
        (db, id)
    }

    fn records(playtime: EmulatorPlaytime) -> EmulatorRecords {
        EmulatorRecords {
            by_serial: HashMap::from([(EmulatorId::Pcsx2, HashMap::from([(SERIAL.to_string(), playtime)]))]),
            retroarch: Box::new(|_| None),
        }
    }

    fn sessions(db: &Connection) -> Vec<(i64, String, String)> {
        let mut query = db.prepare("SELECT seconds, ended_at, source FROM play_sessions ORDER BY id").unwrap();
        query.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap().map(Result::unwrap).collect()
    }

    fn emulator_seconds(db: &Connection) -> i64 {
        db.query_row("SELECT emulator_playtime_seconds FROM games", [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn primeira_leitura_o_tempo_entra_na_biblioteca_e_na_atividade_da_ultima_vez() {
        let (db, _) = setup();
        let last_played = local_iso(2026, 9, 19, 15, 40);
        let now = local(2026, 9, 19, 20, 0);

        assert_eq!(sync_emulator_playtime(&db, &records(record(2237, Some(&last_played))), now).unwrap(), 1);
        assert_eq!(emulator_seconds(&db), 2237);
        assert_eq!(sessions(&db), [(2237, last_played.clone(), "emulador".to_string())]);
        // Ler de novo, sem nada novo, não mexe em nada.
        assert_eq!(sync_emulator_playtime(&db, &records(record(2237, Some(&last_played))), now).unwrap(), 0);
        assert_eq!(sessions(&db).len(), 1);
    }

    #[test]
    fn recomecar_a_leitura_nao_conta_de_novo_o_que_ja_virou_sessao() {
        let (db, _) = setup();
        let last_played = local_iso(2026, 9, 19, 15, 40);
        let now = local(2026, 9, 19, 20, 0);
        sync_emulator_playtime(&db, &records(record(2237, Some(&last_played))), now).unwrap();
        // A migração 4 zera a última leitura para o tempo antigo entrar na atividade por dia.
        db.execute("UPDATE games SET emulator_synced_at = NULL", []).unwrap();
        sync_emulator_playtime(&db, &records(record(2237, Some(&last_played))), now).unwrap();
        assert_eq!(sessions(&db).len(), 1);
    }

    #[test]
    fn primeira_leitura_de_um_jogo_parado_ha_meses_so_o_total() {
        let (db, _) = setup();
        let last_played = local_iso(2026, 6, 1, 15, 0);
        sync_emulator_playtime(&db, &records(record(7200, Some(&last_played))), local(2026, 9, 19, 20, 0)).unwrap();
        assert_eq!(emulator_seconds(&db), 7200);
        assert!(sessions(&db).is_empty());
    }

    #[test]
    fn o_que_foi_jogado_fora_do_app_depois_da_ultima_leitura_vira_uma_sessao() {
        let (db, _) = setup();
        let before = local_iso(2026, 9, 18, 20, 0);
        sync_emulator_playtime(&db, &records(record(600, Some(&before))), local(2026, 9, 19, 8, 0)).unwrap();
        let last_played = local_iso(2026, 9, 19, 21, 30);
        assert_eq!(
            sync_emulator_playtime(&db, &records(record(2400, Some(&last_played))), local(2026, 9, 19, 21, 35)).unwrap(),
            1
        );
        assert_eq!(sessions(&db), [(600, before, "emulador".to_string()), (1800, last_played, "emulador".to_string())]);
    }

    #[test]
    fn o_tempo_contado_pelo_app_nao_entra_duas_vezes() {
        let (db, id) = setup();
        let before = local_iso(2026, 9, 18, 20, 0);
        sync_emulator_playtime(&db, &records(record(600, Some(&before))), local(2026, 9, 19, 20, 0)).unwrap();
        // O usuário jogou pelo botão Jogar: o app registrou a sessão, e o emulador somou o mesmo tempo.
        let ended_at = local(2026, 9, 19, 22, 0);
        record_play_session(&db, Language::PtBr, id, 1800.0, ended_at).unwrap();
        sync_emulator_playtime(&db, &records(record(600 + 1790, Some(&iso(ended_at)))), local(2026, 9, 19, 22, 5)).unwrap();
        let sources: Vec<String> = sessions(&db).into_iter().map(|session| session.2).collect();
        assert_eq!(sources, ["emulador", "app"]);
    }

    #[test]
    fn le_o_codigo_do_disco_uma_vez_e_guarda_no_banco() {
        let db = memory_database();
        let dir = temp_folder("tempo-codigo-disco");
        let iso_path = dir.join("Jogo (USA).iso");
        std::fs::write(&iso_path, build_iso(&[(&["SYSTEM.CNF"], b"BOOT2 = cdrom0:\\SLUS_201.00;1\r\n")])).unwrap();
        let rom = iso_path.to_string_lossy().into_owned();
        let game = EmulatedGame {
            title: "Jogo",
            rom_path: &rom,
            platform: "PlayStation 2",
            library: "PCSX2",
            emulator: EmulatorId::Pcsx2,
            core: None,
        };
        let id = add_emulated_game(&db, Language::PtBr, &game).unwrap().unwrap();

        sync_emulator_playtime(&db, &records(record(120, None)), Utc::now()).unwrap();
        assert_eq!(stored_serial(&db, id).as_deref(), Some(SERIAL));
        assert_eq!(emulator_seconds(&db), 120);
    }

    #[test]
    fn jogo_sem_registro_no_emulador_fica_como_esta() {
        let (db, _) = setup();
        let empty =
            EmulatorRecords { by_serial: HashMap::from([(EmulatorId::Pcsx2, HashMap::new())]), retroarch: Box::new(|_| None) };
        assert_eq!(sync_emulator_playtime(&db, &empty, Utc::now()).unwrap(), 0);
        assert_eq!(emulator_seconds(&db), 0);
    }
}
