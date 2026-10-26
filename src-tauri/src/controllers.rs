//! Os controles reconhecidos (DualSense) na barra do topo: por onde cada um está conectado e a bateria.
//! O Rust lê pelo hidapi, numa linha de execução à parte, e avisa a interface quando algo muda. Os
//! números seguem o driver oficial desses controles no Linux (hid-playstation).

use std::ffi::CString;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use crate::controller_input::{ControllerButton, ControllerInputSnapshot, InputState, parse_input};
use crate::test_mode::test_mode;
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

/// A leitura usa esperas curtas para ceder ao input. O handle é fechado antes da negociação de modo:
/// get_feature_report no backend Windows não oferece timeout e nunca pode prender o leitor de entrada.
fn read_battery(api: &HidApi, item: &Tracked, shared: &Shared) -> Option<BatteryReading> {
    let sample = || {
        let _owner = item.reader.try_lock().ok()?;
        if battery_cancelled(shared, item.controller.key) {
            return None;
        }
        let device = api.open_path(&item.path).ok()?;
        wait_for_battery(&device, item, shared, Duration::from_millis(500))
    };
    let mut reading = sample();
    if item.controller.connection == Connection::Bluetooth {
        for report_id in FULL_MODE_FEATURE_REPORTS {
            if reading.is_some() || battery_cancelled(shared, item.controller.key) {
                break;
            }
            // Este handle só pede configuração; não tem uma leitura de input pendente no driver.
            let device = api.open_path(&item.path).ok()?;
            let mut feature = [0u8; 256];
            feature[0] = report_id;
            let _ = device.get_feature_report(&mut feature);
            drop(device);
            reading = sample();
        }
    }
    reading
}

fn wait_for_battery(device: &HidDevice, item: &Tracked, shared: &Shared, timeout: Duration) -> Option<BatteryReading> {
    let deadline = Instant::now() + timeout;
    let mut buffer = [0u8; 128];
    while Instant::now() < deadline && !battery_cancelled(shared, item.controller.key) {
        let read = device.read_timeout(&mut buffer, 20).ok()?;
        if read > 0
            && let Some(reading) = parse_battery(item.controller.connection, buffer[0], &buffer[1..read])
        {
            return Some(reading);
        }
    }
    None
}

/// O acesso de leitura é exclusivo por aparelho; a bateria cede em até uma espera de 20 ms.
#[derive(Clone)]
struct Tracked {
    path: CString,
    controller: ConnectedController,
    input_supported: bool,
    reader: Arc<Mutex<()>>,
    read_at: Option<Instant>,
}

struct Found {
    path: CString,
    name: &'static str,
    connection: Connection,
    input_supported: bool,
}

struct ServiceState {
    tracked: Vec<Tracked>,
    next_key: u32,
    input: InputState,
}

impl Default for ServiceState {
    fn default() -> Self {
        Self { tracked: Vec::new(), next_key: 1, input: InputState::default() }
    }
}

#[derive(Default)]
struct Shared {
    state: Mutex<ServiceState>,
    wake: Condvar,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, ServiceState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn wait(&self, duration: Duration) {
        let _ = self.wake.wait_timeout(self.lock(), duration).unwrap_or_else(PoisonError::into_inner);
    }
}

const INPUT_EVENT: &str = "controllers:input";

/// Descoberta, bateria econômica e input opt-in são independentes. Só uma fonte lê input por aparelho.
pub struct Controllers {
    shared: Arc<Shared>,
    app: AppHandle,
}

fn hardware_allowed() -> bool {
    !cfg!(test) && test_mode().data_dir.is_none()
}

impl Controllers {
    pub fn start(app: AppHandle) -> Controllers {
        let shared = Arc::new(Shared::default());
        if hardware_allowed() {
            HidApi::disable_device_discovery();
            for worker in [scan_worker, battery_worker, input_worker] {
                let shared = Arc::clone(&shared);
                let app = app.clone();
                thread::spawn(move || worker(shared, app));
            }
        }
        Controllers { shared, app }
    }

    pub fn list(&self) -> Vec<ConnectedController> {
        controller_list(&self.shared.lock())
    }

    pub fn input(&self) -> ControllerInputSnapshot {
        self.shared.lock().input.snapshot.clone()
    }

    pub fn set_input_enabled(&self, enabled: bool) {
        let mut state = self.shared.lock();
        if state.input.set_enabled(enabled) {
            let _ = self.app.emit(INPUT_EVENT, state.input.snapshot.clone());
            self.shared.wake.notify_all();
        }
    }

    /// Disponível somente no app de testes; segue a mesma neutralidade e geração do leitor físico.
    pub fn inject_test_input(&self, connected: bool, buttons: Vec<ControllerButton>) -> ControllerInputSnapshot {
        if !cfg!(debug_assertions) || test_mode().data_dir.is_none() {
            return self.input();
        }
        let mut state = self.shared.lock();
        let changed = state.input.select(connected.then_some(1));
        let changed = state.input.observe(buttons) || changed;
        let snapshot = state.input.snapshot.clone();
        if changed {
            let _ = self.app.emit(INPUT_EVENT, snapshot.clone());
        }
        snapshot
    }
}

fn controller_list(state: &ServiceState) -> Vec<ConnectedController> {
    state.tracked.iter().map(|item| item.controller.clone()).collect()
}

fn scan_worker(shared: Arc<Shared>, app: AppHandle) {
    let Ok(mut api) = HidApi::new() else { return };
    loop {
        if let Some(found) = discover(&mut api) {
            let mut state = shared.lock();
            let sequence = state.input.snapshot.sequence;
            if reconcile(&mut state, found) {
                let _ = app.emit(CONTROLLERS_CHANGED_EVENT, controller_list(&state));
                shared.wake.notify_all();
            }
            if state.input.snapshot.sequence != sequence {
                let _ = app.emit(INPUT_EVENT, state.input.snapshot.clone());
            }
        }
        thread::sleep(SCAN_INTERVAL);
    }
}

fn discover(api: &mut HidApi) -> Option<Vec<Found>> {
    api.reset_devices().ok()?;
    for model in &SUPPORTED_CONTROLLERS {
        let _ = api.add_devices(model.vendor_id, model.product_id);
    }
    let mut found = Vec::new();
    for device in api.device_list() {
        if let Some(model) = SUPPORTED_CONTROLLERS
            .iter()
            .find(|model| model.vendor_id == device.vendor_id() && model.product_id == device.product_id())
            && !found.iter().any(|item: &Found| item.path.as_c_str() == device.path())
        {
            found.push(Found {
                path: device.path().to_owned(),
                name: model.name,
                connection: connection_of(device.bus_type()),
                // Edge continua aparecendo com bateria; sua entrada não foi validada nesta entrega.
                input_supported: model.product_id == 0x0ce6 && device.usage_page() == 1 && device.usage() == 5,
            });
        }
    }
    Some(found)
}

fn reconcile(state: &mut ServiceState, found: Vec<Found>) -> bool {
    let before = state.tracked.len();
    state.tracked.retain(|item| found.iter().any(|new| new.path == item.path && new.connection == item.controller.connection));
    let mut changed = state.tracked.len() != before;
    for item in found {
        if !state.tracked.iter().any(|old| old.path == item.path) {
            state.tracked.push(Tracked {
                path: item.path,
                controller: ConnectedController {
                    key: state.next_key,
                    name: item.name,
                    connection: item.connection,
                    battery: None,
                },
                input_supported: item.input_supported,
                reader: Arc::new(Mutex::new(())),
                read_at: None,
            });
            state.next_key += 1;
            changed = true;
        }
    }
    if let Some(key) = state.input.snapshot.controller_key
        && !state.tracked.iter().any(|item| item.controller.key == key && item.input_supported)
    {
        state.input.select(None);
    }
    changed
}

fn input_target_key(state: &ServiceState) -> Option<u32> {
    if !state.input.enabled {
        return None;
    }
    state.tracked.iter().find(|item| item.input_supported).map(|item| item.controller.key)
}

fn battery_cancelled(shared: &Shared, key: u32) -> bool {
    let state = shared.lock();
    !state.tracked.iter().any(|item| item.controller.key == key) || input_target_key(&state) == Some(key)
}
fn battery_worker(shared: Arc<Shared>, app: AppHandle) {
    let Ok(api) = HidApi::new() else { return };
    loop {
        let due = {
            let mut state = shared.lock();
            let input_key = input_target_key(&state);
            state
                .tracked
                .iter_mut()
                .find(|item| {
                    Some(item.controller.key) != input_key && item.read_at.is_none_or(|at| at.elapsed() >= REFRESH_INTERVAL)
                })
                .map(|item| {
                    item.read_at = Some(Instant::now());
                    item.clone()
                })
        };
        if let Some(item) = due {
            if let Some(reading) = read_battery(&api, &item, &shared) {
                publish_battery(&shared, &app, item.controller.key, reading);
            }
        } else {
            shared.wait(Duration::from_millis(100));
        }
    }
}

fn publish_battery(shared: &Shared, app: &AppHandle, key: u32, reading: BatteryReading) {
    let mut state = shared.lock();
    if let Some(item) = state.tracked.iter_mut().find(|item| item.controller.key == key)
        && item.controller.battery != Some(reading)
    {
        item.controller.battery = Some(reading);
        item.read_at = Some(Instant::now());
        let _ = app.emit(CONTROLLERS_CHANGED_EVENT, controller_list(&state));
    }
}

fn input_worker(shared: Arc<Shared>, app: AppHandle) {
    let Ok(api) = HidApi::new() else { return };
    loop {
        let target = {
            let state = shared.lock();
            input_target_key(&state).and_then(|key| state.tracked.iter().find(|item| item.controller.key == key).cloned())
        };
        if let Some(item) = target {
            read_input(&api, &shared, &app, &item);
        }
        shared.wait(Duration::from_millis(100));
    }
}

fn read_input(api: &HidApi, shared: &Shared, app: &AppHandle, item: &Tracked) {
    let expected_generation = shared.lock().input.snapshot.generation;
    // A leitura econômica libera este acesso ao perceber a ativação; nunca espera um feature report.
    let _owner = item.reader.lock().unwrap_or_else(PoisonError::into_inner);
    let Ok(device) = api.open_path(&item.path) else { return };
    let generation = {
        let mut state = shared.lock();
        if !state.input.enabled
            || state.input.snapshot.generation != expected_generation
            || !state.tracked.iter().any(|current| current.controller.key == item.controller.key)
        {
            return;
        }
        if state.input.select(Some(item.controller.key)) {
            let _ = app.emit(INPUT_EVENT, state.input.snapshot.clone());
        }
        state.input.snapshot.generation
    };
    let mut buffer = [0u8; 128];
    let mut last_report = Instant::now();
    loop {
        {
            let state = shared.lock();
            if !current_reader(&state, item.controller.key, generation) {
                break;
            }
        }
        let Ok(read) = device.read_timeout(&mut buffer, 20) else { break };
        let Some(buttons) = parse_input(item.controller.connection, &buffer[..read]) else {
            if last_report.elapsed() >= Duration::from_millis(500) {
                break;
            }
            continue;
        };
        last_report = Instant::now();
        // Uma resposta que chegou após desativar/trocar de geração nunca volta para a interface.
        {
            let mut state = shared.lock();
            if !current_reader(&state, item.controller.key, generation) {
                break;
            }
            if state.input.observe(buttons) {
                let _ = app.emit(INPUT_EVENT, state.input.snapshot.clone());
            }
        }
        if let Some(reading) = parse_battery(item.controller.connection, buffer[0], &buffer[1..read]) {
            publish_battery(shared, app, item.controller.key, reading);
        }
    }
    let mut state = shared.lock();
    if current_reader(&state, item.controller.key, generation) && state.input.select(None) {
        let _ = app.emit(INPUT_EVENT, state.input.snapshot.clone());
    }
}

fn current_reader(state: &ServiceState, key: u32, generation: u64) -> bool {
    state.input.enabled
        && state.input.snapshot.generation == generation
        && state.input.snapshot.controller_key == Some(key)
        && state.tracked.iter().any(|item| item.controller.key == key)
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
    fn found(path: &str, input_supported: bool) -> Found {
        Found {
            path: CString::new(path).unwrap(),
            name: if input_supported { "DualSense" } else { "DualSense Edge" },
            connection: Connection::Usb,
            input_supported,
        }
    }

    #[test]
    fn descoberta_preserva_bateria_e_chave_mas_reconexao_ganha_nova_chave() {
        let mut state = ServiceState::default();
        assert!(reconcile(&mut state, vec![found("controle-a", true), found("controle-b", false)]));
        let key = state.tracked[0].controller.key;
        state.tracked[0].controller.battery = battery(Some(75), BatteryState::Charging);
        assert!(!reconcile(&mut state, vec![found("controle-a", true), found("controle-b", false)]));
        assert_eq!(state.tracked[0].controller.key, key);
        assert_eq!(state.tracked[0].controller.battery, battery(Some(75), BatteryState::Charging));
        state.input.set_enabled(true);
        state.input.select(Some(key));
        let generation = state.input.snapshot.generation;
        assert!(reconcile(&mut state, vec![found("controle-b", false)]));
        assert_eq!(state.input.snapshot.controller_key, None);
        assert!(state.input.snapshot.generation > generation);
        assert!(reconcile(&mut state, vec![found("controle-a", true), found("controle-b", false)]));
        assert!(state.tracked.iter().find(|item| item.input_supported).unwrap().controller.key > key);
        assert_eq!(controller_list(&state).len(), 2);
    }

    #[test]
    fn pacote_tardio_de_uma_geracao_anterior_nao_pode_ser_publicado() {
        let mut state = ServiceState::default();
        reconcile(&mut state, vec![found("controle", true)]);
        state.input.set_enabled(true);
        state.input.select(Some(1));
        let generation = state.input.snapshot.generation;
        assert!(current_reader(&state, 1, generation));
        state.input.set_enabled(false);
        assert!(!current_reader(&state, 1, generation));
        state.input.set_enabled(true);
        state.input.select(Some(1));
        assert!(!current_reader(&state, 1, generation));
        assert!(current_reader(&state, 1, state.input.snapshot.generation));
        reconcile(&mut state, vec![]);
        assert!(!current_reader(&state, 1, state.input.snapshot.generation));
    }

    #[test]
    fn testes_nunca_inicializam_hid_real_e_edge_continua_so_com_indicador() {
        assert!(!hardware_allowed());
        let mut state = ServiceState::default();
        reconcile(&mut state, vec![found("edge-sintetico", false)]);
        assert!(state.tracked.iter().all(|item| !item.input_supported));
        assert_eq!(controller_list(&state)[0].name, "DualSense Edge");
    }
    #[test]
    fn entrada_pausa_so_a_amostra_do_controle_escolhido_preservando_bateria_edge() {
        let shared = Shared::default();
        {
            let mut state = shared.lock();
            reconcile(&mut state, vec![found("regular", true), found("edge", false), found("regular-b", true)]);
            state.input.set_enabled(true);
        }
        assert!(battery_cancelled(&shared, 1));
        assert!(!battery_cancelled(&shared, 2));
        assert!(!battery_cancelled(&shared, 3));
    }
}
