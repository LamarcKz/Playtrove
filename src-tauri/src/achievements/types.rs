//! Os tipos que as telas recebem (os mesmos de src/shared/achievements.ts), o tipo de troféu e a raridade.

use serde::{Deserialize, Serialize};

/// De onde vêm as conquistas de um jogo: o RetroAchievements (pela internet) ou o RPCS3 (troféus do PS3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AchievementSource {
    Retroachievements,
    Rpcs3,
}

/// Raridade de uma conquista, pela porcentagem de jogadores do RetroAchievements que a desbloquearam.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Rarity {
    #[serde(rename = "comum")]
    Common,
    #[serde(rename = "rara")]
    Rare,
    #[serde(rename = "muito-rara")]
    VeryRare,
    #[serde(rename = "ultrarrara")]
    UltraRare,
}

/// A raridade pela porcentagem (0 a 100), nas faixas da PlayStation: comum com 50% ou mais, rara de 15 a
/// 50%, muito rara de 5 a 15% e ultrarrara abaixo de 5%.
pub fn rarity_of(percent: f64) -> Rarity {
    if percent >= 50.0 {
        Rarity::Common
    } else if percent >= 15.0 {
        Rarity::Rare
    } else if percent >= 5.0 {
        Rarity::VeryRare
    } else {
        Rarity::UltraRare
    }
}

/// O tipo de um troféu do PS3 (o nome na tela fica no dicionário: achievements.grades).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrophyGrade {
    Platina,
    Ouro,
    Prata,
    Bronze,
}

impl TrophyGrade {
    /// Como fica guardado no banco (a coluna grade dos troféus).
    pub fn id(self) -> &'static str {
        match self {
            TrophyGrade::Platina => "platina",
            TrophyGrade::Ouro => "ouro",
            TrophyGrade::Prata => "prata",
            TrophyGrade::Bronze => "bronze",
        }
    }

    pub fn from_id(id: &str) -> Option<TrophyGrade> {
        [TrophyGrade::Platina, TrophyGrade::Ouro, TrophyGrade::Prata, TrophyGrade::Bronze]
            .into_iter()
            .find(|grade| grade.id() == id)
    }
}

/// O tipo de uma conquista do RetroAchievements, que não tem bronze, prata e ouro: pelos pontos, que lá
/// dizem a dificuldade (escolha do usuário em 2026-09-24). Bronze até 9, prata de 10 a 24, ouro com 25 ou
/// mais. A platina é ter todas as conquistas do jogo.
pub fn grade_for_points(points: i64) -> TrophyGrade {
    if points >= 25 {
        TrophyGrade::Ouro
    } else if points >= 10 {
        TrophyGrade::Prata
    } else {
        TrophyGrade::Bronze
    }
}

/// O progresso de um jogo nas conquistas, como a biblioteca mostra (lista, grade e colunas).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementProgress {
    pub unlocked: i64,
    pub total: i64,
    /// A platina: no RetroAchievements, todas desbloqueadas; no PS3, o troféu de platina.
    pub platinum: bool,
    pub source: AchievementSource,
}

/// Uma conquista (ou troféu) de um jogo, com o que o usuário já fez.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameAchievement {
    /// Identifica a conquista na tela (o id sozinho se repete entre os jogos de PS3).
    pub key: String,
    pub source: AchievementSource,
    pub id: i64,
    pub title: String,
    pub description: String,
    /// Pontos do RetroAchievements (os troféus do PS3 não têm).
    pub points: Option<i64>,
    /// A insígnia (colorida se desbloqueada, apagada se não), ou None se ainda não há imagem.
    pub badge_url: Option<String>,
    /// Porcentagem de jogadores do RetroAchievements que desbloquearam (0 a 100); None nos troféus.
    pub percent: Option<f64>,
    pub rarity: Option<Rarity>,
    pub grade: TrophyGrade,
    /// Troféu oculto: o nome e a descrição só aparecem depois de pegar (ou com "Mostrar ocultos").
    pub hidden: bool,
    /// O pacote extra (DLC) do troféu, ou None se for do jogo principal.
    pub group: Option<String>,
    /// Quando o usuário desbloqueou (ISO), ou None.
    pub earned_at: Option<String>,
    /// Desbloqueada no modo hardcore do RetroAchievements (sem estados salvos).
    pub hardcore: bool,
}

/// Quantos troféus de um tipo o jogo tem e quantos já foram pegos.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct GradeCount {
    pub unlocked: i64,
    pub total: i64,
}

/// Os troféus de cada tipo.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct ByGrade {
    pub platina: GradeCount,
    pub ouro: GradeCount,
    pub prata: GradeCount,
    pub bronze: GradeCount,
}

impl ByGrade {
    fn count(&mut self, grade: TrophyGrade) -> &mut GradeCount {
        match grade {
            TrophyGrade::Platina => &mut self.platina,
            TrophyGrade::Ouro => &mut self.ouro,
            TrophyGrade::Prata => &mut self.prata,
            TrophyGrade::Bronze => &mut self.bronze,
        }
    }
}

/// Quantos troféus de cada tipo o jogo tem e quantos já foram pegos (`items`: tipo e se foi pego). Com
/// `platinum_when_complete`, a platina é uma só e vale quando todas foram pegas (o RetroAchievements não
/// tem troféu de platina).
pub fn count_grades(items: &[(TrophyGrade, bool)], platinum_when_complete: bool) -> ByGrade {
    let mut counts = ByGrade::default();
    for (grade, earned) in items {
        let count = counts.count(*grade);
        count.total += 1;
        if *earned {
            count.unlocked += 1;
        }
    }
    if platinum_when_complete && !items.is_empty() {
        counts.platina = GradeCount { unlocked: i64::from(items.iter().all(|(_, earned)| *earned)), total: 1 };
    }
    counts
}

/// As conquistas de um jogo da biblioteca (o cartão dos detalhes e a janela "Ver todas").
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameAchievements {
    pub game_id: i64,
    pub source: AchievementSource,
    /// O nome do jogo no RetroAchievements ou no conjunto de troféus.
    pub source_title: String,
    pub unlocked: i64,
    pub total: i64,
    /// Pontos do RetroAchievements (None nos troféus do PS3).
    pub points: Option<i64>,
    pub total_points: Option<i64>,
    pub platinum: bool,
    pub by_grade: ByGrade,
    /// Na ordem do RetroAchievements ou do jogo.
    pub achievements: Vec<GameAchievement>,
}

/// Uma conquista desbloqueada, com o jogo (a lista de recentes da aba e os avisos).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockedAchievement {
    #[serde(flatten)]
    pub achievement: GameAchievement,
    pub game_id: i64,
    pub game_title: String,
}

/// Uma linha da lista de jogos da aba Conquistas.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementGameRow {
    #[serde(flatten)]
    pub progress: AchievementProgress,
    pub game_id: i64,
    pub title: String,
    /// Pontos do RetroAchievements (None nos troféus do PS3).
    pub points: Option<i64>,
    pub last_unlocked_at: Option<String>,
    pub by_grade: ByGrade,
}

/// Desbloqueadas num dia (AAAA-MM-DD).
#[derive(Debug, PartialEq, Serialize)]
pub struct DayCount {
    pub date: String,
    pub count: i64,
}

/// Desbloqueadas num mês (AAAA-MM).
#[derive(Debug, PartialEq, Serialize)]
pub struct MonthCount {
    pub month: String,
    pub count: i64,
}

/// Tudo o que a aba Conquistas mostra (as conquistas do RetroAchievements e os troféus do PS3 juntos).
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementsOverview {
    pub unlocked: i64,
    pub total: i64,
    /// Pontos do RetroAchievements.
    pub points: i64,
    pub platinums: i64,
    pub games: Vec<AchievementGameRow>,
    /// As últimas desbloqueadas, da mais nova para a mais antiga.
    pub recent: Vec<UnlockedAchievement>,
    /// Desbloqueadas por dia, nos últimos 30 dias (do mais antigo para hoje).
    pub by_day: Vec<DayCount>,
    /// Desbloqueadas por mês, nos últimos 12 meses.
    pub by_month: Vec<MonthCount>,
    /// Todas as desbloqueadas, por raridade (as sem raridade, como os troféus do PS3, contam como comuns:
    /// é a regra da pontuação de colecionador da tela cheia).
    pub by_rarity: RarityCounts,
    /// As desbloqueadas mais raras (com porcentagem), da mais rara para a menos rara.
    pub rarest: Vec<UnlockedAchievement>,
}

/// Quantas desbloqueadas há de cada raridade.
#[derive(Debug, Default, PartialEq, Serialize)]
pub struct RarityCounts {
    #[serde(rename = "comum")]
    pub common: i64,
    #[serde(rename = "rara")]
    pub rare: i64,
    #[serde(rename = "muito-rara")]
    pub very_rare: i64,
    #[serde(rename = "ultrarrara")]
    pub ultra_rare: i64,
}

/// A conta do RetroAchievements e a situação da atualização (Configurações e aba Conquistas).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementsConfig {
    /// Nome de usuário salvo, ou None sem conta. A chave nunca volta para a interface.
    pub username: Option<String>,
    pub syncing: bool,
    pub last_sync_at: Option<String>,
    /// O motivo da última atualização ter falhado (ex.: chave recusada), ou None.
    pub last_error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raridade_pelas_faixas_de_porcentagem_de_jogadores() {
        assert_eq!(rarity_of(96.0), Rarity::Common);
        assert_eq!(rarity_of(50.0), Rarity::Common);
        assert_eq!(rarity_of(30.0), Rarity::Rare);
        assert_eq!(rarity_of(15.0), Rarity::Rare);
        assert_eq!(rarity_of(7.0), Rarity::VeryRare);
        assert_eq!(rarity_of(2.0), Rarity::UltraRare);
    }

    #[test]
    fn o_tipo_das_conquistas_vem_dos_pontos() {
        let grades: Vec<TrophyGrade> = [1, 9, 10, 24, 25, 50].into_iter().map(grade_for_points).collect();
        assert_eq!(
            grades,
            [
                TrophyGrade::Bronze,
                TrophyGrade::Bronze,
                TrophyGrade::Prata,
                TrophyGrade::Prata,
                TrophyGrade::Ouro,
                TrophyGrade::Ouro
            ]
        );
    }

    #[test]
    fn a_tela_recebe_os_nomes_de_sempre() {
        assert_eq!(serde_json::to_string(&Rarity::VeryRare).unwrap(), "\"muito-rara\"");
        assert_eq!(serde_json::to_string(&TrophyGrade::Platina).unwrap(), "\"platina\"");
        assert_eq!(serde_json::to_string(&AchievementSource::Retroachievements).unwrap(), "\"retroachievements\"");
        let counts = count_grades(&[(TrophyGrade::Prata, true), (TrophyGrade::Bronze, false)], true);
        assert_eq!(counts.platina, GradeCount { unlocked: 0, total: 1 });
        let json = serde_json::to_value(counts).unwrap();
        assert_eq!(json["prata"]["unlocked"], 1);
    }
}
