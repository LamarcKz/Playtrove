/** Atividade local por jogo para as regras do Welcome Hub. */
export interface HubGameActivity {
  gameId: number
  /** Tempo total em segundos, antes do arredondamento que a biblioteca apresenta. */
  playtimeSeconds: number
  /** Sessões registradas pelo app; importações acumuladas dos emuladores não são novas aberturas. */
  playCount: number
  /** Tempo deste mês no horário local, incluindo o tempo importado dos emuladores. */
  monthMinutes: number
}

/** Termos de metadados do Aniki Helper (MIT), preservados no idioma da fonte; não são textos da interface. */
export const ANIKI_FINISHED_STATUS_MARKERS = ["terminé", "fini", "completed", "beaten", "finished"]
export const ANIKI_GAME_FAMILIES = [
  ["souls", ["soulslike", "souls-like", "souls like", "dark souls", "demon's souls", "demons souls", "elden ring"]],
  ["jrpg", ["jrpg", "j-rpg", "tour par tour", "turn-based"]],
  ["action_adventure", ["action et aventure", "action adventure", "action aventure", "third person", "3e personne", "3ᵉ personne", "infiltration", "stealth", "assassinat", "hack and slash"]],
  ["narrative", ["story rich", "scenario riche", "scénario riche", "choices matter", "choix multiples", "point and click", "pointer et cliquer", "interactive fiction", "aventure interactive", "visual novel", "roman graphique"]],
  ["fighting", ["combat", "fighting", "versus", "vs"]],
  ["anime_fight", ["anime", "manga"]],
  ["shooter", ["shooter", "fps", "tps", "tir", "gun"]],
  ["roguelite", ["rogue", "roguelite", "roguelike"]],
  ["platformer", ["plateforme", "platformer", "metroidvania"]],
  ["sport", ["sport", "football", "basket"]],
  ["racing", ["course", "racing", "voiture"]],
  ["party", ["party", "party game", "fête", "multijoueur local", "local co-op", "coop en local"]],
] as const
