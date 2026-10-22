//! Qual console e qual jogo do RetroAchievements corresponde a um jogo da biblioteca. O console vem do
//! nome (o RetroAchievements usa "SNES/Super Famicom", "Genesis/Mega Drive"...), e o jogo, do nome no
//! catálogo do console, com a regra de os números da série terem que bater.

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::RegexBuilder;

use super::client::{RaCatalogGame, RaConsole};
use crate::metadata::matching::{comparable_name, search_term_for};

/// Outros nomes de cada console, para achar o do RetroAchievements (tudo em minúsculas).
const PLATFORM_ALIASES: [(&str, &[&str]); 12] = [
    ("super nintendo", &["snes", "super famicom"]),
    ("snes", &["super famicom"]),
    ("nes", &["famicom"]),
    ("mega drive", &["genesis"]),
    ("genesis", &["mega drive"]),
    ("psp", &["playstation portable"]),
    ("ps1", &["playstation"]),
    ("ps2", &["playstation 2"]),
    ("gba", &["game boy advance"]),
    ("nds", &["nintendo ds"]),
    ("gc", &["gamecube"]),
    ("ngc", &["gamecube"]),
];

/// O id do console no RetroAchievements para o console do jogo, ou None se lá não houver (ex.: PS3).
pub fn console_id_for(platform: Option<&str>, consoles: &[RaConsole]) -> Option<i64> {
    let wanted = comparable_name(platform?);
    let mut names: HashSet<String> = HashSet::from([wanted.clone()]);
    if let Some((_, aliases)) = PLATFORM_ALIASES.iter().find(|(name, _)| *name == wanted) {
        names.extend(aliases.iter().map(|alias| alias.to_string()));
    }
    consoles
        .iter()
        .find(|console| {
            std::iter::once(console.name.as_str())
                .chain(console.name.split('/'))
                .map(comparable_name)
                .any(|part| names.contains(&part))
        })
        .map(|console| console.id)
}

/// As palavras de um nome, sem "the" (o RetroAchievements escreve "Legend of Zelda, The").
fn words_of(title: &str) -> Vec<String> {
    comparable_name(title).split(' ').filter(|word| !word.is_empty() && *word != "the").map(str::to_string).collect()
}

/// Os números do nome ("Tekken 3", "Lenda Sombria VII" → "3", "7"), para não trocar um jogo pela sequência.
fn numbers_of(words: &[String]) -> String {
    const ROMAN: [(&str, &str); 9] =
        [("ii", "2"), ("iii", "3"), ("iv", "4"), ("v", "5"), ("vi", "6"), ("vii", "7"), ("viii", "8"), ("ix", "9"), ("x", "10")];
    let mut numbers: Vec<String> = words
        .iter()
        .filter_map(|word| {
            if word.chars().all(|character| character.is_ascii_digit()) {
                Some(word.trim_start_matches('0').to_string()).map(|number| if number.is_empty() { "0".into() } else { number })
            } else {
                ROMAN.iter().find(|(roman, _)| roman == word).map(|(_, number)| number.to_string())
            }
        })
        .collect();
    numbers.sort();
    numbers.join(",")
}

/// Quanto um nome do catálogo parece com o do jogo: 3 = igual; 2 = um tem todas as palavras do outro (ex.:
/// com subtítulo) e os mesmos números; 0 = outro jogo.
pub fn ra_match_score(title: &str, candidate: &str) -> u8 {
    let a = words_of(&search_term_for(title));
    let b = words_of(candidate);
    if a.is_empty() || b.is_empty() {
        return 0;
    }
    if a == b {
        return 3;
    }
    if numbers_of(&a) != numbers_of(&b) {
        return 0;
    }
    let (shorter, longer) = if a.len() <= b.len() { (&a, &b) } else { (&b, &a) };
    let set: HashSet<&String> = longer.iter().collect();
    if shorter.iter().all(|word| set.contains(word)) { 2 } else { 0 }
}

/// O jogo do catálogo que corresponde ao da biblioteca, ou None. Ficam de fora os hacks, os jogos caseiros
/// e afins ("~Hack~ ...") e os "subsets" (conquistas extras de um jogo). Nomes com alternativas ("A | B")
/// valem por qualquer uma delas.
pub fn match_ra_game<'a>(title: &str, catalog: &'a [RaCatalogGame]) -> Option<&'a RaCatalogGame> {
    static SUBSET: LazyLock<regex::Regex> =
        LazyLock::new(|| RegexBuilder::new(r"\[subset").case_insensitive(true).build().expect("expressão fixa"));
    let mut best = None;
    let mut best_score = 1;
    for game in catalog {
        if game.num_achievements <= 0 || game.title.starts_with('~') || SUBSET.is_match(&game.title) {
            continue;
        }
        let score = game.title.split('|').map(|name| ra_match_score(title, name)).max().unwrap_or(0);
        if score > best_score {
            best = Some(game);
            best_score = score;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    fn consoles() -> Vec<RaConsole> {
        [(1, "Genesis/Mega Drive"), (3, "SNES/Super Famicom"), (12, "PlayStation"), (21, "PlayStation 2")]
            .into_iter()
            .map(|(id, name)| RaConsole { id, name: name.into() })
            .collect()
    }

    #[test]
    fn pelo_nome_do_console_com_os_apelidos() {
        assert_eq!(console_id_for(Some("PlayStation 2"), &consoles()), Some(21));
        assert_eq!(console_id_for(Some("PlayStation"), &consoles()), Some(12));
        assert_eq!(console_id_for(Some("Mega Drive"), &consoles()), Some(1));
        assert_eq!(console_id_for(Some("Super Nintendo"), &consoles()), Some(3));
        // O PS3 não tem conquistas no RetroAchievements.
        assert_eq!(console_id_for(Some("PlayStation 3"), &consoles()), None);
        assert_eq!(console_id_for(None, &consoles()), None);
    }

    #[test]
    fn o_numero_da_serie_tem_que_bater() {
        assert_eq!(ra_match_score("Tekken 3", "Tekken 3"), 3);
        assert_eq!(ra_match_score("Tekken 3", "Tekken 2"), 0);
        assert_eq!(ra_match_score("Lenda Sombria VII (Disc 1)", "Lenda Sombria VII"), 3);
        assert_eq!(ra_match_score("Corrida Noturna - Edição Turbo", "Corrida Noturna: Edição Turbo"), 3);
        assert_eq!(ra_match_score("Legend of Zelda - A Link to the Past", "Legend of Zelda, The: A Link to the Past"), 3);
        assert_eq!(ra_match_score("Castelo Sombrio", "Castelo Sombrio: Sinfonia da Noite"), 2);
    }

    #[test]
    fn fora_hacks_jogos_caseiros_e_subsets_e_nomes_com_alternativas_valem() {
        let catalog: Vec<RaCatalogGame> = [
            (10, "~Hack~ Salto Estelar Turbo", 20),
            (11, "Salto Estelar [Subset - Bônus]", 5),
            (12, "Salto Estelar | Star Jump", 40),
            (13, "Salto Estelar 2", 30),
        ]
        .into_iter()
        .map(|(id, title, num_achievements)| RaCatalogGame { id, title: title.into(), num_achievements })
        .collect();
        assert_eq!(match_ra_game("Salto Estelar", &catalog).map(|game| game.id), Some(12));
        assert_eq!(match_ra_game("Star Jump", &catalog).map(|game| game.id), Some(12));
        assert_eq!(match_ra_game("Jogo Que Não Existe", &catalog), None);
    }
}
