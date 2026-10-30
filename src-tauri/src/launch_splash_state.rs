//! Tempos e identidade do splash de lançamento, sem Windows, Tauri nem relógio real.

pub const DEFAULT_MINIMUM_MS: u64 = 2400;
pub const DEFAULT_MAXIMUM_WAIT_MS: u64 = 90000;
pub const FAILURE_SAFETY_MS: u64 = 15000;
pub const EXIT_FADE_MS: u64 = 420;
const SAMPLE_MS: u64 = 500;
const STABLE_CHECKS: u8 = 3;
const HARD_SAFETY_EXTRA_MS: u64 = 2000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReadyIdentity {
    pub process_id: u32,
    pub window_id: usize,
}

#[derive(Clone, Copy)]
pub struct ReadyWindowFacts {
    pub visible: bool,
    pub minimized: bool,
    pub hung: bool,
    pub width: i32,
    pub height: i32,
    pub coverage: f64,
    pub foreground: bool,
    pub has_title: bool,
    pub splash_like: bool,
    pub splash_sibling: bool,
    pub ignored_title: bool,
}

impl ReadyWindowFacts {
    pub fn is_ready(&self) -> bool {
        self.visible
            && !self.minimized
            && !self.hung
            && self.width >= 320
            && self.height >= 180
            && self.coverage.is_finite()
            && self.coverage >= 0.1
            && !self.splash_sibling
            && !self.ignored_title
            && (self.coverage >= 0.5 || (self.foreground && self.has_title && !self.splash_like))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Launching,
    Waiting,
    Closing,
    Hidden,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloseReason {
    Ready,
    Timeout,
    LaunchFailed,
    ProcessExited,
}

pub struct SplashTimeline {
    token: u64,
    phase: Phase,
    created_at: u64,
    rendered_at: Option<u64>,
    started_at: Option<u64>,
    hard_deadline: Option<u64>,
    minimum_ms: u64,
    maximum_wait_ms: u64,
    candidate: Option<ReadyIdentity>,
    next_sample: Option<u64>,
    stable_checks: u8,
    closing_at: Option<u64>,
    reason: Option<CloseReason>,
}

impl SplashTimeline {
    pub fn new(token: u64, now: u64, minimum_ms: u64, maximum_wait_ms: u64) -> Self {
        Self {
            token,
            phase: Phase::Launching,
            created_at: now,
            rendered_at: None,
            started_at: None,
            hard_deadline: None,
            minimum_ms: minimum_ms.clamp(500, 600000),
            maximum_wait_ms: maximum_wait_ms.clamp(1000, 120000),
            candidate: None,
            next_sample: None,
            stable_checks: 0,
            closing_at: None,
            reason: None,
        }
    }

    pub fn token(&self) -> u64 {
        self.token
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn reason(&self) -> Option<CloseReason> {
        self.reason
    }

    pub fn rendered(&mut self, token: u64, now: u64) -> bool {
        if self.token != token || self.rendered_at.is_some() || matches!(self.phase, Phase::Closing | Phase::Hidden) {
            return false;
        }
        self.rendered_at = Some(now);
        self.candidate = None;
        self.next_sample = None;
        self.stable_checks = 0;
        true
    }

    pub fn started(&mut self, token: u64, now: u64) -> bool {
        if self.token != token || self.phase != Phase::Launching {
            return false;
        }
        self.started_at = Some(now);
        self.phase = Phase::Waiting;
        self.hard_deadline =
            Some(self.minimum_deadline().saturating_add(self.maximum_wait_ms).saturating_add(HARD_SAFETY_EXTRA_MS));
        true
    }

    pub fn failed(&mut self, token: u64, now: u64) -> bool {
        if self.token != token || matches!(self.phase, Phase::Closing | Phase::Hidden) {
            return false;
        }
        self.close(CloseReason::LaunchFailed, now);
        true
    }

    fn minimum_deadline(&self) -> u64 {
        self.rendered_at.or(self.started_at).unwrap_or(self.created_at).saturating_add(self.minimum_ms)
    }

    fn close(&mut self, reason: CloseReason, now: u64) {
        self.phase = Phase::Closing;
        self.closing_at = Some(now);
        self.reason = Some(reason);
        self.candidate = None;
        self.next_sample = None;
    }

    pub fn tick(&mut self, now: u64, process_alive: Option<bool>, candidate: Option<ReadyIdentity>) {
        match self.phase {
            Phase::Hidden => return,
            Phase::Closing => {
                if self.closing_at.is_some_and(|at| now >= at.saturating_add(EXIT_FADE_MS)) {
                    self.phase = Phase::Hidden;
                }
                return;
            }
            Phase::Launching => {
                if now >= self.created_at.saturating_add(FAILURE_SAFETY_MS) {
                    self.close(CloseReason::LaunchFailed, now);
                }
                return;
            }
            Phase::Waiting => {}
        }
        if process_alive == Some(false) {
            self.close(CloseReason::ProcessExited, now);
            return;
        }
        if now >= self.minimum_deadline().saturating_add(self.maximum_wait_ms)
            || self.hard_deadline.is_some_and(|deadline| now >= deadline)
        {
            self.close(CloseReason::Timeout, now);
            return;
        }
        if self.rendered_at.is_none() || now < self.minimum_deadline() {
            return;
        }
        let candidate = (process_alive == Some(true)).then_some(candidate).flatten();
        if candidate.is_none() || candidate != self.candidate {
            self.candidate = candidate;
            self.stable_checks = 0;
            self.next_sample = candidate.map(|_| now.saturating_add(SAMPLE_MS));
            return;
        }
        if self.next_sample.is_some_and(|deadline| now >= deadline) {
            self.stable_checks += 1;
            self.next_sample = Some(now.saturating_add(SAMPLE_MS));
            if self.stable_checks >= STABLE_CHECKS {
                self.close(CloseReason::Ready, now);
            }
        }
    }

    /// Bloqueia entre consultas. Encerrado não exige nenhum timer; estabilidade exige amostras reais.
    pub fn wake_after(&self, now: u64) -> Option<u64> {
        let deadline = match self.phase {
            Phase::Hidden => return None,
            Phase::Launching => self.created_at.saturating_add(FAILURE_SAFETY_MS),
            Phase::Closing => self.closing_at.unwrap_or(now).saturating_add(EXIT_FADE_MS),
            Phase::Waiting => {
                let minimum = self.minimum_deadline();
                if now < minimum {
                    minimum
                } else {
                    self.next_sample.unwrap_or_else(|| minimum.saturating_add(self.maximum_wait_ms))
                }
            }
        };
        Some(deadline.saturating_sub(now).clamp(1, 200))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready(window_id: usize) -> ReadyIdentity {
        ReadyIdentity { process_id: 42, window_id }
    }

    fn started() -> SplashTimeline {
        let mut state = SplashTimeline::new(1, 0, 2400, 90000);
        assert!(state.rendered(1, 0));
        assert!(state.started(1, 0));
        state
    }

    #[test]
    fn minimo_e_tres_verificacoes_da_mesma_janela_antes_do_fade() {
        let mut state = started();
        for now in [0, 500, 1000, 2399, 2400, 2899, 2900, 3400, 3899] {
            state.tick(now, Some(true), Some(ready(10)));
            assert_eq!(state.phase(), Phase::Waiting, "{now}");
        }
        state.tick(3900, Some(true), Some(ready(10)));
        assert_eq!(state.phase(), Phase::Closing);
        assert_eq!(state.reason(), Some(CloseReason::Ready));
        state.tick(4319, Some(true), None);
        assert_eq!(state.phase(), Phase::Closing);
        state.tick(4320, Some(true), None);
        assert_eq!(state.phase(), Phase::Hidden);
    }

    #[test]
    fn mudanca_ou_desaparecimento_do_hwnd_reinicia_estabilidade() {
        let mut state = started();
        state.tick(2400, Some(true), Some(ready(10)));
        state.tick(2900, Some(true), Some(ready(10)));
        state.tick(3400, Some(true), Some(ready(20)));
        state.tick(3900, Some(true), None);
        for now in [4000, 4500, 5000] {
            state.tick(now, Some(true), Some(ready(20)));
            assert_eq!(state.phase(), Phase::Waiting);
        }
        state.tick(5500, Some(true), Some(ready(20)));
        assert_eq!(state.reason(), Some(CloseReason::Ready));
    }

    #[test]
    fn processo_original_encerrado_nao_aceita_pid_reutilizado() {
        let mut state = started();
        state.tick(2400, Some(true), Some(ready(10)));
        state.tick(2900, Some(false), Some(ready(10)));
        assert_eq!(state.reason(), Some(CloseReason::ProcessExited));
    }

    #[test]
    fn candidato_sem_processo_vivo_validado_nunca_confirma() {
        let mut state = started();
        for now in [2400, 2900, 3400, 3900] {
            state.tick(now, None, Some(ready(10)));
        }
        assert_eq!(state.phase(), Phase::Waiting);
    }

    #[test]
    fn falha_de_lancamento_tem_seguranca_independente_de_quinze_segundos() {
        let mut state = SplashTimeline::new(1, 0, 600000, 120000);
        state.tick(14999, None, None);
        assert_eq!(state.phase(), Phase::Launching);
        state.tick(15000, None, None);
        assert_eq!(state.reason(), Some(CloseReason::LaunchFailed));
    }

    #[test]
    fn prazo_maximo_real_conta_depois_do_minimo() {
        let mut state = started();
        state.tick(92399, Some(true), None);
        assert_eq!(state.phase(), Phase::Waiting);
        state.tick(92400, Some(true), None);
        assert_eq!(state.reason(), Some(CloseReason::Timeout));
    }

    #[test]
    fn renderizacao_tardia_e_primeiro_inicio_nao_sao_sobrescritos() {
        let mut state = SplashTimeline::new(3, 0, 2400, 90000);
        assert!(state.started(3, 100));
        assert!(state.rendered(3, 1000));
        assert!(!state.rendered(3, 3000));
        assert!(!state.started(3, 14000));
        state.tick(3399, Some(true), Some(ready(10)));
        state.tick(3400, Some(true), Some(ready(10)));
        state.tick(3900, Some(true), Some(ready(10)));
        state.tick(4400, Some(true), Some(ready(10)));
        state.tick(4900, Some(true), Some(ready(10)));
        assert_eq!(state.reason(), Some(CloseReason::Ready));
    }

    #[test]
    fn tokens_antigos_nao_alteram_lancamento_novo() {
        let mut state = SplashTimeline::new(2, 0, 2400, 90000);
        assert!(!state.rendered(1, 100));
        assert!(!state.started(1, 100));
        assert!(!state.failed(1, 100));
        assert_eq!(state.phase(), Phase::Launching);
        assert!(state.failed(2, 100));
        assert_eq!(state.reason(), Some(CloseReason::LaunchFailed));
    }

    #[test]
    fn valores_sao_limitados_e_acordar_nao_exige_loop_ocupado() {
        let mut state = SplashTimeline::new(1, 0, 0, u64::MAX);
        state.rendered(1, 0);
        state.started(1, 0);
        state.tick(500, Some(true), Some(ready(10)));
        assert_eq!(state.wake_after(500), Some(200));
        state.tick(120500, Some(true), None);
        assert_eq!(state.reason(), Some(CloseReason::Timeout));
        state.tick(120920, Some(true), None);
        assert_eq!(state.wake_after(120920), None);
    }

    #[test]
    fn falha_explicita_fecha_sem_esperar_minimo_e_encerrar_e_idempotente() {
        let mut state = started();
        assert!(state.failed(1, 100));
        assert!(!state.failed(1, 300));
        state.tick(520, None, None);
        assert_eq!(state.phase(), Phase::Hidden);
        assert!(!state.started(1, 600));
        assert!(!state.rendered(1, 600));
    }

    fn window() -> ReadyWindowFacts {
        ReadyWindowFacts {
            visible: true,
            minimized: false,
            hung: false,
            width: 1280,
            height: 720,
            coverage: 0.7,
            foreground: false,
            has_title: true,
            splash_like: false,
            splash_sibling: false,
            ignored_title: false,
        }
    }

    #[test]
    fn readiness_descarta_janelas_inuteis_e_splashs_do_mesmo_processo() {
        assert!(window().is_ready());
        for facts in [
            ReadyWindowFacts { visible: false, ..window() },
            ReadyWindowFacts { minimized: true, ..window() },
            ReadyWindowFacts { hung: true, ..window() },
            ReadyWindowFacts { width: 319, ..window() },
            ReadyWindowFacts { height: 179, ..window() },
            ReadyWindowFacts { coverage: 0.09, ..window() },
            ReadyWindowFacts { coverage: f64::NAN, ..window() },
            ReadyWindowFacts { splash_like: true, coverage: 0.4, foreground: true, ..window() },
            ReadyWindowFacts { splash_sibling: true, ..window() },
            ReadyWindowFacts { ignored_title: true, ..window() },
        ] {
            assert!(!facts.is_ready());
        }
    }

    #[test]
    fn janela_pequena_precisa_titulo_e_foco_do_proprio_alvo() {
        let small = ReadyWindowFacts { coverage: 0.1, foreground: true, ..window() };
        assert!(small.is_ready());
        assert!(!ReadyWindowFacts { foreground: false, ..small }.is_ready());
        assert!(!ReadyWindowFacts { has_title: false, ..small }.is_ready());
        // A fonte só aplica o nome "splash" à janela pequena: um título de jogo pode conter a palavra.
        assert!(ReadyWindowFacts { splash_like: true, ..window() }.is_ready());
    }

    #[test]
    fn ack_tardio_exige_tres_novas_amostras_apos_o_quadro_minimo() {
        let mut state = SplashTimeline::new(1, 0, 2400, 90000);
        state.started(1, 0);
        state.tick(2400, Some(true), Some(ready(10)));
        state.tick(2900, Some(true), Some(ready(10)));
        state.rendered(1, 3000);
        for now in [5400, 5900, 6400] {
            state.tick(now, Some(true), Some(ready(10)));
            assert_eq!(state.phase(), Phase::Waiting);
        }
        state.tick(6900, Some(true), Some(ready(10)));
        assert_eq!(state.reason(), Some(CloseReason::Ready));
    }

    #[test]
    fn renderer_ainda_nao_apresentado_nao_fecha_por_readiness_mas_tem_failsafe() {
        let mut state = SplashTimeline::new(1, 0, 2400, 90000);
        state.started(1, 0);
        for now in [2400, 2900, 3400, 3900] {
            state.tick(now, Some(true), Some(ready(10)));
        }
        assert_eq!(state.phase(), Phase::Waiting);
        state.tick(94400, Some(true), Some(ready(10)));
        assert_eq!(state.reason(), Some(CloseReason::Timeout));
    }
}
