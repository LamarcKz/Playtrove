//! libretro-thumbnails: as capas oficiais (a caixa escaneada) que o RetroArch usa, uma pasta por console,
//! com o nome exato da ROM nos padrões No-Intro e Redump (os mesmos dos arquivos). Grátis e sem chave.
//! Para jogos de emulador, é a fonte mais certeira: acha a capa da versão e da região da ROM (escolha do
//! usuário em 2026-09-19).

use super::http::MetadataEndpoints;
use super::matching::comparable_name;
use crate::images::encode_uri_component;

/// Nome de cada console no servidor de capas, pelo console da pasta de ROMs (e alguns apelidos).
const LIBRETRO_SYSTEMS: [(&str, &str); 30] = [
    ("playstation", "Sony - PlayStation"),
    ("ps1", "Sony - PlayStation"),
    ("psx", "Sony - PlayStation"),
    ("playstation 2", "Sony - PlayStation 2"),
    ("ps2", "Sony - PlayStation 2"),
    ("playstation portable", "Sony - PlayStation Portable"),
    ("psp", "Sony - PlayStation Portable"),
    ("game boy advance", "Nintendo - Game Boy Advance"),
    ("gba", "Nintendo - Game Boy Advance"),
    ("game boy", "Nintendo - Game Boy"),
    ("gb", "Nintendo - Game Boy"),
    ("game boy color", "Nintendo - Game Boy Color"),
    ("gbc", "Nintendo - Game Boy Color"),
    ("nintendo ds", "Nintendo - Nintendo DS"),
    ("nds", "Nintendo - Nintendo DS"),
    ("ds", "Nintendo - Nintendo DS"),
    ("super nintendo", "Nintendo - Super Nintendo Entertainment System"),
    ("snes", "Nintendo - Super Nintendo Entertainment System"),
    ("nes", "Nintendo - Nintendo Entertainment System"),
    ("nintendo 64", "Nintendo - Nintendo 64"),
    ("n64", "Nintendo - Nintendo 64"),
    ("gamecube", "Nintendo - GameCube"),
    ("gc", "Nintendo - GameCube"),
    ("ngc", "Nintendo - GameCube"),
    ("wii", "Nintendo - Wii"),
    ("nintendo 3ds", "Nintendo - Nintendo 3DS"),
    ("3ds", "Nintendo - Nintendo 3DS"),
    ("mega drive", "Sega - Mega Drive - Genesis"),
    ("genesis", "Sega - Mega Drive - Genesis"),
    ("sega genesis", "Sega - Mega Drive - Genesis"),
];

/// Endereço da capa de uma ROM no libretro-thumbnails, ex.:
/// …/Sony - PlayStation 2/Named_Boxarts/Corrida Noturna - Edição Turbo (USA).png. None se o console não
/// estiver lá (ex.: PlayStation 3) ou o jogo não tiver ROM.
pub fn libretro_boxart_url(endpoints: &MetadataEndpoints, platform: Option<&str>, rom_path: Option<&str>) -> Option<String> {
    let console = comparable_name(platform?);
    let system = LIBRETRO_SYSTEMS.iter().find(|(name, _)| *name == console)?.1;
    let file = rom_path?.rsplit(['\\', '/']).next()?;
    let stem = file.rsplit_once('.').map_or(file, |(stem, _)| stem);
    // O RetroArch troca estes caracteres por "_" nos nomes dos arquivos de capa.
    let name: String = stem.chars().map(|character| if "&*/:`<>?\\|\"".contains(character) { '_' } else { character }).collect();
    Some(format!(
        "{}/{}/Named_Boxarts/{}.png",
        endpoints.libretro_thumbnails,
        encode_uri_component(system),
        encode_uri_component(&name)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monta_o_endereco_da_capa_pelo_console_e_pelo_nome_exato_da_rom() {
        let endpoints = MetadataEndpoints::test("https://servidor");
        assert_eq!(
            libretro_boxart_url(&endpoints, Some("PlayStation 2"), Some(r"D:\PS2\Corrida Noturna - Edição Turbo (USA).iso"))
                .unwrap(),
            "https://servidor/libretro/Sony%20-%20PlayStation%202/Named_Boxarts/Corrida%20Noturna%20-%20Edi%C3%A7%C3%A3o%20Turbo%20(USA).png"
        );
        assert_eq!(
            libretro_boxart_url(&endpoints, Some("Nintendo DS"), Some(r"D:\DS\Criaturas Lendárias - Edição Prata (USA).zip"))
                .unwrap(),
            "https://servidor/libretro/Nintendo%20-%20Nintendo%20DS/Named_Boxarts/Criaturas%20Lend%C3%A1rias%20-%20Edi%C3%A7%C3%A3o%20Prata%20(USA).png"
        );
        // Os caracteres que não valem em nome de arquivo viram "_", como no RetroArch.
        assert!(
            libretro_boxart_url(&endpoints, Some("ps1"), Some(r"D:\PS1\Cripta Antiga II: A Volta (USA).cue"))
                .unwrap()
                .contains("Cripta%20Antiga%20II_%20A%20Volta%20(USA).png")
        );
        // Console que não está lá (PlayStation 3) ou jogo sem ROM: não tem capa no libretro.
        assert_eq!(libretro_boxart_url(&endpoints, Some("PlayStation 3"), Some(r"D:\PS3\Manobras Radicais 3.iso")), None);
        assert_eq!(libretro_boxart_url(&endpoints, Some("PlayStation 2"), None), None);
    }
}
