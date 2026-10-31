//! As imagens dos jogos (capas e fundos), em <dados do app>/images/<id do jogo>/cover.png...
//! A interface mostra pelo protocolo playtrove-img, que só entrega arquivos dessa pasta. No Windows, o
//! Tauri serve um protocolo próprio como http://playtrove-img.localhost/.

use std::path::{Path, PathBuf};

use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use tauri::http::{HeaderValue, Request, Response, StatusCode, header::CONTENT_TYPE};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::test_hooks::{self, TestHooks};

/// O protocolo das imagens dos jogos.
pub const IMAGE_PROTOCOL: &str = "playtrove-img";

/// A pasta das imagens (<dados do app>/images), guardada no estado do app ao abrir.
pub struct ImagesDir(pub PathBuf);

/// O que o encodeURIComponent do JavaScript deixa como está.
const URI_COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

/// Um texto num pedaço de endereço, como o encodeURIComponent do JavaScript.
pub fn encode_uri_component(text: &str) -> String {
    utf8_percent_encode(text, URI_COMPONENT).to_string()
}

/// As imagens de um jogo: capa (retrato) e fundo (paisagem). O ícone da lista é um pedaço da capa.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ImageKind {
    Cover,
    Background,
    /// A logo do jogo: o nome desenhado, com fundo transparente (a tela cheia mostra no lugar do título).
    Logo,
}

impl ImageKind {
    /// O começo do nome do arquivo (cover.png, background.jpg).
    fn file_prefix(self) -> &'static str {
        match self {
            ImageKind::Cover => "cover",
            ImageKind::Background => "background",
            ImageKind::Logo => "logo",
        }
    }
}

/// Maior imagem aceita, em bytes (as capas e fundos costumam ter até uns 5 MB).
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

/// Extensão de arquivo para o tipo da imagem (cabeçalho Content-Type), ou None se não for uma imagem aceita.
pub fn image_extension(content_type: Option<&str>) -> Option<&'static str> {
    let mime = content_type?.split(';').next()?.trim().to_lowercase();
    match mime.as_str() {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "image/x-icon" | "image/vnd.microsoft.icon" => Some("ico"),
        _ => None,
    }
}

/// Grava uma imagem do jogo na pasta dele (ex.: images/12/cover.png), apagando a anterior do mesmo tipo
/// (que pode ter outra extensão). Devolve o nome do arquivo.
pub fn save_game_image(
    images_dir: &Path,
    game_id: i64,
    kind: ImageKind,
    bytes: &[u8],
    extension: &str,
) -> std::io::Result<String> {
    let dir = images_dir.join(game_id.to_string());
    std::fs::create_dir_all(&dir)?;
    let prefix = format!("{}.", kind.file_prefix());
    for entry in std::fs::read_dir(&dir)?.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    let file_name = format!("{}.{extension}", kind.file_prefix());
    std::fs::write(dir.join(&file_name), bytes)?;
    Ok(file_name)
}

/// Endereço de um arquivo da pasta de imagens para a interface (ex.: "trophies/NPWR01234_00/3.png", as
/// imagens dos troféus, e "achievements/123.png", as insígnias).
pub fn images_url(relative: &str) -> String {
    let path: Vec<String> = relative.split('/').map(encode_uri_component).collect();
    format!("http://{IMAGE_PROTOCOL}.localhost/{}", path.join("/"))
}

/// Endereço de uma imagem de jogo para a interface, ex.: http://playtrove-img.localhost/12/cover.png?v=...
/// O `version` (a data do download) muda quando a imagem é trocada, para a tela não mostrar a antiga.
pub fn image_url(game_id: i64, file_name: &str, version: Option<&str>) -> String {
    let query = version.map(|version| format!("?v={}", encode_uri_component(version))).unwrap_or_default();
    format!("http://{IMAGE_PROTOCOL}.localhost/{game_id}/{}{query}", encode_uri_component(file_name))
}

/// Responde aos pedidos de imagem da interface com o arquivo da pasta de imagens, fora da linha da janela
/// (ler o disco não trava a tela). Nos testes, uma imagem pode ficar retida até o teste liberar
/// (test_hooks.rs).
pub fn handle_request<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = context.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = request.uri().path();
        if test_hooks::active() {
            app.state::<TestHooks>().wait_if_held(path.trim_start_matches('/'));
        }
        let response = match image_file(&app.state::<ImagesDir>().0, path) {
            Some((bytes, mime)) => {
                let mut response = Response::new(bytes);
                response.headers_mut().insert(CONTENT_TYPE, HeaderValue::from_static(mime));
                response
            }
            None => {
                let mut response = Response::new(Vec::new());
                *response.status_mut() = StatusCode::NOT_FOUND;
                response
            }
        };
        responder.respond(response);
    });
}

/// O arquivo pedido e o tipo dele. Segurança: nada fora da pasta de imagens é entregue, nem com "..".
fn image_file(root: &Path, path: &str) -> Option<(Vec<u8>, &'static str)> {
    let relative = percent_decode_str(path.trim_start_matches(['/', '\\'])).decode_utf8().ok()?;
    let root = root.canonicalize().ok()?;
    let file = root.join(relative.as_ref()).canonicalize().ok()?;
    if !file.starts_with(&root) || !file.is_file() {
        return None;
    }
    let mime = match file.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        _ => return None,
    };
    Some((std::fs::read(&file).ok()?, mime))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_endereco_leva_o_jogo_o_arquivo_e_a_versao() {
        assert_eq!(
            image_url(12, "cover.png", Some("2026-10-21T10:00:00.000Z")),
            "http://playtrove-img.localhost/12/cover.png?v=2026-10-21T10%3A00%3A00.000Z"
        );
        assert_eq!(image_url(3, "capa nova.jpg", None), "http://playtrove-img.localhost/3/capa%20nova.jpg");
    }

    #[test]
    fn so_entrega_imagens_da_pasta_de_imagens() {
        let folder = std::env::temp_dir().join(format!("playtrove-teste-imagens-{}", std::process::id()));
        let root = folder.join("images");
        std::fs::create_dir_all(root.join("12")).unwrap();
        std::fs::write(root.join("12").join("cover.png"), "capa").unwrap();
        std::fs::write(folder.join("segredo.png"), "fora da pasta").unwrap();
        std::fs::write(root.join("12").join("notas.txt"), "não é imagem").unwrap();

        assert_eq!(image_file(&root, "/12/cover.png"), Some((b"capa".to_vec(), "image/png")));
        assert_eq!(image_file(&root, "/../segredo.png"), None);
        assert_eq!(image_file(&root, "/12/..%2F..%2Fsegredo.png"), None);
        assert_eq!(image_file(&root, "/12/notas.txt"), None);
        assert_eq!(image_file(&root, "/12/sumiu.png"), None);
    }

    #[test]
    fn extensao_e_troca_da_imagem_de_um_tipo() {
        assert_eq!(image_extension(Some("image/png; charset=binary")), Some("png"));
        assert_eq!(image_extension(Some("image/jpeg")), Some("jpg"));
        assert_eq!(image_extension(Some("text/html")), None);
        assert_eq!(image_extension(None), None);

        let dir = crate::test_support::temp_folder("imagens-troca");
        save_game_image(&dir, 3, ImageKind::Cover, b"capa", "png").unwrap();
        save_game_image(&dir, 3, ImageKind::Background, b"fundo", "png").unwrap();
        assert_eq!(save_game_image(&dir, 3, ImageKind::Cover, b"capa nova", "jpg").unwrap(), "cover.jpg");
        let mut files: Vec<String> = std::fs::read_dir(dir.join("3"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        files.sort();
        assert_eq!(files, ["background.png", "cover.jpg"]);
    }
}
