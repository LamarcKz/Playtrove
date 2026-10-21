//! Conquistas (pedidos do usuário em 2026-09-24): as do RetroAchievements e os troféus dos jogos de PS3,
//! que o próprio RPCS3 guarda. As duas aparecem do mesmo jeito, como troféus do PS3. O mesmo do app em
//! Electron (src/main/achievements).

pub mod badges;
pub mod client;
pub mod matching;
pub mod service;
pub mod store;
pub mod sync;
pub mod trophy_files;
pub mod trophy_icons;
pub mod trophy_store;
pub mod trophy_sync;
pub mod types;
pub mod views;
