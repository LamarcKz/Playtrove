import type Database from "better-sqlite3"

/** Um jogo de exemplo: nome, minutos jogados, status (pelo nome), favorito, dias desde a última vez, plataforma e biblioteca. */
type SampleGame = [string, number, string, boolean, number | null, string, string]

/**
 * 12 jogos FALSOS (títulos inventados), usados só nos testes automáticos: o app só coloca estes
 * jogos quando é aberto com PLAYTROVE_SAMPLE_GAMES=1 e a biblioteca está vazia.
 */
const SAMPLE_GAMES: SampleGame[] = [
  ["Crônicas de Valdoria: Ecos do Abismo", 4380, "Fazendo 100%", true, 2, "PlayStation 2", "PCSX2"],
  ["Neon Madrugada", 750, "Jogando", false, 0, "PlayStation", "DuckStation"],
  ["Horizonte Partido", 0, "Planejo jogar", false, null, "PlayStation 2", "PCSX2"],
  ["Cidadela Sombria", 2215, "Parei por um tempo", false, 60, "Game Boy Advance", "RetroArch"],
  ["Cavaleiros de Pixel", 95, "Abandonei", false, 200, "Nintendo DS", "RetroArch"],
  ["Mar de Estrelas", 12040, "Platinado", true, 45, "PlayStation 2", "PCSX2"],
  ["Operação Tempestade", 320, "Jogando", false, 5, "PlayStation", "DuckStation"],
  ["Jardim dos Autômatos", 45, "Jogando", false, 1, "Game Boy Advance", "RetroArch"],
  ["Rally Extremo 3", 1980, "Platinando", true, 10, "PlayStation 2", "PCSX2"],
  ["Lendas de Kitsune", 610, "Zerado", false, 120, "Nintendo DS", "RetroArch"],
  ["Colônia Ártica", 0, "Planejo jogar", false, null, "PlayStation", "DuckStation"],
  ["Detetive Noturno", 1335, "Zerado", false, 400, "PlayStation 2", "PCSX2"],
]

const DAY = 24 * 60 * 60 * 1000

/** Sessões de exemplo: os jogados nos últimos 30 dias ganham uma sessão (de até 90 min) no último dia jogado. */
const SAMPLE_SESSION_DAYS = 30
const SAMPLE_SESSION_MAX_MINUTES = 90

/** Coloca os jogos de exemplo, se a biblioteca estiver vazia. */
export function seedSampleGames(db: Database.Database): void {
  const total = db.prepare("SELECT COUNT(*) FROM games").pluck().get() as number
  if (total > 0) return

  const statusId = db.prepare("SELECT id FROM statuses WHERE name = ?").pluck()
  const insert = db.prepare(`
    INSERT INTO games (title, status_id, favorite, playtime_seconds, last_played_at, added_at, platform, library)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertSession = db.prepare(
    "INSERT INTO play_sessions (game_id, started_at, ended_at, seconds) VALUES (?, ?, ?, ?)"
  )
  const now = Date.now()
  db.transaction(() => {
    SAMPLE_GAMES.forEach(([title, minutes, status, favorite, daysAgo, platform, library], index) => {
      const lastPlayed = daysAgo === null ? null : now - daysAgo * DAY
      const { lastInsertRowid } = insert.run(
        title,
        statusId.get(status) as number,
        favorite ? 1 : 0,
        minutes * 60,
        lastPlayed === null ? null : new Date(lastPlayed).toISOString(),
        new Date(now - (500 - index) * DAY).toISOString(),
        platform,
        library
      )
      if (lastPlayed !== null && daysAgo !== null && daysAgo <= SAMPLE_SESSION_DAYS) {
        const seconds = Math.min(minutes, SAMPLE_SESSION_MAX_MINUTES) * 60
        insertSession.run(
          lastInsertRowid,
          new Date(lastPlayed - seconds * 1000).toISOString(),
          new Date(lastPlayed).toISOString(),
          seconds
        )
      }
    })
  })()
}
