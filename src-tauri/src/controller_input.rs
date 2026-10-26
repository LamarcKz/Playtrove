//! Entrada digital do DualSense: parser puro e rearmamento após reconexão ou reativação.
use crate::controllers::Connection;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ControllerButton {
    Up,
    Down,
    Left,
    Right,
    Cross,
    Circle,
    Square,
    Triangle,
    L1,
    R1,
    Options,
    Create,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerInputSnapshot {
    pub sequence: u64,
    pub generation: u64,
    pub controller_key: Option<u32>,
    pub buttons: Vec<ControllerButton>,
}

/// Recebe o relatório inteiro, incluindo o id. O transporte vem do aparelho, nunca do id 0x01.
pub fn parse_input(connection: Connection, report: &[u8]) -> Option<Vec<ControllerButton>> {
    let (offset, button_offset) = match (connection, report.first().copied(), report.len()) {
        (Connection::Usb, Some(0x01), 64) => (1, 7),
        (Connection::Bluetooth, Some(0x01), 10 | 78) => (1, 4),
        (Connection::Bluetooth, Some(0x31), 78) => (2, 7),
        _ => return None,
    };
    let data = &report[offset..];
    let face = data[button_offset];
    let extra = data[button_offset + 1];
    let hat = face & 0x0f;
    use ControllerButton::*;
    // Só o analógico esquerdo navega. A zona morta evita eventos de ruído em repouso.
    let candidates = [
        (Up, matches!(hat, 0 | 1 | 7) || data[1] <= 64),
        (Down, matches!(hat, 3 | 4 | 5) || data[1] >= 192),
        (Left, matches!(hat, 5 | 6 | 7) || data[0] <= 64),
        (Right, matches!(hat, 1 | 2 | 3) || data[0] >= 192),
        (Cross, face & 0x20 != 0),
        (Circle, face & 0x40 != 0),
        (Square, face & 0x10 != 0),
        (Triangle, face & 0x80 != 0),
        (L1, extra & 0x01 != 0),
        (R1, extra & 0x02 != 0),
        (Options, extra & 0x20 != 0),
        (Create, extra & 0x10 != 0),
    ];
    Some(candidates.into_iter().filter_map(|(button, pressed)| pressed.then_some(button)).collect())
}

#[derive(Default)]
pub struct InputState {
    pub enabled: bool,
    pub snapshot: ControllerInputSnapshot,
    armed: bool,
}
impl InputState {
    pub fn set_enabled(&mut self, enabled: bool) -> bool {
        if self.enabled == enabled {
            return false;
        }
        self.enabled = enabled;
        self.snapshot.controller_key = None;
        self.reopen()
    }
    pub fn select(&mut self, key: Option<u32>) -> bool {
        if !self.enabled || self.snapshot.controller_key == key {
            return false;
        }
        self.snapshot.controller_key = key;
        self.reopen()
    }
    pub fn reopen(&mut self) -> bool {
        self.armed = false;
        self.snapshot.buttons.clear();
        self.snapshot.generation += 1;
        self.snapshot.sequence += 1;
        true
    }
    pub fn observe(&mut self, mut buttons: Vec<ControllerButton>) -> bool {
        if !self.enabled || self.snapshot.controller_key.is_none() {
            return false;
        }
        buttons.sort_unstable();
        buttons.dedup();
        if !self.armed {
            self.armed = buttons.is_empty();
            return false;
        }
        if self.snapshot.buttons == buttons {
            return false;
        }
        self.snapshot.buttons = buttons;
        self.snapshot.sequence += 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ControllerButton::*;
    fn packet(connection: Connection, simple: bool, length: usize, hat: u8, face: u8, extra: u8) -> Vec<u8> {
        let mut data = vec![0; length];
        let offset = if connection == Connection::Bluetooth && !simple { 2 } else { 1 };
        data[0] = if connection == Connection::Bluetooth && !simple { 0x31 } else { 0x01 };
        data[offset..offset + 4].fill(128);
        let buttons = offset + if simple { 4 } else { 7 };
        data[buttons] = hat | face;
        data[buttons + 1] = extra;
        data
    }
    #[test]
    fn interpreta_usb_e_as_tres_formas_bluetooth_sem_confundir_offsets() {
        for (connection, simple, len) in [
            (Connection::Usb, false, 64),
            (Connection::Bluetooth, true, 10),
            (Connection::Bluetooth, true, 78),
            (Connection::Bluetooth, false, 78),
        ] {
            let data = packet(connection, simple, len, 8, 0x60, 0x33);
            assert_eq!(parse_input(connection, &data), Some(vec![Cross, Circle, L1, R1, Options, Create]));
        }
    }
    #[test]
    fn normaliza_todas_as_direcoes_e_botoes_sem_duplicar() {
        let hats = [
            vec![Up],
            vec![Up, Right],
            vec![Right],
            vec![Down, Right],
            vec![Down],
            vec![Down, Left],
            vec![Left],
            vec![Up, Left],
            vec![],
        ];
        for (hat, expected) in hats.into_iter().enumerate() {
            let data = packet(Connection::Usb, false, 64, hat as u8, 0, 0);
            assert_eq!(parse_input(Connection::Usb, &data), Some(expected));
        }
        assert_eq!(
            parse_input(Connection::Usb, &packet(Connection::Usb, false, 64, 8, 0xf0, 0x33)),
            Some(vec![Cross, Circle, Square, Triangle, L1, R1, Options, Create])
        );
    }
    #[test]
    fn converte_analogico_esquerdo_em_direcoes_com_zona_morta() {
        let mut data = packet(Connection::Usb, false, 64, 0, 0, 0);
        data[1] = 0;
        data[2] = 0;
        assert_eq!(parse_input(Connection::Usb, &data), Some(vec![Up, Left]));
        data[1] = 255;
        data[2] = 255;
        data[8] = 8;
        assert_eq!(parse_input(Connection::Usb, &data), Some(vec![Down, Right]));
        data[1] = 100;
        data[2] = 154;
        data[3] = 0;
        data[4] = 255;
        assert_eq!(parse_input(Connection::Usb, &data), Some(vec![]));
    }
    #[test]
    fn rejeita_pacotes_truncados_ids_errados_e_formatos_de_outro_transporte() {
        for (connection, simple, length) in
            [(Connection::Usb, false, 64), (Connection::Bluetooth, true, 10), (Connection::Bluetooth, false, 78)]
        {
            let data = packet(connection, simple, length, 8, 0, 0);
            for end in 0..length {
                // 10 bytes é um relatório simples válido, somente quando o id é 0x01 no Bluetooth.
                if connection == Connection::Bluetooth && simple && end == 10 {
                    continue;
                }
                assert_eq!(parse_input(connection, &data[..end]), None);
            }
            let mut wrong = data;
            wrong[0] = 0x02;
            assert_eq!(parse_input(connection, &wrong), None);
        }
        assert_eq!(parse_input(Connection::Bluetooth, &packet(Connection::Usb, false, 64, 8, 0x20, 0)), None);
        assert_eq!(parse_input(Connection::Usb, &packet(Connection::Bluetooth, true, 78, 8, 0x20, 0)), None);
    }
    #[test]
    fn ativacao_exige_neutro_e_so_publica_mudancas_digitais() {
        let mut state = InputState::default();
        assert!(!state.observe(vec![Cross]));
        assert!(state.set_enabled(true));
        assert!(state.select(Some(1)));
        assert!(!state.observe(vec![Cross]));
        assert!(!state.observe(vec![]));
        assert!(state.observe(vec![Cross]));
        let pressed = state.snapshot.clone();
        assert!(!state.observe(vec![Cross, Cross]));
        assert_eq!(state.snapshot, pressed);
        assert!(state.observe(vec![]));
        assert!(state.snapshot.sequence > pressed.sequence);
        assert!(state.set_enabled(false));
        assert_eq!(state.snapshot.controller_key, None);
        assert!(!state.observe(vec![Circle]));
    }
    #[test]
    fn troca_reconexao_e_reabertura_mudam_geracao_e_exigem_neutro() {
        let mut state = InputState::default();
        state.set_enabled(true);
        state.select(Some(1));
        state.observe(vec![]);
        state.observe(vec![Cross]);
        let first = state.snapshot.clone();
        assert!(state.select(Some(2)));
        assert!(state.snapshot.generation > first.generation);
        assert!(state.snapshot.sequence > first.sequence);
        assert!(!state.observe(vec![Cross]));
        state.observe(vec![]);
        assert!(state.observe(vec![Circle]));
        let second = state.snapshot.generation;
        assert!(state.reopen());
        assert!(state.snapshot.generation > second);
        assert!(!state.observe(vec![Cross]));
        assert!(state.select(None));
        assert!(state.select(Some(2)));
        assert!(!state.observe(vec![Cross]));
        assert!(!state.set_enabled(true));
        state.set_enabled(false);
        state.set_enabled(true);
        state.select(Some(2));
        assert!(!state.observe(vec![Cross]));
    }
    #[test]
    fn serializa_contrato_sem_caminhos_nativos() {
        let json = serde_json::to_value(ControllerInputSnapshot {
            sequence: 3,
            generation: 2,
            controller_key: Some(7),
            buttons: vec![Cross, L1, Create],
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({"sequence": 3, "generation": 2, "controllerKey": 7, "buttons": ["cross", "l1", "create"]})
        );
    }
    #[test]
    fn mapeia_cada_botao_sem_trocar_confirmar_voltar_ou_as_outras_acoes() {
        for (connection, simple, len) in [
            (Connection::Usb, false, 64),
            (Connection::Bluetooth, true, 10),
            (Connection::Bluetooth, true, 78),
            (Connection::Bluetooth, false, 78),
        ] {
            for (face, extra, expected) in [
                (0x20, 0, Cross),
                (0x40, 0, Circle),
                (0x10, 0, Square),
                (0x80, 0, Triangle),
                (0, 1, L1),
                (0, 2, R1),
                (0, 0x20, Options),
                (0, 0x10, Create),
            ] {
                assert_eq!(parse_input(connection, &packet(connection, simple, len, 8, face, extra)), Some(vec![expected]));
            }
        }
    }
}
