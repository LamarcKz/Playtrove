//! Metadados e imagens dos jogos: IGDB (descrição, gêneros, empresas e lançamento), SteamGridDB (capa e
//! fundo), libretro-thumbnails (a capa escaneada dos jogos de emulador), a escolha do resultado certo, o
//! download de um jogo, a fila e as chaves. O mesmo do app em Electron (src/main/metadata).

pub mod credentials;
pub mod download;
pub mod http;
pub mod igdb;
pub mod libretro;
pub mod matching;
pub mod queue;
pub mod service;
pub mod steam_grid_db;
