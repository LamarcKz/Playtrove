//! As opções de energia do menu principal da tela cheia, como no Playnite: bloquear, suspender, reiniciar
//! e desligar o Windows. A tela pede confirmação antes; nos testes do app, nada é executado (só anotado).

use std::os::windows::process::CommandExt;
use std::process::Command;

/// As ações aceitas, na ordem do menu.
pub const ACTIONS: [&str; 4] = ["lock", "sleep", "restart", "shutdown"];
/// Sem janela de console para o `shutdown.exe`.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Os argumentos do `shutdown.exe` para reiniciar e desligar, sem espera e sem forçar: os outros programas
/// ainda podem pedir para salvar.
fn shutdown_arguments(action: &str) -> Option<[&'static str; 3]> {
    match action {
        "restart" => Some(["/r", "/t", "0"]),
        "shutdown" => Some(["/s", "/t", "0"]),
        _ => None,
    }
}

pub fn run(action: &str) -> Result<(), String> {
    match action {
        // SAFETY: funções do Windows sem parâmetros de memória.
        "lock" => unsafe { windows::Win32::System::Shutdown::LockWorkStation() }.map_err(|error| error.to_string()),
        "sleep" => {
            // SAFETY: sem ponteiros; suspende sem hibernar e sem forçar.
            let done = unsafe { windows::Win32::System::Power::SetSuspendState(false, false, false) };
            if done { Ok(()) } else { Err("o Windows não suspendeu".into()) }
        }
        _ => {
            let arguments = shutdown_arguments(action).ok_or("ação de energia desconhecida")?;
            let system = std::env::var_os("SystemRoot").ok_or("pasta do Windows desconhecida")?;
            let program = std::path::Path::new(&system).join("System32").join("shutdown.exe");
            Command::new(program)
                .args(arguments)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reiniciar_e_desligar_usam_o_shutdown_sem_espera() {
        assert_eq!(shutdown_arguments("restart"), Some(["/r", "/t", "0"]));
        assert_eq!(shutdown_arguments("shutdown"), Some(["/s", "/t", "0"]));
        assert_eq!(shutdown_arguments("lock"), None);
        assert!(ACTIONS.iter().all(|action| ["lock", "sleep"].contains(action) || shutdown_arguments(action).is_some()));
    }
}
