//! As imagens dos troféus do PS3 ficam em <imagens>/trophies/<conjunto>/<id>.png: o app copia da pasta do
//! RPCS3 (diminuídas) e a interface mostra pelo mesmo protocolo das capas.

use std::path::{Path, PathBuf};

use image::imageops::FilterType;

use super::trophy_files::trophy_icon_file;
use crate::images::images_url;

const FOLDER: &str = "trophies";

/// Tamanho das imagens guardadas (as do jogo têm 240×240; a tela usa no máximo 48).
const ICON_SIZE: u32 = 96;

/// A pasta das imagens de um conjunto de troféus.
pub fn trophy_icons_dir(images_dir: &Path, set_id: &str) -> PathBuf {
    images_dir.join(FOLDER).join(set_id)
}

/// Endereço da imagem de um troféu para a interface, ou None se ela não foi copiada.
pub fn trophy_icon_url(images_dir: &Path, set_id: &str, trophy_id: i64) -> Option<String> {
    trophy_icons_dir(images_dir, set_id)
        .join(format!("{trophy_id}.png"))
        .exists()
        .then(|| images_url(&format!("{FOLDER}/{set_id}/{trophy_id}.png")))
}

/// Copia as imagens que ainda não estão na pasta do app (uma que falhar fica com o troféu desenhado).
pub fn copy_trophy_icons(
    set_dir: &Path,
    icons_dir: &Path,
    trophy_ids: &[i64],
    copy_icon: &dyn Fn(&Path, &Path) -> Result<(), String>,
) {
    if std::fs::create_dir_all(icons_dir).is_err() {
        return;
    }
    for id in trophy_ids {
        let source = trophy_icon_file(set_dir, *id);
        let target = icons_dir.join(format!("{id}.png"));
        if target.exists() || !source.exists() {
            continue;
        }
        if let Err(error) = copy_icon(&source, &target) {
            eprintln!("[troféus] não deu para copiar a imagem {}: {error}", source.display());
        }
    }
}

/// Copia a imagem de um troféu diminuída (o PNG do jogo tem uns 100 KB; a cópia, poucos KB).
pub fn copy_trophy_icon_resized(source: &Path, target: &Path) -> Result<(), String> {
    let reader =
        image::ImageReader::open(source).and_then(|reader| reader.with_guessed_format()).map_err(|error| error.to_string())?;
    let image = reader.decode().map_err(|error| error.to_string())?;
    image.resize_exact(ICON_SIZE, ICON_SIZE, FilterType::Lanczos3).save(target).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_folder;

    #[test]
    fn diminui_a_imagem_do_trofeu() {
        let folder = temp_folder("trofeu-imagem");
        let source = folder.join("TROP000.PNG");
        image::RgbaImage::from_pixel(240, 240, image::Rgba([200, 160, 40, 255])).save(&source).unwrap();
        let target = folder.join("0.png");
        copy_trophy_icon_resized(&source, &target).unwrap();
        let copy = image::open(&target).unwrap();
        assert_eq!((copy.width(), copy.height()), (96, 96));
        assert!(copy_trophy_icon_resized(&folder.join("nao-existe.png"), &folder.join("x.png")).is_err());
    }
}
