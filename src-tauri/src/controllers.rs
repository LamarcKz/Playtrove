//! Os controles reconhecidos (DualSense) na barra do topo: por onde cada um está conectado e a bateria.
//! O Rust lê pelo hidapi, numa linha de execução à parte, e avisa a interface quando algo muda. Os
//! números seguem o driver oficial desses controles no Linux (hid-playstation).

use std::ffi::CString;
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use hidapi::{BusType, HidApi, HidDevice};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// O aviso de que os controles conectados (ou a bateria de algum) mudaram.
const CONTROLLERS_CHANGED_EVENT: &str = "controllers:changed";

/// De quanto em quanto tempo o app procura controles conectados e desconectados.
const SCAN_INTERVAL: Duration = Duration::from_secs(1);

/// De quanto em quanto tempo a bateria é lida de novo.
const REFRESH_INTERVAL: Duration = Duration::from_secs(5);

/// Um modelo de controle que o app reconhece.
struct ControllerModel {
    vendor_id: u16,
    product_id: u16,
    name: &'static str,
}

/// Controles que aparecem na barra do topo, com a bateria (os mesmos de src/shared/controllers.ts).
const SUPPORTED_CONTROLLERS: [ControllerModel; 2] = [
    ControllerModel { vendor_id: 0x054c, product_id: 0x0ce6, name: "DualSense" },
    ControllerModel { vendor_id: 0x054c, product_id: 0x0df2, name: "DualSense Edge" },
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Connection {
    Usb,
    Bluetooth,
}

/// Situação da bateria: descarregando (em uso), carregando, cheia ou desconhecida (erro).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BatteryState {
    Discharging,
    Charging,
    Full,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct BatteryReading {
    /// Carga em %, estimada: o controle só informa de 10 em 10%. None quando desconhecida.
    pub percent: Option<u8>,
    pub state: BatteryState,
}

/// Um controle conectado, como aparece na barra do topo.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ConnectedController {
    /// Identificador só para a interface (o caminho do aparelho no Windows não precisa ir para a tela).
    pub key: u32,
    pub name: &'static str,
    pub connection: Connection,
    /// Bateria da última leitura; None enquanto a primeira não termina.
    pub battery: Option<BatteryReading>,
}

/// O relatório completo de uma conexão, o que traz a bateria (o id não entra na conta dos bytes). No
/// Bluetooth os dados começam 1 byte depois, por isso o byte de status fica uma casa à frente.
struct FullReport {
    id: u8,
    length: usize,
    status_offset: usize,
}

fn full_report(connection: Connection) -> FullReport {
    match connection {
        Connection::Usb => FullReport { id: 0x01, length: 63, status_offset: 52 },
        Connection::Bluetooth => FullReport { id: 0x31, length: 77, status_offset: 53 },
    }
}

/// Relatórios de configuração (calibração e pareamento). Pedir um deles faz o controle sair do modo
/// simples em que começa no Bluetooth (sem a bateria) e passar a mandar o relatório completo, o mesmo que
/// a Steam usa. O controle fica nesse modo até ser desligado.
const FULL_MODE_FEATURE_REPORTS: [u8; 2] = [0x05, 0x09];

/// Por onde o controle está conectado, pelo que o Windows diz do aparelho. Não dá para saber pelos
/// relatórios que chegam: no Bluetooth, o modo simples também usa o id 0x01 e tem o mesmo tamanho do
/// completo.
fn connection_of(bus: BusType) -> Connection {
    match bus {
        BusType::Bluetooth => Connection::Bluetooth,
        _ => Connection::Usb,
    }
}

/// Tira a bateria de um relatório do controle (`data` sem o id). None se não for o relatório completo da
/// conexão.
pub fn parse_battery(connection: Connection, report_id: u8, data: &[u8]) -> Option<BatteryReading> {
    let report = full_report(connection);
    if report_id != report.id || data.len() < report.length {
        return None;
    }

    // Byte de status: os 4 bits de baixo são o nível (0 a 10) e os 4 de cima, a situação da carga.
    let status = data[report.status_offset];
    let level = status & 0x0f;
    // Cada nível vale uma faixa de 10% (o 7 vai de 70% a 79%); o meio da faixa é a melhor estimativa.
    let percent = Some((level * 10 + 5).min(100));
    let reading = |state| Some(BatteryReading { percent, state });
    match status >> 4 {
        0x0 => reading(BatteryState::Discharging),
        0x1 => reading(BatteryState::Charging),
        // Carga completa. O controle pode dizer isso com o nível em 9 (ele para de carregar um pouco antes
        // do fim), então vale o nível que ele informou, e não 100% fixo.
        0x2 => reading(BatteryState::Full),
        // 0xa e 0xb: temperatura ou tensão fora do normal; 0xf: erro na carga.
        _ => Some(BatteryReading { percent: None, state: BatteryState::Unknown }),
    }
}

/// Lê a bateria do controle: abre, espera um relatório completo e fecha. O controle fica aberto só por um
/// instante porque ele manda de 250 a 600 relatórios por segundo, e ouvir todos o tempo todo gastaria
/// processamento à toa (inclusive enquanto você joga).
fn read_battery(api: &HidApi, path: &CString, connection: Connection) -> Option<BatteryReading> {
    let device = api.open_path(path).ok()?;
    let mut reading = wait_for_battery(&device, connection, Duration::from_millis(500));
    // Nenhum relatório completo: é o Bluetooth no modo simples. Pedir a configuração muda o modo.
    for report_id in FULL_MODE_FEATURE_REPORTS {
        if reading.is_some() {
            break;
        }
        let mut feature = [0u8; 256];
        feature[0] = report_id;
        let _ = device.get_feature_report(&mut feature);
        reading = wait_for_battery(&device, connection, Duration::from_secs(1));
    }
    reading
}

/// Espera o primeiro relatório completo do controle, por no máximo `timeout`.
fn wait_for_battery(device: &HidDevice, connection: Connection, timeout: Duration) -> Option<BatteryReading> {
    let deadline = Instant::now() + timeout;
    let mut buffer = [0u8; 128];
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return None;
        }
        // O primeiro byte é o id do relatório; os dados vêm depois.
        let read = device.read_timeout(&mut buffer, left.as_millis() as i32).ok()?;
        if read > 0
            && let Some(reading) = parse_battery(connection, buffer[0], &buffer[1..read])
        {
            return Some(reading);
        }
    }
}

/// Um controle acompanhado: o caminho dele no Windows, o que a tela mostra e quando a bateria foi lida.
struct Tracked {
    path: CString,
    controller: ConnectedController,
    read_at: Option<Instant>,
}

/// Os controles conectados agora, acompanhados numa linha de execução à parte.
pub struct Controllers(Arc<Mutex<Vec<ConnectedController>>>);

impl Controllers {
    /// Começa a acompanhar: os controles aparecem e somem sozinhos ao conectar e desconectar, e a bateria
    /// é lida de novo a cada 5 segundos.
    pub fn start(app: AppHandle) -> Controllers {
        let shared = Arc::new(Mutex::new(Vec::new()));
        let published = Arc::clone(&shared);
        thread::spawn(move || {
            // A lista de aparelhos é montada a cada volta, só com os controles reconhecidos.
            HidApi::disable_device_discovery();
            let Ok(mut api) = HidApi::new() else { return };
            let mut tracked: Vec<Tracked> = Vec::new();
            let mut next_key = 1;
            loop {
                if update(&mut api, &mut tracked, &mut next_key) {
                    let list: Vec<ConnectedController> = tracked.iter().map(|item| item.controller.clone()).collect();
                    *published.lock().unwrap_or_else(PoisonError::into_inner) = list.clone();
                    let _ = app.emit(CONTROLLERS_CHANGED_EVENT, list);
                }
                thread::sleep(SCAN_INTERVAL);
            }
        });
        Controllers(shared)
    }

    pub fn list(&self) -> Vec<ConnectedController> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }
}

/// Procura os controles, tira os que desconectaram, põe os novos e lê a bateria dos que estão na hora.
/// Devolve se algo mudou.
fn update(api: &mut HidApi, tracked: &mut Vec<Tracked>, next_key: &mut u32) -> bool {
    let mut found: Vec<(CString, &'static str, Connection)> = Vec::new();
    if api.reset_devices().is_ok() {
        for model in &SUPPORTED_CONTROLLERS {
            let _ = api.add_devices(model.vendor_id, model.product_id);
        }
        for device in api.device_list() {
            let model = SUPPORTED_CONTROLLERS
                .iter()
                .find(|model| model.vendor_id == device.vendor_id() && model.product_id == device.product_id());
            // O mesmo controle pode aparecer mais de uma vez (uma por coleção do aparelho).
            if let Some(model) = model
                && !found.iter().any(|(path, ..)| path.as_c_str() == device.path())
            {
                found.push((device.path().to_owned(), model.name, connection_of(device.bus_type())));
            }
        }
    }

    let before = tracked.len();
    tracked.retain(|item| found.iter().any(|(path, ..)| *path == item.path));
    let mut changed = tracked.len() != before;
    for (path, name, connection) in found {
        if !tracked.iter().any(|item| item.path == path) {
            tracked.push(Tracked {
                path,
                controller: ConnectedController { key: *next_key, name, connection, battery: None },
                read_at: None,
            });
            *next_key += 1;
            changed = true;
        }
    }

    for item in tracked.iter_mut() {
        if item.read_at.is_some_and(|read_at| read_at.elapsed() < REFRESH_INTERVAL) {
            continue;
        }
        item.read_at = Some(Instant::now());
        let battery = read_battery(api, &item.path, item.controller.connection);
        if battery.is_some() && battery != item.controller.battery {
            item.controller.battery = battery;
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Um relatório do controle (sem o id) com `length` bytes e o byte de status na posição `offset`.
    fn report(length: usize, offset: Option<usize>, status: u8) -> Vec<u8> {
        let mut data = vec![0; length];
        if let Some(offset) = offset {
            data[offset] = status;
        }
        data
    }

    fn battery(percent: Option<u8>, state: BatteryState) -> Option<BatteryReading> {
        Some(BatteryReading { percent, state })
    }

    #[test]
    fn no_usb_le_o_nivel_e_a_carga_no_byte_52_do_relatorio_0x01() {
        let usb = |status| parse_battery(Connection::Usb, 0x01, &report(63, Some(52), status));
        assert_eq!(usb(0x2a), battery(Some(100), BatteryState::Full));
        assert_eq!(usb(0x16), battery(Some(65), BatteryState::Charging));
        assert_eq!(usb(0xf0), battery(None, BatteryState::Unknown));
        // Carga completa com o nível em 9: vale o que o controle informou (bytes reais do controle dele).
        assert_eq!(usb(0x29), battery(Some(95), BatteryState::Full));
        // No cabo, mas sem carregar: o controle diz que está descarregando.
        assert_eq!(usb(0x07), battery(Some(75), BatteryState::Discharging));
    }

    #[test]
    fn no_usb_ignora_outros_relatorios() {
        assert_eq!(parse_battery(Connection::Usb, 0x31, &report(77, Some(53), 0x09)), None);
        assert_eq!(parse_battery(Connection::Usb, 0x02, &report(63, Some(52), 0x2a)), None);
    }

    #[test]
    fn no_bluetooth_le_o_byte_53_do_relatorio_completo_0x31() {
        let bluetooth = |status| parse_battery(Connection::Bluetooth, 0x31, &report(77, Some(53), status));
        // Bytes reais do controle do usuário.
        assert_eq!(bluetooth(0x09), battery(Some(95), BatteryState::Discharging));
        assert_eq!(bluetooth(0x00), battery(Some(5), BatteryState::Discharging));
        assert_eq!(bluetooth(0x0a), battery(Some(100), BatteryState::Discharging));
        assert_eq!(bluetooth(0x13), battery(Some(35), BatteryState::Charging));
        assert_eq!(bluetooth(0xa5), battery(None, BatteryState::Unknown));
    }

    #[test]
    fn o_modo_simples_do_bluetooth_nao_e_confundido_com_o_usb() {
        // O bug real do app em Electron: no Windows, o modo simples chega como 0x01 com o mesmo tamanho.
        let mut simple = report(77, Some(52), 0x8e);
        simple[53] = 0x09;
        assert_eq!(parse_battery(Connection::Bluetooth, 0x01, &simple), None);
        assert_eq!(parse_battery(Connection::Bluetooth, 0x01, &report(9, None, 0)), None);
        assert_eq!(parse_battery(Connection::Bluetooth, 0x31, &report(20, None, 0)), None);
    }

    #[test]
    fn a_conexao_vem_do_que_o_windows_diz_do_aparelho() {
        assert_eq!(connection_of(BusType::Usb), Connection::Usb);
        assert_eq!(connection_of(BusType::Bluetooth), Connection::Bluetooth);
        assert_eq!(connection_of(BusType::Unknown), Connection::Usb);
    }

    #[test]
    fn a_tela_recebe_os_nomes_de_sempre() {
        let controller = ConnectedController {
            key: 1,
            name: "DualSense",
            connection: Connection::Bluetooth,
            battery: battery(Some(95), BatteryState::Full),
        };
        let json = serde_json::to_value(controller).unwrap();
        assert_eq!(json["connection"], "bluetooth");
        assert_eq!(json["battery"]["state"], "full");
        assert_eq!(json["battery"]["percent"], 95);
    }
}
