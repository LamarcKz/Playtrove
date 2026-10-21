//! As imagens dos jogos (capas e fundos), em <dados do app>/images/<id do jogo>/cover.png...
//! A interface mostra pelo protocolo playtrove-img, que só entrega arquivos dessa pasta. No Windows, o
//! Tauri serve um protocolo próprio como http://playtrove-img.localhost/.

use std::borrow::Cow;
use std::path::{Path, PathBuf};

use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use tauri::http::{HeaderValue, Request, Response, StatusCode, header::CONTENT_TYPE};
use tauri::{Manager, Runtime, UriSchemeContext};

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

fn encode(text: &str) -> String {
    utf8_percent_encode(text, URI_COMPONENT).to_string()
}

/// Endereço de uma imagem de jogo para a interface, ex.: http://playtrove-img.localhost/12/cover.png?v=...
/// O `version` (a data do download) muda quando a imagem é trocada, para a tela não mostrar a antiga.
pub fn image_url(game_id: i64, file_name: &str, version: Option<&str>) -> String {
    let query = version.map(|version| format!("?v={}", encode(version))).unwrap_or_default();
    format!("http://{IMAGE_PROTOCOL}.localhost/{game_id}/{}{query}", encode(file_name))
}

/// Responde aos pedidos de imagem da interface com o arquivo da pasta de imagens.
pub fn handle_request<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let root = &context.app_handle().state::<ImagesDir>().0;
    match image_file(root, request.uri().path()) {
        Some((bytes, mime)) => {
            let mut response = Response::new(Cow::Owned(bytes));
            response.headers_mut().insert(CONTENT_TYPE, HeaderValue::from_static(mime));
            response
        }
        None => {
            let mut response = Response::new(Cow::Borrowed(&[][..]));
            *response.status_mut() = StatusCode::NOT_FOUND;
            response
        }
    }
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
}
