//! Saída e volume geral do Windows. A lógica recebe um adaptador; testes nunca acessam áudio real.

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputState {
    pub devices: Vec<AudioOutputDevice>,
    pub volume: f64,
    pub muted: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AudioError {
    Unavailable,
    DeviceUnavailable,
    InvalidVolume,
    ChangeFailed,
    SwitchUnsupported,
}

trait AudioBackend {
    fn get(&self) -> Result<AudioOutputState, AudioError>;
    fn set_device(&mut self, id: &str) -> Result<(), AudioError>;
    fn set_volume(&mut self, volume: f64) -> Result<(), AudioError>;
    fn set_muted(&mut self, muted: bool) -> Result<(), AudioError>;
}

fn change_device(backend: &mut dyn AudioBackend, id: &str) -> Result<AudioOutputState, AudioError> {
    let state = backend.get()?;
    let device =
        state.devices.iter().find(|device| device.id == id && !id.contains('\0')).ok_or(AudioError::DeviceUnavailable)?;
    if device.is_default {
        return Ok(state);
    }
    backend.set_device(id)?;
    backend.get()
}

fn change_volume(backend: &mut dyn AudioBackend, volume: f64) -> Result<AudioOutputState, AudioError> {
    if !volume.is_finite() || !(0.0..=100.0).contains(&volume) {
        return Err(AudioError::InvalidVolume);
    }
    require_default(backend)?;
    backend.set_volume(volume)?;
    backend.get()
}

fn change_muted(backend: &mut dyn AudioBackend, muted: bool) -> Result<AudioOutputState, AudioError> {
    require_default(backend)?;
    backend.set_muted(muted)?;
    backend.get()
}

fn require_default(backend: &dyn AudioBackend) -> Result<(), AudioError> {
    if backend.get()?.devices.iter().any(|device| device.is_default) { Ok(()) } else { Err(AudioError::DeviceUnavailable) }
}

impl AudioError {
    pub fn into_app(self, language: crate::i18n::Language) -> crate::errors::AppError {
        let key = match self {
            Self::Unavailable => "unavailable",
            Self::DeviceUnavailable => "deviceUnavailable",
            Self::InvalidVolume => "invalidVolume",
            Self::ChangeFailed => "changeFailed",
            Self::SwitchUnsupported => "switchUnsupported",
        };
        crate::errors::AppError::text(language, &format!("errors.audioOutput.{key}"), &[])
    }
}

pub fn get() -> Result<AudioOutputState, AudioError> {
    access(|backend| backend.get())
}
pub fn set_device(id: &str) -> Result<AudioOutputState, AudioError> {
    access(|backend| change_device(backend, id))
}
pub fn set_volume(volume: f64) -> Result<AudioOutputState, AudioError> {
    access(|backend| change_volume(backend, volume))
}
pub fn set_muted(muted: bool) -> Result<AudioOutputState, AudioError> {
    access(|backend| change_muted(backend, muted))
}

fn access(
    action: impl FnOnce(&mut dyn AudioBackend) -> Result<AudioOutputState, AudioError>,
) -> Result<AudioOutputState, AudioError> {
    // Mesmo chamadas acidentais nos testes unitários ficam impossibilitadas de acessar o Windows.
    #[cfg(any(test, debug_assertions))]
    if cfg!(test) || crate::test_hooks::active() {
        return action(&mut *test_audio::AUDIO.lock().unwrap_or_else(std::sync::PoisonError::into_inner));
    }
    action(&mut native::WindowsAudio::new()?)
}

#[cfg(any(test, debug_assertions))]
mod test_audio {
    use super::*;
    use std::sync::{LazyLock, Mutex};

    pub(super) static AUDIO: LazyLock<Mutex<MemoryAudio>> = LazyLock::new(|| {
        Mutex::new(MemoryAudio(AudioOutputState {
            devices: vec![
                AudioOutputDevice { id: "test-speakers".into(), name: "Speakers".into(), is_default: true },
                AudioOutputDevice { id: "test-headphones".into(), name: "Headphones".into(), is_default: false },
            ],
            volume: 40.0,
            muted: false,
        }))
    });

    pub(super) struct MemoryAudio(AudioOutputState);

    impl AudioBackend for MemoryAudio {
        fn get(&self) -> Result<AudioOutputState, AudioError> {
            Ok(self.0.clone())
        }
        fn set_device(&mut self, id: &str) -> Result<(), AudioError> {
            for device in &mut self.0.devices {
                device.is_default = device.id == id;
            }
            Ok(())
        }
        fn set_volume(&mut self, volume: f64) -> Result<(), AudioError> {
            self.0.volume = volume;
            Ok(())
        }
        fn set_muted(&mut self, muted: bool) -> Result<(), AudioError> {
            self.0.muted = muted;
            Ok(())
        }
    }
}

mod native {
    use super::*;
    use std::ffi::c_void;
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::{ERROR_NOT_FOUND, RPC_E_CHANGED_MODE};
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        DEVICE_STATE_ACTIVE, ERole, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, eCommunications, eConsole, eMultimedia,
        eRender,
    };
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc};
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, STGM_READ,
    };
    use windows::core::{GUID, HRESULT, IUnknown, IUnknown_Vtbl, Interface, PCWSTR, PWSTR};

    struct ComScope(bool);
    impl Drop for ComScope {
        fn drop(&mut self) {
            // SAFETY: balanceia somente um CoInitializeEx bem-sucedido nesta mesma thread.
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    pub(super) struct WindowsAudio {
        enumerator: IMMDeviceEnumerator,
        // Os objetos COM acima precisam ser liberados antes de encerrar o apartamento.
        _com: ComScope,
    }

    impl WindowsAudio {
        pub(super) fn new() -> Result<Self, AudioError> {
            // SAFETY: o apartamento é restrito à chamada síncrona; nenhuma interface cruza threads.
            unsafe {
                let initialized = CoInitializeEx(None, COINIT_MULTITHREADED);
                if initialized.is_err() && initialized != RPC_E_CHANGED_MODE {
                    return Err(AudioError::Unavailable);
                }
                let com = ComScope(initialized.is_ok());
                let enumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|_| AudioError::Unavailable)?;
                Ok(Self { enumerator, _com: com })
            }
        }

        fn volume(&self) -> Result<IAudioEndpointVolume, AudioError> {
            // SAFETY: COM inicializado e a ativação pede a interface documentada do endpoint padrão.
            unsafe {
                self.enumerator
                    .GetDefaultAudioEndpoint(eRender, eConsole)
                    .and_then(|device| device.Activate(CLSCTX_ALL, None))
                    .map_err(|_| AudioError::DeviceUnavailable)
            }
        }
    }

    /// GetId e PropVariantToStringAlloc entregam memória pertencente ao chamador.
    unsafe fn take_wide(value: PWSTR) -> Result<String, AudioError> {
        // SAFETY: o chamador entrega um PWSTR terminado em zero e alocado pelo COM.
        unsafe {
            let text = value.to_string().map_err(|_| AudioError::Unavailable);
            CoTaskMemFree(Some(value.0.cast()));
            text
        }
    }

    fn device_id(device: &IMMDevice) -> Result<String, AudioError> {
        // SAFETY: endpoint COM válido; take_wide libera o buffer mesmo se o UTF-16 for inválido.
        unsafe { take_wide(device.GetId().map_err(|_| AudioError::Unavailable)?) }
    }

    fn device_name(device: &IMMDevice) -> Result<String, AudioError> {
        // SAFETY: propriedade somente para leitura; o PROPVARIANT e a string alocada são liberados.
        unsafe {
            let store = device.OpenPropertyStore(STGM_READ).map_err(|_| AudioError::Unavailable)?;
            let mut value = store.GetValue(&PKEY_Device_FriendlyName).map_err(|_| AudioError::Unavailable)?;
            let name = PropVariantToStringAlloc(&value).map_err(|_| AudioError::Unavailable).and_then(|name| take_wide(name));
            let _ = PropVariantClear(&mut value);
            name
        }
    }

    impl AudioBackend for WindowsAudio {
        fn get(&self) -> Result<AudioOutputState, AudioError> {
            // SAFETY: só endpoints de reprodução ativos; a leitura usa as interfaces documentadas.
            unsafe {
                let default_device = match self.enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
                    Ok(device) => Some(device),
                    Err(error) if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0) => None,
                    Err(_) => return Err(AudioError::Unavailable),
                };
                let default = default_device.as_ref().map(device_id).transpose()?;
                let endpoints =
                    self.enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE).map_err(|_| AudioError::Unavailable)?;
                let mut devices = Vec::new();
                for index in 0..endpoints.GetCount().map_err(|_| AudioError::Unavailable)? {
                    // Uma desconexão durante a enumeração não impede listar os demais endpoints.
                    let Ok(endpoint) = endpoints.Item(index) else { continue };
                    let (Ok(id), Ok(name)) = (device_id(&endpoint), device_name(&endpoint)) else { continue };
                    devices.push(AudioOutputDevice { is_default: default.as_deref() == Some(&id), id, name });
                }
                devices.sort_by(|left, right| right.is_default.cmp(&left.is_default).then_with(|| left.name.cmp(&right.name)));
                let (volume, muted) = if devices.iter().any(|device| device.is_default) {
                    // A mesma instância fornece o id e o volume, mesmo se o padrão mudar durante a leitura.
                    let endpoint: IAudioEndpointVolume = default_device
                        .as_ref()
                        .ok_or(AudioError::DeviceUnavailable)?
                        .Activate(CLSCTX_ALL, None)
                        .map_err(|_| AudioError::Unavailable)?;
                    (
                        (endpoint.GetMasterVolumeLevelScalar().map_err(|_| AudioError::Unavailable)? as f64 * 100.0).round(),
                        endpoint.GetMute().map_err(|_| AudioError::Unavailable)?.as_bool(),
                    )
                } else {
                    (0.0, false)
                };
                Ok(AudioOutputState { devices, volume, muted })
            }
        }

        fn set_device(&mut self, id: &str) -> Result<(), AudioError> {
            // IPolicyConfig é uma interface interna do Windows: a ausência dela gera erro explícito.
            // O layout contém os dez métodos anteriores a SetDefaultEndpoint, nunca invocados aqui.
            // SAFETY: o IID fixa esse layout; a string permanece viva durante todas as chamadas.
            unsafe {
                let policy: PolicyConfig =
                    CoCreateInstance(&POLICY_CONFIG_CLIENT, None, CLSCTX_ALL).map_err(|_| AudioError::SwitchUnsupported)?;
                let id: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
                for role in [eConsole, eMultimedia, eCommunications] {
                    (policy.vtable().set_default_endpoint)(policy.as_raw(), PCWSTR(id.as_ptr()), role)
                        .ok()
                        .map_err(|_| AudioError::ChangeFailed)?;
                }
                Ok(())
            }
        }

        fn set_volume(&mut self, volume: f64) -> Result<(), AudioError> {
            // SAFETY: volume validado em 0–100; o contexto nulo é permitido pela API.
            unsafe {
                self.volume()?
                    .SetMasterVolumeLevelScalar((volume / 100.0) as f32, std::ptr::null())
                    .map_err(|_| AudioError::ChangeFailed)
            }
        }

        fn set_muted(&mut self, muted: bool) -> Result<(), AudioError> {
            // SAFETY: bool e contexto nulo conforme o contrato da API.
            unsafe { self.volume()?.SetMute(muted, std::ptr::null()).map_err(|_| AudioError::ChangeFailed) }
        }
    }

    const POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
    #[repr(transparent)]
    #[derive(Clone)]
    struct PolicyConfig(IUnknown);
    // SAFETY: interface COM IPolicyConfig com seu IID e layout ABI; IUnknown controla a referência.
    unsafe impl Interface for PolicyConfig {
        type Vtable = PolicyConfigVtable;
        const IID: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);
    }
    #[repr(C)]
    struct PolicyConfigVtable {
        base: IUnknown_Vtbl,
        preceding_methods: [usize; 10],
        set_default_endpoint: unsafe extern "system" fn(*mut c_void, PCWSTR, ERole) -> HRESULT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeAudio {
        state: AudioOutputState,
        mutations: usize,
        fail: bool,
    }

    impl Default for FakeAudio {
        fn default() -> Self {
            Self {
                state: AudioOutputState {
                    devices: vec![
                        AudioOutputDevice { id: "speakers".into(), name: "Speakers".into(), is_default: true },
                        AudioOutputDevice { id: "headphones".into(), name: "Headphones".into(), is_default: false },
                    ],
                    volume: 40.0,
                    muted: false,
                },
                mutations: 0,
                fail: false,
            }
        }
    }

    impl AudioBackend for FakeAudio {
        fn get(&self) -> Result<AudioOutputState, AudioError> {
            Ok(self.state.clone())
        }
        fn set_device(&mut self, id: &str) -> Result<(), AudioError> {
            if self.fail {
                return Err(AudioError::SwitchUnsupported);
            }
            self.mutations += 1;
            for device in &mut self.state.devices {
                device.is_default = device.id == id;
            }
            Ok(())
        }
        fn set_volume(&mut self, volume: f64) -> Result<(), AudioError> {
            if self.fail {
                return Err(AudioError::ChangeFailed);
            }
            self.mutations += 1;
            self.state.volume = volume;
            Ok(())
        }
        fn set_muted(&mut self, muted: bool) -> Result<(), AudioError> {
            self.mutations += 1;
            self.state.muted = muted;
            Ok(())
        }
    }

    #[test]
    fn troca_somente_para_saida_ativa_e_devolve_padrao_confirmado() {
        let mut backend = FakeAudio::default();
        let state = change_device(&mut backend, "headphones").unwrap();
        assert_eq!(
            state.devices.iter().filter(|device| device.is_default).map(|device| device.id.as_str()).collect::<Vec<_>>(),
            ["headphones"]
        );
        assert_eq!(change_device(&mut backend, "disconnected"), Err(AudioError::DeviceUnavailable));
        assert_eq!(change_device(&mut backend, "headphones\0other"), Err(AudioError::DeviceUnavailable));
        assert_eq!(backend.mutations, 1);
    }

    #[test]
    fn volume_recusa_valores_fora_da_faixa_sem_mutacao() {
        let mut backend = FakeAudio::default();
        for value in [-1.0, 100.1, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(change_volume(&mut backend, value), Err(AudioError::InvalidVolume));
        }
        assert_eq!(backend.mutations, 0);
        for value in [0.0, 12.5, 100.0] {
            assert_eq!(change_volume(&mut backend, value).unwrap().volume, value);
        }
    }

    #[test]
    fn sem_saida_padrao_nao_tenta_alterar_volume_ou_mudo() {
        let mut backend = FakeAudio::default();
        backend.state.devices.clear();
        assert_eq!(change_volume(&mut backend, 20.0), Err(AudioError::DeviceUnavailable));
        assert_eq!(change_muted(&mut backend, true), Err(AudioError::DeviceUnavailable));
        assert_eq!(backend.mutations, 0);
    }

    #[test]
    fn mudo_preserva_volume_e_falha_nao_finge_troca() {
        let mut backend = FakeAudio::default();
        let state = change_muted(&mut backend, true).unwrap();
        assert!(state.muted);
        assert_eq!(state.volume, 40.0);
        backend.fail = true;
        assert_eq!(change_device(&mut backend, "headphones"), Err(AudioError::SwitchUnsupported));
        assert_eq!(change_volume(&mut backend, 60.0), Err(AudioError::ChangeFailed));
        assert_eq!(backend.state.volume, 40.0);
        assert!(backend.state.devices[0].is_default);
    }
}
