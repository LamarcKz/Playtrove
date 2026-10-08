import type Database from "better-sqlite3"
import { setSetting } from "./settings"

/** Os status com que a biblioteca começa (o usuário pode mudar tudo em Configurações → Status). */
export const DEFAULT_STATUSES = [
  "Planejo jogar",
  "Parei por um tempo",
  "Abandonei",
  "Jogando",
  "Fazendo 100%",
  "Platinando",
  "Zerado",
  "100%",
  "Platinado",
]

/**
 * Cada migração leva o banco de uma versão para a seguinte. A versão fica guardada no próprio banco
 * (PRAGMA user_version): um banco novo roda todas; um banco antigo roda só as que faltam.
 * Nunca mude uma migração que já saiu numa versão do app: crie uma nova no fim da lista.
 */
const MIGRATIONS: ((db: Database.Database) => void)[] = [
  // 1: status, jogos, emuladores, pastas de ROMs e configurações.
  (db) => {
    db.exec(`
      CREATE TABLE statuses (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL
      );

      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        status_id INTEGER NOT NULL REFERENCES statuses(id),
        favorite INTEGER NOT NULL DEFAULT 0,
        playtime_seconds INTEGER NOT NULL DEFAULT 0,
        last_played_at TEXT,
        added_at TEXT NOT NULL,
        platform TEXT,
        library TEXT,
        rom_path TEXT UNIQUE,
        emulator_id TEXT,
        core TEXT,
        description TEXT,
        genres TEXT,
        developer TEXT,
        publisher TEXT,
        release_date TEXT,
        igdb_id INTEGER,
        sgdb_id INTEGER,
        cover_image TEXT,
        icon_image TEXT,
        background_image TEXT,
        metadata_updated_at TEXT
      );

      CREATE TABLE emulators (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL
      );

      CREATE TABLE rom_folders (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        emulator_id TEXT NOT NULL,
        core TEXT,
        platform TEXT NOT NULL
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)

    const insert = db.prepare("INSERT INTO statuses (name, position) VALUES (?, ?)")
    DEFAULT_STATUSES.forEach((name, position) => insert.run(name, position))
    const idOf = (name: string) => db.prepare("SELECT id FROM statuses WHERE name = ?").pluck().get(name) as number
    setSetting(db, "newGameStatusId", String(idOf("Planejo jogar")))
    setSetting(db, "firstPlayStatusId", String(idOf("Jogando")))
  },

  // 2: cada vez que um jogo foi jogado (para as estatísticas de atividade por dia).
  (db) => {
    db.exec(`
      CREATE TABLE play_sessions (
        id INTEGER PRIMARY KEY,
        game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        seconds INTEGER NOT NULL
      );
      CREATE INDEX play_sessions_ended_at ON play_sessions (ended_at);
    `)
  },

  // 3: tempo jogado registrado pelos próprios emuladores (PCSX2, DuckStation, RPCS3, RetroArch), o
  // código do disco (ex.: SLUS-20100, para achar o jogo nos registros deles) e de onde veio cada sessão.
  (db) => {
    db.exec(`
      ALTER TABLE games ADD COLUMN serial TEXT;
      ALTER TABLE games ADD COLUMN emulator_playtime_seconds INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE games ADD COLUMN emulator_last_played_at TEXT;
      ALTER TABLE games ADD COLUMN emulator_synced_at TEXT;
      ALTER TABLE play_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'app';
    `)
  },

  // 4: faz o app ler os registros dos emuladores como se fosse a primeira vez, para o tempo que eles
  // já tinham guardado entrar na atividade por dia das Estatísticas (o que já virou sessão é
  // descontado, então nada é contado duas vezes).
  (db) => {
    db.exec("UPDATE games SET emulator_synced_at = NULL")
  },

  // 5: a avaliação do usuário: nota e dificuldade (de 1 a 10, em meias estrelas e meias pimentas), a
  // análise escrita por ele e quando avaliou pela última vez.
  (db) => {
    db.exec(`
      ALTER TABLE games ADD COLUMN rating INTEGER;
      ALTER TABLE games ADD COLUMN difficulty INTEGER;
      ALTER TABLE games ADD COLUMN review TEXT;
      ALTER TABLE games ADD COLUMN evaluated_at TEXT;
    `)
  },

  // 6: conquistas do RetroAchievements: qual jogo de lá é cada jogo da biblioteca, o catálogo de
  // cada console (para achar os jogos pelo nome), os jogos e as conquistas com o que o usuário fez.
  (db) => {
    db.exec(`
      ALTER TABLE games ADD COLUMN ra_game_id INTEGER;
      ALTER TABLE games ADD COLUMN ra_matched_at TEXT;

      CREATE TABLE ra_catalog (
        console_id INTEGER NOT NULL,
        ra_game_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        num_achievements INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (console_id, ra_game_id)
      );

      CREATE TABLE ra_games (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        num_distinct_players INTEGER NOT NULL DEFAULT 0,
        synced_at TEXT NOT NULL
      );

      CREATE TABLE achievements (
        id INTEGER PRIMARY KEY,
        ra_game_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        points INTEGER NOT NULL DEFAULT 0,
        badge_name TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        num_awarded INTEGER NOT NULL DEFAULT 0,
        earned_at TEXT,
        earned_hardcore_at TEXT
      );
      CREATE INDEX achievements_game ON achievements (ra_game_id);
      CREATE INDEX achievements_earned ON achievements (earned_at);
    `)
  },

  // 7: troféus dos jogos de PS3, que o RPCS3 guarda: o conjunto de troféus de cada jogo (o código
  // que fica no disco, em PS3_GAME/TROPDIR, ex.: NPWR01234_00), os conjuntos que o RPCS3 instalou
  // e os troféus, com o que o usuário já pegou.
  (db) => {
    db.exec(`
      ALTER TABLE games ADD COLUMN trophy_set TEXT;
      ALTER TABLE games ADD COLUMN trophy_checked_at TEXT;

      CREATE TABLE trophy_sets (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        file_stamp TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );

      CREATE TABLE trophies (
        set_id TEXT NOT NULL,
        id INTEGER NOT NULL,
        name TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        grade TEXT NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0,
        group_name TEXT,
        unlocked_at TEXT,
        PRIMARY KEY (set_id, id)
      );
      CREATE INDEX trophies_unlocked ON trophies (unlocked_at);
    `)
  },

  // 8: o app em português e inglês. Os status padrão ganham a marca de qual status eles são, para o
  // nome mudar com o idioma (até o usuário renomear), e os gêneros passam a ficar como vêm do IGDB,
  // em inglês (a tela traduz); até aqui eles eram gravados já em português.
  (db) => {
    db.exec("ALTER TABLE statuses ADD COLUMN preset TEXT")
    upgradeToLanguages(db)
  },
]

/** A versão do banco em que o app ficou em português e inglês (migração 8). */
export const LANGUAGES_VERSION = 8

/**
 * O que a migração 8 faz nos dados: marca os status padrão e volta os gêneros para o nome do IGDB.
 * O conserto de um banco de antes dela também usa, nas linhas que recuperou.
 */
export function upgradeToLanguages(db: Database.Database): void {
  markDefaultStatusPresets(db)
  const games = db.prepare("SELECT id, genres FROM games WHERE genres IS NOT NULL").all() as { id: number; genres: string }[]
  const update = db.prepare("UPDATE games SET genres = ? WHERE id = ?")
  for (const game of games) {
    let genres: unknown
    try {
      genres = JSON.parse(game.genres)
    } catch {
      continue
    }
    if (!Array.isArray(genres)) continue
    const original = genres.map((genre) => (typeof genre === "string" ? (OLD_GENRE_NAMES[genre] ?? genre) : genre))
    update.run(JSON.stringify(original), game.id)
  }
}

/** O status padrão (a chave do dicionário) de cada nome de DEFAULT_STATUSES. */
const DEFAULT_STATUS_PRESETS: [name: string, preset: string][] = [
  ["Planejo jogar", "planToPlay"],
  ["Parei por um tempo", "onHold"],
  ["Abandonei", "abandoned"],
  ["Jogando", "playing"],
  ["Fazendo 100%", "goingFor100"],
  ["Platinando", "goingForPlatinum"],
  ["Zerado", "beaten"],
  ["100%", "complete100"],
  ["Platinado", "platinum"],
]

/** Marca os status que ainda têm o nome de um status padrão: o nome deles passa a mudar com o idioma. */
function markDefaultStatusPresets(db: Database.Database): void {
  const mark = db.prepare("UPDATE statuses SET preset = ? WHERE name = ? AND preset IS NULL")
  for (const [name, preset] of DEFAULT_STATUS_PRESETS) mark.run(preset, name)
}

/** Os gêneros que o app gravava em português até a migração 8, com o nome original do IGDB. */
const OLD_GENRE_NAMES: Record<string, string> = {
  Aventura: "Adventure",
  "Cartas e tabuleiro": "Card & Board Game",
  Luta: "Fighting",
  "Hack and slash": "Hack and slash/Beat 'em up",
  Música: "Music",
  Plataforma: "Platform",
  "Quebra-cabeça": "Puzzle",
  Quiz: "Quiz/Trivia",
  Corrida: "Racing",
  "Estratégia em tempo real": "Real Time Strategy (RTS)",
  RPG: "Role-playing (RPG)",
  Tiro: "Shooter",
  Simulação: "Simulator",
  Esporte: "Sport",
  Estratégia: "Strategy",
  Tático: "Tactical",
  "Estratégia por turnos": "Turn-based strategy (TBS)",
  "Visual novel": "Visual Novel",
}

/**
 * Cria as tabelas num banco novo e aplica as mudanças que faltam num banco antigo. `upTo` para numa
 * versão antes da última (só os testes, para montar um banco de uma versão antiga).
 */
export function runMigrations(db: Database.Database, upTo = MIGRATIONS.length): void {
  const current = db.pragma("user_version", { simple: true }) as number
  for (let version = current; version < upTo; version++) {
    db.transaction(() => {
      MIGRATIONS[version](db)
      db.pragma(`user_version = ${version + 1}`)
    })()
  }
}
