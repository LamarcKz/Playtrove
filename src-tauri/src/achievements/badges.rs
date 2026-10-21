//! As insígnias das conquistas ficam em <imagens>/achievements/: a colorida (123.png) para as
//! desbloqueadas e a apagada (123_lock.png) para as que faltam, como o RetroAchievements publica. A
//! interface mostra pelo mesmo protocolo das capas.

use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use super::client::RaEndpoints;
use crate::images::{MAX_IMAGE_BYTES, image_extension, images_url};
use crate::metadata::http::{Fetch, HttpRequest};

const FOLDER: &str = "achievements";

/// Quantas insígnias baixam ao mesmo tempo.
const PARALLEL: usize = 4;

/// O nome do arquivo da insígnia: colorida se desbloqueada; apagada se não.
fn badge_file(badge_name: &str, earned: bool) -> String {
    format!("{badge_name}{}.png", if earned { "" } else { "_lock" })
}

/// Endereço da insígnia para a interface, ou None se ela ainda não foi baixada.
pub fn badge_url(images_dir: &Path, badge_name: Option<&str>, earned: bool) -> Option<String> {
    let file = badge_file(badge_name?, earned);
    images_dir.join(FOLDER).join(&file).exists().then(|| images_url(&format!("{FOLDER}/{file}")))
}

/// Baixa as insígnias que faltam no disco (a colorida das desbloqueadas e a apagada das outras). Uma que
/// falhar fica para a próxima vez; sem internet, para tudo sem erro (as imagens não são essenciais).
pub fn download_badges(
    fetch: &dyn Fetch,
    endpoints: &RaEndpoints,
    images_dir: &Path,
    achievements: &[(Option<String>, bool)],
) -> usize {
    let dir = images_dir.join(FOLDER);
    let mut missing: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for (name, earned) in achievements {
        let Some(name) = name
            .as_deref()
            .filter(|name| name.chars().all(|character| character.is_ascii_alphanumeric() || "_-".contains(character)))
        else {
            continue;
        };
        let file = badge_file(name, *earned);
        if !dir.join(&file).exists() && seen.insert(file.clone()) {
            missing.push(file);
        }
    }
    if missing.is_empty() || std::fs::create_dir_all(&dir).is_err() {
        return 0;
    }

    let stopped = AtomicBool::new(false);
    let mut saved = 0;
    for chunk in missing.chunks(PARALLEL) {
        saved += std::thread::scope(|scope| {
            let handles: Vec<_> = chunk
                .iter()
                .map(|file| {
                    let (dir, stopped) = (&dir, &stopped);
                    scope.spawn(move || {
                        if stopped.load(Ordering::Relaxed) {
                            return false;
                        }
                        let Ok(response) = fetch.fetch(&HttpRequest::get(format!("{}/Badge/{file}", endpoints.media))) else {
                            // Sem conexão: não adianta tentar as outras agora.
                            stopped.store(true, Ordering::Relaxed);
                            return false;
                        };
                        let image = response.ok() && image_extension(response.content_type.as_deref()).is_some();
                        let size = response.body.len();
                        image && size > 0 && size <= MAX_IMAGE_BYTES && std::fs::write(dir.join(file), &response.body).is_ok()
                    })
                })
                .collect();
            handles.into_iter().map(|handle| handle.join().unwrap_or(false)).filter(|saved| *saved).count()
        });
    }
    saved
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::metadata::http::fake::{FakeFetch, image, not_found};
    use crate::test_support::temp_folder;

    #[test]
    fn baixa_a_colorida_das_desbloqueadas_e_a_apagada_das_outras_uma_vez_so() {
        let images = temp_folder("insignias");
        let fetch =
            Arc::new(FakeFetch::new(|url, _| if url.path().ends_with("9999.png") { not_found() } else { image("image/png") }));
        let endpoints = RaEndpoints { api: "https://ra.test/API".into(), media: "https://ra.test/media".into() };
        let badges = [
            (Some("1001".to_string()), true),
            (Some("1002".to_string()), false),
            (Some("1002".to_string()), false),
            (Some("9999".to_string()), true),
            (None, true),
            (Some("../fora".to_string()), true),
        ];

        assert_eq!(download_badges(&*fetch, &endpoints, &images, &badges), 2);
        assert_eq!(fetch.urls().len(), 3);
        assert!(badge_url(&images, Some("1001"), true).unwrap().ends_with("/achievements/1001.png"));
        assert!(badge_url(&images, Some("1002"), false).unwrap().ends_with("/achievements/1002_lock.png"));
        assert_eq!(badge_url(&images, Some("1002"), true), None);
        // Já no disco: nada é baixado de novo.
        assert_eq!(download_badges(&*fetch, &endpoints, &images, &badges[..2]), 0);
    }
}
