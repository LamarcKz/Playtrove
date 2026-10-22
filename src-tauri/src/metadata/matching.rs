//! A escolha do resultado certo nas buscas dos serviços de metadados.

use std::cmp::Ordering;
use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;
use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;

/// Algo com nome, para comparar com o jogo procurado.
pub trait Named {
    fn name(&self) -> &str;
}

/// Texto de busca a partir do nome do jogo na biblioteca: sem o número do disco e sem o " - " que os
/// nomes de ROM usam no lugar dos dois-pontos. Ex.: "Corrida Noturna - Edição Turbo" → "Corrida Noturna
/// Edição Turbo".
pub fn search_term_for(title: &str) -> String {
    static DISC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\s*\(disc \d+\)").expect("expressão fixa"));
    static DASH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+-\s+").expect("expressão fixa"));
    let without_disc = DISC.replace_all(title, "");
    let without_dash = DASH.replace_all(&without_disc, " ");
    without_dash.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Nome para comparar: sem acentos, em minúsculas e só com letras e números ("Pokémon: Fire" →
/// "pokemon fire").
pub fn comparable_name(name: &str) -> String {
    let plain: String =
        name.nfd().filter(|character| !is_combining_mark(*character)).collect::<String>().to_lowercase().replace('&', " and ");
    plain
        .split(|character: char| !(character.is_ascii_lowercase() || character.is_ascii_digit()))
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Quanto um resultado da busca parece com o jogo procurado: 3 = mesmo nome; 2 = um nome contém todas
/// as palavras do outro (ex.: com subtítulo); 1 = pelo menos metade das palavras em comum; 0 = outro jogo.
pub fn match_score(term: &str, candidate: &str) -> u8 {
    let a = comparable_name(term);
    let b = comparable_name(candidate);
    if a.is_empty() || b.is_empty() {
        return 0;
    }
    if a == b {
        return 3;
    }
    let words_a: HashSet<&str> = a.split(' ').collect();
    let words_b: HashSet<&str> = b.split(' ').collect();
    let common = words_a.intersection(&words_b).count();
    if common == words_a.len() || common == words_b.len() {
        return 2;
    }
    if common as f64 / words_a.len() as f64 >= 0.5 { 1 } else { 0 }
}

/// O resultado mais parecido com o jogo procurado. Empate fica com o que `prefer` escolher (Less: o
/// novo) ou, sem ele, com o que veio antes (os serviços já devolvem os mais relevantes primeiro). Se
/// nenhum parecer o mesmo jogo, devolve None.
pub fn pick_best_match<T: Named>(term: &str, results: Vec<T>, prefer: Option<fn(&T, &T) -> Ordering>) -> Option<T> {
    let mut best: Option<(T, u8)> = None;
    for result in results {
        let score = match_score(term, result.name());
        let better = match &best {
            None => score > 0,
            Some((current, best_score)) => {
                score > *best_score
                    || (score == *best_score && prefer.is_some_and(|prefer| prefer(&result, current) == Ordering::Less))
            }
        };
        if better {
            best = Some((result, score));
        }
    }
    best.map(|(result, _)| result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq)]
    struct Result(&'static str);

    impl Named for Result {
        fn name(&self) -> &str {
            self.0
        }
    }

    #[test]
    fn tira_o_disco_e_o_traco_dos_nomes_de_rom() {
        assert_eq!(search_term_for("Corrida Noturna - Edição Turbo"), "Corrida Noturna Edição Turbo");
        assert_eq!(search_term_for("Lenda Sombria VII (Disc 2)"), "Lenda Sombria VII");
        assert_eq!(comparable_name("Pokémon: FireRed & LeafGreen!"), "pokemon firered and leafgreen");
    }

    #[test]
    fn compara_nomes_igual_com_subtitulo_parecido_ou_outro_jogo() {
        assert_eq!(match_score("Pokemon FireRed Version", "Pokémon FireRed Version"), 3);
        assert_eq!(match_score("Corrida Noturna Edição Turbo", "Corrida Noturna: Edição Turbo"), 3);
        assert_eq!(match_score("Pista Real 4", "Pista Real 4: The Real Driving Simulator"), 2);
        assert_eq!(match_score("Lenda Sombria 7", "Lenda Sombria VII"), 1);
        assert_eq!(match_score("Meu Jogo Caseiro", "Minecraft"), 0);
    }

    #[test]
    fn escolhe_o_mais_parecido_ou_nenhum() {
        let results = vec![Result("Salto Estelar: Renegado"), Result("Salto Estelar"), Result("Salto Estelar 3")];
        assert_eq!(pick_best_match("Salto Estelar", results, None), Some(Result("Salto Estelar")));
        assert_eq!(pick_best_match("Salto Estelar", vec![Result("Ratchet & Clank")], None), None);
    }
}
