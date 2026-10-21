//! Os sites que o app abre no navegador: as páginas para criar as chaves, a de download das versões e o
//! formulário de bug do GitHub (o mesmo de src/main/bugReport.ts), com a versão do app e a do Windows.

use tauri::Url;
use windows::Win32::System::Registry::{HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ, RegGetValueW};
use windows::core::{HSTRING, PCWSTR, w};

/// Os sites que a interface pode abrir (os mesmos de EXTERNAL_LINKS, em src/shared/ipc.ts). A interface
/// manda só o nome; o endereço fica aqui, e nenhum outro é aberto.
pub const EXTERNAL_LINKS: [(&str, &str); 4] = [
    ("twitchConsole", "https://dev.twitch.tv/console/apps"),
    ("steamGridDbApi", "https://www.steamgriddb.com/profile/preferences/api"),
    ("retroAchievementsSettings", "https://retroachievements.org/settings"),
    ("releases", "https://github.com/LamarcKz/Playtrove/releases/latest"),
];

/// O endereço de um dos sites conhecidos, pelo nome.
pub fn external_link(name: &str) -> Option<&'static str> {
    EXTERNAL_LINKS.iter().find(|(link, _)| *link == name).map(|(_, url)| *url)
}

/// O formulário de bug do repositório (.github/ISSUE_TEMPLATE/bug_report.yml).
const NEW_ISSUE_URL: &str = "https://github.com/LamarcKz/Playtrove/issues/new";

/// O endereço do formulário de bug no GitHub, com a versão do app e a do Windows já preenchidas (o GitHub
/// preenche os campos do formulário pelo id: `version` e `windows`). A pessoa ainda revê tudo antes de
/// enviar.
pub fn bug_report_url(app_version: &str, portable: bool, windows: &str) -> String {
    let version = if portable { format!("{app_version} (portable)") } else { app_version.to_string() };
    Url::parse_with_params(NEW_ISSUE_URL, [("template", "bug_report.yml"), ("version", &version), ("windows", windows)])
        .map(String::from)
        .unwrap_or_else(|_| NEW_ISSUE_URL.to_string())
}

/// O Windows deste computador, como o Electron escrevia: "Windows 11 Pro (10.0.26200)".
pub fn windows_description() -> String {
    let name = registry_text("ProductName").unwrap_or_else(|| "Windows".to_string());
    let build = registry_text("CurrentBuildNumber").and_then(|build| build.parse::<u32>().ok()).unwrap_or(0);
    let major = registry_number("CurrentMajorVersionNumber").unwrap_or(10);
    let minor = registry_number("CurrentMinorVersionNumber").unwrap_or(0);
    format!("{} ({major}.{minor}.{build})", windows_name(&name, build))
}

/// O nome do Windows. O registro do Windows 11 ainda diz "Windows 10" (a partir da versão 22000 é o 11).
fn windows_name(product_name: &str, build: u32) -> String {
    match product_name.strip_prefix("Windows 10") {
        Some(edition) if build >= 22000 => format!("Windows 11{edition}"),
        _ => product_name.to_string(),
    }
}

/// Onde o Windows guarda o nome e a versão dele.
const CURRENT_VERSION_KEY: PCWSTR = w!(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion");

fn registry_text(value: &str) -> Option<String> {
    let mut buffer = [0u16; 256];
    let mut size = std::mem::size_of_val(&buffer) as u32;
    let result = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            CURRENT_VERSION_KEY,
            &HSTRING::from(value),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if result.is_err() {
        return None;
    }
    let length = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..length]))
}

fn registry_number(value: &str) -> Option<u32> {
    let mut number = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let result = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            CURRENT_VERSION_KEY,
            &HSTRING::from(value),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut number as *mut u32).cast()),
            Some(&mut size),
        )
    };
    result.is_ok().then_some(number)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(url: &str) -> Vec<(String, String)> {
        Url::parse(url).unwrap().query_pairs().map(|(name, value)| (name.into_owned(), value.into_owned())).collect()
    }

    #[test]
    fn abre_o_formulario_do_github_com_a_versao_do_app_e_a_do_windows() {
        let url = bug_report_url("0.5.0", false, "Windows 11 Pro (10.0.26200)");
        assert!(url.starts_with("https://github.com/LamarcKz/Playtrove/issues/new?"));
        assert_eq!(
            query(&url),
            [
                ("template".to_string(), "bug_report.yml".to_string()),
                ("version".to_string(), "0.5.0".to_string()),
                ("windows".to_string(), "Windows 11 Pro (10.0.26200)".to_string()),
            ]
        );
    }

    #[test]
    fn na_versao_portatil_a_versao_diz_que_e_a_portatil() {
        let url = bug_report_url("0.5.0", true, "Windows 10 Home (10.0.19045)");
        assert!(query(&url).contains(&("version".to_string(), "0.5.0 (portable)".to_string())));
    }

    #[test]
    fn o_windows_11_aparece_com_o_nome_certo() {
        assert_eq!(windows_name("Windows 10 Pro", 26200), "Windows 11 Pro");
        assert_eq!(windows_name("Windows 10 Home", 19045), "Windows 10 Home");
        assert_eq!(windows_name("Windows Server 2022", 20348), "Windows Server 2022");
    }

    #[test]
    fn so_os_sites_conhecidos_sao_abertos() {
        assert_eq!(external_link("releases"), Some("https://github.com/LamarcKz/Playtrove/releases/latest"));
        assert_eq!(external_link("https://example.com"), None);
        assert_eq!(external_link("toString"), None);
    }
}
