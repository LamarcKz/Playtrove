//! Maximiza a janela de um emulador que acabou de abrir (o RetroArch, pedido do usuário em 2026-10-14)
//! assim que ela aparecer. O app em Electron fazia isso por um PowerShell escondido; aqui, o Rust chama
//! as mesmas funções do Windows direto, numa linha de execução à parte (o app não espera por ela).

use std::thread;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GW_OWNER, GWL_STYLE, GetWindow, GetWindowLongW, GetWindowThreadProcessId, IsWindowVisible, SW_MAXIMIZE,
    ShowWindow, WS_MAXIMIZEBOX,
};
use windows::core::BOOL;

/// De quanto em quanto tempo a janela é procurada, e por quanto tempo no máximo.
const POLL: Duration = Duration::from_millis(200);
const TIMEOUT: Duration = Duration::from_secs(10);

/// O código de saída de um processo que ainda está rodando (STILL_ACTIVE do Windows).
const STILL_ACTIVE: u32 = 259;

/// Espera a janela principal do processo `pid` aparecer e maximiza ela. A janela principal é a visível
/// que não pertence a outra janela (a mesma regra do MainWindowHandle do .NET, que o Electron usava). Só
/// mexe numa janela que tem o botão de maximizar: um emulador em tela cheia fica como está. Se o
/// processo fechar antes, desiste.
pub fn maximize_window(pid: u32) {
    thread::spawn(move || {
        let start = Instant::now();
        while start.elapsed() < TIMEOUT && is_running(pid) {
            if let Some(window) = main_window(pid) {
                // SAFETY: a janela veio do EnumWindows agora; se ela fechar no meio, as funções só falham.
                unsafe {
                    if GetWindowLongW(window, GWL_STYLE) as u32 & WS_MAXIMIZEBOX.0 != 0 {
                        let _ = ShowWindow(window, SW_MAXIMIZE);
                    }
                }
                return;
            }
            thread::sleep(POLL);
        }
    });
}

/// O processo ainda está aberto?
fn is_running(pid: u32) -> bool {
    // SAFETY: o identificador aberto aqui é fechado logo depois de usado.
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return false };
        let mut code = 0;
        let running = GetExitCodeProcess(process, &mut code).is_ok() && code == STILL_ACTIVE;
        let _ = CloseHandle(process);
        running
    }
}

/// A janela principal do processo, se ela já apareceu.
fn main_window(pid: u32) -> Option<HWND> {
    struct Search {
        pid: u32,
        found: Option<HWND>,
    }

    unsafe extern "system" fn visit(window: HWND, data: LPARAM) -> BOOL {
        // SAFETY: `data` é o endereço da busca abaixo, que existe enquanto o EnumWindows roda.
        let search = unsafe { &mut *(data.0 as *mut Search) };
        let mut owner_pid = 0;
        // SAFETY: funções de consulta sobre a janela que o próprio Windows passou.
        unsafe {
            GetWindowThreadProcessId(window, Some(&mut owner_pid));
            if owner_pid == search.pid && IsWindowVisible(window).as_bool() && GetWindow(window, GW_OWNER).is_err() {
                search.found = Some(window);
                return BOOL(0);
            }
        }
        BOOL(1)
    }

    let mut search = Search { pid, found: None };
    // SAFETY: a busca vive até o fim do EnumWindows, que só chama `visit` durante a própria execução.
    unsafe {
        let _ = EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize));
    }
    search.found
}

#[cfg(test)]
mod tests {
    use std::io::Read;
    use std::process::{Command, Stdio};

    use super::*;
    use crate::test_support::temp_folder;

    /// Um "emulador" de teste: um PowerShell que, depois de meio segundo (como um emulador carregando o
    /// jogo), mostra uma janela vazia e invisível (opacidade 0). Quando o arquivo `done` aparece, ela fecha
    /// e escreve como estava: "Maximized" ou "Normal". Sem o botão de maximizar, ela é como a de um
    /// emulador em tela cheia.
    fn test_window(maximize_box: bool) -> String {
        let folder = temp_folder(if maximize_box { "janela-maximizar" } else { "janela-tela-cheia" });
        let done = folder.join("pronto");
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 500
$form = New-Object Windows.Forms.Form
$form.Text = 'Playtrove Dev (teste)'
$form.Opacity = 0
$form.MaximizeBox = ${maximize_box}
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 100
$timer.add_Tick({{ if (Test-Path '{done}') {{ $global:state = [string]$form.WindowState; $form.Close() }} }})
$form.add_Shown({{ $timer.Start() }})
[Windows.Forms.Application]::Run($form)
[Console]::Out.Write($global:state)",
            done = done.to_string_lossy().replace('\'', "''"),
        );
        let mut child = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        maximize_window(child.id());
        thread::sleep(Duration::from_secs(4));
        std::fs::write(&done, "").unwrap();
        let mut output = String::new();
        child.stdout.take().unwrap().read_to_string(&mut output).unwrap();
        child.wait().unwrap();
        output
    }

    #[test]
    fn maximiza_a_janela_quando_ela_aparece() {
        assert_eq!(test_window(true), "Maximized");
    }

    #[test]
    fn janela_sem_o_botao_de_maximizar_fica_como_esta() {
        assert_eq!(test_window(false), "Normal");
    }
}
