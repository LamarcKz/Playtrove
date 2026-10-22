//! De onde a detecção de emuladores lê no Windows de verdade: os atalhos do menu Iniciar e da Área de
//! Trabalho (do usuário e de todos os usuários), lidos pelo próprio Windows.

use std::path::{Path, PathBuf};

use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, STGM_READ,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
use windows::core::{HSTRING, Interface};

use crate::emulators::DetectionSources;

/// Até quantas subpastas do menu Iniciar a detecção olha.
const MAX_DEPTH: usize = 3;

pub struct SystemSources {
    folders: Vec<PathBuf>,
}

impl SystemSources {
    pub fn new() -> SystemSources {
        let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
        let start_menu = |root: PathBuf| root.join("Microsoft").join("Windows").join("Start Menu").join("Programs");
        let folders = [
            env("APPDATA").map(start_menu),
            env("ProgramData").map(start_menu),
            env("USERPROFILE").map(|profile| profile.join("Desktop")),
            env("PUBLIC").map(|public| public.join("Desktop")),
        ];
        SystemSources { folders: folders.into_iter().flatten().collect() }
    }
}

impl DetectionSources for SystemSources {
    fn shortcuts(&self) -> Vec<String> {
        self.folders.iter().flat_map(|folder| list_shortcuts(folder, 0)).collect()
    }

    fn read_shortcut(&self, path: &str) -> Option<String> {
        read_shortcut_target(path)
    }

    fn exists(&self, path: &str) -> bool {
        Path::new(path).exists()
    }

    fn list_dir(&self, path: &str) -> Vec<(String, bool)> {
        let Ok(entries) = std::fs::read_dir(path) else { return Vec::new() };
        entries
            .filter_map(|entry| entry.ok())
            .map(|entry| (entry.file_name().to_string_lossy().into_owned(), entry.file_type().is_ok_and(|kind| kind.is_dir())))
            .collect()
    }

    fn env(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }
}

/// Os atalhos (.lnk) de uma pasta e das subpastas dela.
fn list_shortcuts(folder: &Path, depth: usize) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(folder) else { return Vec::new() };
    let mut shortcuts = Vec::new();
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            if depth < MAX_DEPTH {
                shortcuts.extend(list_shortcuts(&path, depth + 1));
            }
        } else if path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("lnk")) {
            shortcuts.push(path.to_string_lossy().into_owned());
        }
    }
    shortcuts
}

/// Para onde um atalho aponta, pelo próprio Windows (o mesmo que o Explorador mostra), ou None.
fn read_shortcut_target(path: &str) -> Option<String> {
    // SAFETY: as chamadas seguem o uso documentado do COM: o COM é ligado nesta linha de execução antes
    // e desligado depois (só se esta chamada o ligou), e o buffer tem o tamanho que o GetPath recebe.
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let target = (|| {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
            let file: IPersistFile = link.cast().ok()?;
            file.Load(&HSTRING::from(path), STGM_READ).ok()?;
            let mut buffer = vec![0u16; 32_768];
            link.GetPath(&mut buffer, std::ptr::null_mut(), 0).ok()?;
            let length = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
            Some(String::from_utf16_lossy(&buffer[..length])).filter(|target| !target.is_empty())
        })();
        if initialized {
            CoUninitialize();
        }
        target
    }
}
