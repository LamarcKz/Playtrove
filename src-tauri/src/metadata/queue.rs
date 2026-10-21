//! A fila de downloads de metadados: um jogo de cada vez, numa linha de execução à parte, avisando o
//! andamento a cada passo. Jogos pedidos enquanto a fila anda entram na mesma leva. Uma chave errada ou a
//! falta de internet param a leva inteira (todos os jogos falhariam igual); outros problemas pulam só
//! aquele jogo.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use rusqlite::Connection;
use serde::Serialize;

use super::download::{MetadataServices, download_game_metadata, lock};
use super::http::MetadataError;
use crate::i18n::{Language, text};
use crate::library::get_metadata_target;

/// Andamento do download de metadados (a interface mostra na barra do topo e avisa no fim).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataProgress {
    running: bool,
    /// Jogos já processados nesta leva.
    done: usize,
    /// Total de jogos da leva.
    total: usize,
    /// Jogo sendo processado agora.
    current: Option<String>,
    /// Jogos em que algo foi encontrado.
    found: usize,
    /// Títulos dos jogos em que nada foi encontrado.
    not_found: Vec<String>,
    /// Problemas (ex.: chave errada, sem internet).
    errors: Vec<String>,
}

/// O que a fila usa do app (os testes passam um de mentira).
pub trait QueueContext: Send + Sync + 'static {
    fn database(&self) -> &Mutex<Connection>;
    fn language(&self) -> Language;
    /// Os serviços com as chaves salvas agora; None se nenhum estiver configurado.
    fn services(&self) -> Option<MetadataServices>;
    /// O andamento mudou.
    fn on_progress(&self, progress: &MetadataProgress);
    /// Um jogo ganhou metadados (a interface recarrega a biblioteca).
    fn on_game_updated(&self);
}

#[derive(Default)]
struct QueueState {
    pending: VecDeque<i64>,
    /// Jogo sendo processado agora (pedir ele de novo no meio do download não repete o trabalho).
    current: Option<i64>,
    progress: MetadataProgress,
}

pub struct MetadataQueue {
    state: Arc<Mutex<QueueState>>,
    context: Arc<dyn QueueContext>,
    /// Pausa entre um jogo e outro, para não sobrecarregar os serviços.
    delay: Duration,
}

impl MetadataQueue {
    pub fn new(context: Arc<dyn QueueContext>, delay: Duration) -> MetadataQueue {
        MetadataQueue { state: Arc::default(), context, delay }
    }

    /// Coloca jogos na fila (os que já estão nela não entram de novo). Devolve quantos entraram.
    pub fn enqueue(&self, game_ids: &[i64]) -> usize {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let mut fresh: Vec<i64> = Vec::new();
        for id in game_ids {
            if !fresh.contains(id) && !state.pending.contains(id) && state.current != Some(*id) {
                fresh.push(*id);
            }
        }
        if fresh.is_empty() {
            return 0;
        }
        let count = fresh.len();
        state.pending.extend(fresh);
        let start = !state.progress.running;
        if start {
            state.progress = MetadataProgress { running: true, total: count, ..MetadataProgress::default() };
        } else {
            state.progress.total += count;
        }
        let progress = state.progress.clone();
        drop(state);
        self.context.on_progress(&progress);
        if start {
            let (state, context, delay) = (Arc::clone(&self.state), Arc::clone(&self.context), self.delay);
            thread::spawn(move || run(&state, &*context, delay));
        }
        count
    }

    pub fn progress(&self) -> MetadataProgress {
        self.state.lock().unwrap_or_else(PoisonError::into_inner).progress.clone()
    }
}

/// Muda o andamento e avisa.
fn update(state: &Mutex<QueueState>, context: &dyn QueueContext, change: impl FnOnce(&mut QueueState)) {
    let progress = {
        let mut state = state.lock().unwrap_or_else(PoisonError::into_inner);
        change(&mut state);
        state.progress.clone()
    };
    context.on_progress(&progress);
}

fn run(state: &Mutex<QueueState>, context: &dyn QueueContext, delay: Duration) {
    let language = context.language();
    let Some(services) = context.services() else {
        update(state, context, |state| {
            state.pending.clear();
            state.progress.running = false;
            state.progress.errors = vec![text(language, "errors.noMetadataServices", &[])];
        });
        return;
    };

    loop {
        let game_id = {
            let mut state = state.lock().unwrap_or_else(PoisonError::into_inner);
            let Some(id) = state.pending.pop_front() else { break };
            state.current = Some(id);
            id
        };
        let mut title = text(language, "errors.gameFallback", &[&game_id.to_string()]);
        // Numa linha só, para a trava do banco ser solta antes do download (que usa o banco de novo).
        let target = get_metadata_target(&lock(context.database()), language, game_id);
        let result = target.map_err(|error| MetadataError::Skip(error.to_string())).and_then(|target| {
            title = target.title;
            let current = title.clone();
            update(state, context, |state| state.progress.current = Some(current));
            download_game_metadata(context.database(), language, game_id, &services)
        });
        match result {
            Ok(found) => {
                let name = title.clone();
                update(
                    state,
                    context,
                    |state| if found { state.progress.found += 1 } else { state.progress.not_found.push(name) },
                );
                context.on_game_updated();
            }
            Err(MetadataError::Stop(message)) => update(state, context, |state| {
                // Os que ficaram na fila não serão processados: saem do total.
                state.progress.errors.push(message);
                state.progress.total -= state.pending.len();
                state.pending.clear();
            }),
            Err(MetadataError::Skip(message)) => {
                update(state, context, |state| state.progress.errors.push(format!("{title}: {message}")))
            }
        }
        update(state, context, |state| {
            state.current = None;
            state.progress.done += 1;
        });
        let more = !state.lock().unwrap_or_else(PoisonError::into_inner).pending.is_empty();
        if more && !delay.is_zero() {
            thread::sleep(delay);
        }
    }
    update(state, context, |state| {
        state.progress.running = false;
        state.progress.current = None;
    });
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::{Sender, channel};

    use serde_json::json;

    use super::super::download::tests::{database_with_game, make_services, services_world};
    use super::super::http::fake::{FakeFetch, json as json_response};
    use super::super::igdb::tests::salto_estelar;
    use super::*;
    use crate::emulators::EmulatorId;
    use crate::library::{EmulatedGame, add_emulated_game};
    use crate::test_support::temp_folder;

    /// Um app de mentira: o banco, os serviços dados e os avisos guardados.
    struct TestContext {
        db: Mutex<Connection>,
        services: Mutex<Option<MetadataServices>>,
        updates: Mutex<Vec<MetadataProgress>>,
        games_updated: Mutex<usize>,
        finished: Mutex<Sender<MetadataProgress>>,
    }

    impl QueueContext for TestContext {
        fn database(&self) -> &Mutex<Connection> {
            &self.db
        }
        fn language(&self) -> Language {
            Language::PtBr
        }
        fn services(&self) -> Option<MetadataServices> {
            self.services.lock().unwrap().take()
        }
        fn on_progress(&self, progress: &MetadataProgress) {
            self.updates.lock().unwrap().push(progress.clone());
            if !progress.running {
                let _ = self.finished.lock().unwrap().send(progress.clone());
            }
        }
        fn on_game_updated(&self) {
            *self.games_updated.lock().unwrap() += 1;
        }
    }

    /// Roda a fila com os jogos dados até ela parar.
    fn run_queue(db: Mutex<Connection>, services: Option<MetadataServices>, ids: &[i64]) -> (MetadataProgress, Arc<TestContext>) {
        let (finished, result) = channel();
        let context = Arc::new(TestContext {
            db,
            services: Mutex::new(services),
            updates: Mutex::default(),
            games_updated: Mutex::default(),
            finished: Mutex::new(finished),
        });
        let queue = MetadataQueue::new(Arc::clone(&context) as Arc<dyn QueueContext>, Duration::ZERO);
        queue.enqueue(ids);
        (result.recv_timeout(Duration::from_secs(10)).unwrap(), context)
    }

    fn add(db: &Connection, title: &str) -> i64 {
        let rom = format!(r"D:\{title}.iso");
        let game = EmulatedGame {
            title,
            rom_path: &rom,
            platform: "PlayStation 2",
            library: "PCSX2",
            emulator: EmulatorId::Pcsx2,
            core: None,
        };
        add_emulated_game(db, Language::PtBr, &game).unwrap().unwrap()
    }

    #[test]
    fn um_jogo_de_cada_vez_encontrados_nao_encontrados_e_erros() {
        let db = crate::test_support::memory_database();
        let ids = [add(&db, "Salto Estelar"), add(&db, "Meu Jogo Caseiro"), add(&db, "Jogo Problemático")];
        let fetch = Arc::new(FakeFetch::new(|url, request| {
            let body = request.body.as_deref().unwrap_or_default();
            if url.path() == "/twitch/token" {
                return json_response(json!({ "access_token": "t", "expires_in": 5_000_000 }), 200);
            }
            if body.contains("Problemático") {
                return json_response(json!({}), 500);
            }
            json_response(if body.contains("\"Salto Estelar\"") { json!([salto_estelar()]) } else { json!([]) }, 200)
        }));
        let services = make_services(fetch, &temp_folder("fila-um-de-cada-vez"), Some("igdb"));
        let (result, context) = run_queue(Mutex::new(db), Some(services), &ids);

        assert_eq!(
            result,
            MetadataProgress {
                running: false,
                done: 3,
                total: 3,
                current: None,
                found: 1,
                not_found: vec!["Meu Jogo Caseiro".into()],
                errors: vec!["Jogo Problemático: O IGDB respondeu com o erro 500.".into()],
            }
        );
        let updates = context.updates.lock().unwrap();
        assert_eq!((updates[0].running, updates[0].total, updates[0].done), (true, 3, 0));
        assert!(updates.iter().any(|update| update.current.as_deref() == Some("Salto Estelar")));
        assert_eq!(*context.games_updated.lock().unwrap(), 2);
    }

    #[test]
    fn sem_internet_para_a_leva_inteira() {
        let (db, game_id) = database_with_game("Salto Estelar");
        let other = add(&lock(&db), "Outro");
        let offline = Arc::new(FakeFetch::new(|_, _| Err("sem conexão".into())));
        let (result, _) = run_queue(db, Some(make_services(offline, &temp_folder("fila-sem-internet"), None)), &[game_id, other]);
        assert_eq!((result.done, result.total, result.found), (1, 1, 0));
        assert_eq!(result.errors, ["Não deu para falar com o IGDB. Confira a conexão com a internet."]);
    }

    #[test]
    fn sem_nenhum_servico_configurado_avisa() {
        let (db, game_id) = database_with_game("Salto Estelar");
        let (result, _) = run_queue(db, None, &[game_id]);
        assert_eq!(result.errors, ["Configure o IGDB ou o SteamGridDB em Configurações → Metadados."]);
    }

    #[test]
    fn nao_repete_jogos_que_ja_estao_na_fila() {
        let (db, game_id) = database_with_game("Salto Estelar");
        let (finished, result) = channel();
        let context = Arc::new(TestContext {
            db,
            services: Mutex::new(Some(make_services(services_world(vec![]), &temp_folder("fila-repetidos"), None))),
            updates: Mutex::default(),
            games_updated: Mutex::default(),
            finished: Mutex::new(finished),
        });
        // Uma pausa entre os jogos, para o segundo pedido chegar com a fila andando.
        let queue = MetadataQueue::new(context as Arc<dyn QueueContext>, Duration::from_millis(300));
        assert_eq!(queue.enqueue(&[game_id, game_id, 999]), 2);
        assert_eq!(queue.enqueue(&[999, game_id]), 0);
        let progress = result.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!((progress.done, progress.total, progress.found), (2, 2, 1));
        assert_eq!(progress.errors, ["Jogo 999: Jogo não encontrado."]);
    }
}
