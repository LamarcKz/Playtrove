//! A "cor dinâmica" da tela cheia: a cor de destaque tirada da arte do jogo, portada do DynamicAuto do
//! Aniki Helper (MIT). Um histograma de 4096 cores (4 bits por canal) sobre o miolo da imagem, com peso
//! para as cores saturadas e descontos para pele, verde-oliva, claras e escuras demais; depois, o ajuste de
//! legibilidade dele. A paleta inteira sai dessa cor na interface (lib/dynamicColors.ts).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use image::imageops::FilterType;
use rusqlite::{Connection, OptionalExtension};

type Rgb = (u8, u8, u8);

/// A cor quando a imagem não dá nenhuma (a mesma do Helper).
const FALLBACK: Rgb = (31, 35, 45);
/// A imagem é reduzida antes de contar: a cor dominante não muda, e a conta fica rápida.
const SAMPLE_WIDTH: u32 = 320;

/// A cor de destaque do jogo, em "#rrggbb", pela arte de fundo (ou a capa, sem fundo). None sem imagem
/// que dê para ler. Guarda o resultado de cada arquivo enquanto ele não mudar.
pub fn game_accent(db: &Connection, images_dir: &Path, game_id: i64) -> rusqlite::Result<Option<String>> {
    let files: Option<(Option<String>, Option<String>)> = db
        .query_row("SELECT background_image, cover_image FROM games WHERE id = ?1", [game_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?;
    let Some((background, cover)) = files else { return Ok(None) };
    let dir = images_dir.join(game_id.to_string());
    Ok([background, cover].into_iter().flatten().find_map(|file| cached_accent(&dir.join(file))))
}

fn cached_accent(path: &Path) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<(PathBuf, SystemTime), String>>> = OnceLock::new();
    let modified = std::fs::metadata(path).and_then(|meta| meta.modified()).ok()?;
    let key = (path.to_path_buf(), modified);
    let cache = CACHE.get_or_init(Default::default);
    if let Some(hit) = cache.lock().ok()?.get(&key) {
        return Some(hit.clone());
    }
    let accent = hex(readable(dominant_vivid(&image::open(path).ok()?)));
    cache.lock().ok()?.insert(key, accent.clone());
    Some(accent)
}

fn hex((r, g, b): Rgb) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Brilho de 0 a 255, com os pesos do Helper.
fn lum255(r: u8, g: u8, b: u8) -> i32 {
    (54 * r as i32 + 183 * g as i32 + 18 * b as i32) / 255
}

fn chroma((r, g, b): Rgb) -> i32 {
    r.max(g).max(b) as i32 - r.min(g).min(b) as i32
}

fn hue((r, g, b): Rgb) -> f64 {
    let max = r.max(g).max(b) as f64;
    let min = r.min(g).min(b) as f64;
    let d = max - min;
    if d <= 0.0 {
        return 0.0;
    }
    let (r, g, b) = (r as f64, g as f64, b as f64);
    let mut hue = if max == r {
        ((g - b) / d) % 6.0
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    } * 60.0;
    if hue < 0.0 {
        hue += 360.0;
    }
    hue
}

fn low_saturation(r: u8, g: u8, b: u8) -> bool {
    let max = r.max(g).max(b) as i32;
    (max - r.min(g).min(b) as i32) * 100 < 18 * max.max(1)
}

fn skin_likely(r: u8, g: u8, b: u8) -> bool {
    if chroma((r, g, b)) < 20 {
        return false;
    }
    let lum = lum255(r, g, b);
    lum > 64 && lum < 217
}

fn luminance((r, g, b): Rgb) -> f64 {
    (0.2126 * r as f64 + 0.7152 * g as f64 + 0.0722 * b as f64) / 255.0
}

fn clamp(value: f64) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

fn saturate(color: Rgb, amount: f64) -> Rgb {
    let (r, g, b) = color;
    let y = 0.2126 * r as f64 + 0.7152 * g as f64 + 0.0722 * b as f64;
    let push = |c: u8| clamp(y + (c as f64 - y) * (1.0 + amount));
    (push(r), push(g), push(b))
}

fn darken((r, g, b): Rgb, amount: f64) -> Rgb {
    let scale = |c: u8| (c as f64 * (1.0 - amount)) as u8;
    (scale(r), scale(g), scale(b))
}

fn mix(a: Rgb, b: Rgb, t: f64) -> Rgb {
    let blend = |x: u8, y: u8| (x as f64 * (1.0 - t) + y as f64 * t) as u8;
    (blend(a.0, b.0), blend(a.1, b.1), blend(a.2, b.2))
}

fn bucket(index: usize) -> Rgb {
    let channel = |shift: usize| (((index >> shift) & 0xF) * 16 + 8) as u8;
    (channel(8), channel(4), channel(0))
}

/// A cor dominante mais viva do miolo da imagem (12% de margem em cada borda), como o Helper.
fn dominant_vivid(image: &image::DynamicImage) -> Rgb {
    let small = if image.width() > SAMPLE_WIDTH {
        image.resize(SAMPLE_WIDTH, SAMPLE_WIDTH * 4, FilterType::Triangle).to_rgba8()
    } else {
        image.to_rgba8()
    };
    let (w, h) = small.dimensions();
    let mut hist = vec![0.0f64; 4096];
    let (mut considered, mut bright, mut colorful) = (0usize, 0usize, 0usize);
    for y in (h * 12 / 100..h * 88 / 100).step_by(2) {
        for x in (w * 12 / 100..w * 88 / 100).step_by(2) {
            let [r, g, b, a] = small.get_pixel(x, y).0;
            let lum = lum255(r, g, b);
            if a < 16 || lum < 31 {
                continue;
            }
            considered += 1;
            if lum > 209 {
                bright += 1;
            }
            if low_saturation(r, g, b) {
                continue;
            }
            if skin_likely(r, g, b) {
                let max = r.max(g).max(b) as i32;
                let moderate = (max - r.min(g).min(b) as i32) * 100 < 45 * max.max(1);
                if (15.0..=45.0).contains(&hue((r, g, b))) && moderate {
                    continue;
                }
            }
            colorful += 1;
            let saturation_weight = 1.0 + chroma((r, g, b)) as f64 / 255.0 * 1.8;
            let brightness_weight = if lum > 205 { 0.75 } else { 1.0 };
            hist[((r as usize >> 4) << 8) | ((g as usize >> 4) << 4) | (b as usize >> 4)] +=
                saturation_weight * brightness_weight;
        }
    }
    if considered == 0 {
        return FALLBACK;
    }
    let (peak_index, peak) = hist.iter().enumerate().fold(
        (None, 0.0),
        |best, (index, &count)| {
            if count > best.1 { (Some(index), count) } else { best }
        },
    );
    let bright_ratio = bright as f64 / considered as f64;
    let very_bright = bright_ratio > 0.55;
    let too_small = peak < (considered as f64 / 300.0).max(50.0);
    if (peak_index.is_none() || too_small) && very_bright {
        if colorful as f64 / considered as f64 >= 0.04 {
            let best = hist
                .iter()
                .enumerate()
                .filter(|&(index, &count)| count > 0.0 && !skin_like(bucket(index)))
                .map(|(index, &count)| (index, chroma(bucket(index)) as f64 * (1.0 + (1.0 + count).log10())))
                .fold(None::<(usize, f64)>, |best, item| if best.is_none_or(|best| item.1 > best.1) { Some(item) } else { best });
            if let Some((index, _)) = best {
                return bucket(index);
            }
        }
        return (208, 211, 216);
    }
    let mut best: Option<(usize, f64)> = None;
    for (index, &count) in hist.iter().enumerate().filter(|(_, count)| **count > 0.0) {
        let color = bucket(index);
        let (c, lum, h) = (chroma(color) as f64, lum255(color.0, color.1, color.2), hue(color));
        let chroma_boost = if very_bright { 1.0 + c / 62.0 } else { 1.0 + c / 105.0 };
        let vivid = if c > 110.0 {
            1.15
        } else if c > 80.0 {
            1.07
        } else {
            1.0
        };
        let light_penalty = if lum > 230 {
            0.70
        } else if lum > 215 {
            0.86
        } else {
            1.0
        };
        let dark_penalty = if lum < 22 {
            0.55
        } else if lum < 38 {
            0.80
        } else {
            1.0
        };
        let muddy = if c < 38.0 { 0.78 } else { 1.0 };
        let olive = if (50.0..=105.0).contains(&h) && c < 95.0 { if very_bright { 0.68 } else { 0.80 } } else { 1.0 };
        let dramatic = if (h <= 20.0 || h >= 320.0) && c > 55.0 { 1.12 } else { 1.0 };
        let score = count * chroma_boost * vivid * light_penalty * dark_penalty * muddy * olive * dramatic;
        if best.is_none_or(|best| score > best.1) {
            best = Some((index, score));
        }
    }
    let Some((index, _)) = best else { return FALLBACK };
    let mut color = bucket(index);
    if very_bright {
        color = saturate(color, 0.25);
    }
    if (50.0..=105.0).contains(&hue(color)) && chroma(color) < 95 {
        color = saturate(mix(color, (210, 170, 70), 0.30), 0.20);
    }
    if very_bright && chroma(color) > 80 {
        color = darken(color, 0.10);
    }
    if hue(color) <= 40.0 && chroma(color) > 60 {
        color = saturate(color, 0.10);
    }
    color
}

fn skin_like((r, g, b): Rgb) -> bool {
    skin_likely(r, g, b)
}

/// O ajuste de legibilidade do Helper (MakeAccentReadable): tira o amarelo-esverdeado sujo, dá vida às cores
/// apagadas, acalma o neon e escurece o que é claro demais para servir de destaque.
fn readable(accent: Rgb) -> Rgb {
    let mut color = accent;
    let lum = luminance(color);
    if (50.0..=105.0).contains(&hue(color)) && chroma(color) < 95 && lum > 0.35 {
        color = saturate(mix(color, (214, 184, 82), if lum > 0.55 { 0.30 } else { 0.18 }), if lum > 0.55 { 0.32 } else { 0.18 });
    }
    let (c, lum, h) = (chroma(color), luminance(color), hue(color));
    if c < 48 {
        color = saturate(
            color,
            if lum > 0.55 {
                0.60
            } else if lum > 0.32 {
                0.38
            } else {
                0.20
            },
        );
    } else if (h <= 20.0 || h >= 320.0) && c >= 70 {
        color = saturate(color, 0.10);
    } else if c > 160 && lum > 0.40 {
        let gray = clamp(luminance(color) * 255.0);
        color = mix(color, (gray, gray, gray), 0.06);
    }
    let lum = luminance(color);
    if lum > 0.80 {
        color = darken(color, 0.30);
    } else if lum > 0.70 {
        color = darken(color, 0.18);
    }
    color
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_folder;
    use image::{Rgba, RgbaImage};

    fn picture(fill: impl Fn(u32, u32) -> [u8; 3]) -> image::DynamicImage {
        let mut image = RgbaImage::new(200, 120);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            let [r, g, b] = fill(x, y);
            *pixel = Rgba([r, g, b, 255]);
        }
        image::DynamicImage::ImageRgba8(image)
    }

    #[test]
    fn acha_a_cor_viva_e_ignora_cinza_preto_e_as_bordas() {
        // Miolo azul vivo sobre cinza, com uma borda vermelha que fica fora da área contada.
        let color = dominant_vivid(&picture(|x, y| match (x, y) {
            (0..=10, _) => [230, 20, 20],
            (60..=140, 30..=90) => [40, 110, 240],
            _ => [90, 90, 90],
        }));
        assert!(color.2 > color.0 && color.2 > color.1, "{color:?}");
        assert_eq!(dominant_vivid(&picture(|_, _| [5, 5, 5])), FALLBACK);
        assert_eq!(dominant_vivid(&picture(|_, _| [120, 120, 120])), FALLBACK);
    }

    #[test]
    fn imagem_quase_branca_vira_cinza_claro_e_o_destaque_fica_legivel() {
        assert_eq!(dominant_vivid(&picture(|_, _| [250, 250, 250])), (208, 211, 216));
        // Claro demais escurece; apagado ganha saturação.
        assert!(luminance(readable((240, 240, 250))) < 0.80);
        assert!(chroma(readable((120, 110, 100))) > chroma((120, 110, 100)));
        assert_eq!(hex((214, 177, 111)), "#d6b16f");
    }

    #[test]
    fn le_o_fundo_ou_a_capa_do_jogo_e_guarda_o_resultado() {
        let db = crate::test_support::memory_database();
        db.execute("INSERT INTO games (title, status_id, added_at) VALUES ('Jogo', 1, '2026-01-01')", []).unwrap();
        let id = db.last_insert_rowid();
        let images = temp_folder("cor-dinamica");
        assert_eq!(game_accent(&db, &images, id).unwrap(), None);
        std::fs::create_dir_all(images.join(id.to_string())).unwrap();
        picture(|_, _| [200, 40, 60]).save(images.join(id.to_string()).join("cover.png")).unwrap();
        db.execute("UPDATE games SET cover_image = 'cover.png', background_image = 'falta.png' WHERE id = ?1", [id]).unwrap();
        let accent = game_accent(&db, &images, id).unwrap().unwrap();
        assert!(accent.starts_with('#') && accent.len() == 7);
        assert_eq!(game_accent(&db, &images, id).unwrap().unwrap(), accent);
        assert_eq!(game_accent(&db, &images, 999).unwrap(), None);
    }
}
