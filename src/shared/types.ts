import type { AchievementProgress } from "./achievements"

/**
 * Um status de jogo (Planejo jogar, Jogando, Zerado...). Os status ficam no banco: o usuário cria,
 * renomeia e muda a ordem em Configurações → Status. A ordem é a das colunas do modo Kanban.
 * Os status não têm cor (pedido do usuário).
 */
export interface Status {
  id: number
  name: string
  /** Posição na ordem, começando em 0. */
  position: number
}

/** As duas regras automáticas de status (Configurações → Status). */
export interface StatusRules {
  /** Status que um jogo recebe quando entra na biblioteca. */
  newGameStatusId: number
  /** Status que um jogo recebe na primeira vez em que é jogado. */
  firstPlayStatusId: number
}

/** Um jogo da biblioteca. */
export interface Game {
  id: number
  title: string
  statusId: number
  /** Marcado como favorito. */
  favorite: boolean
  /** Tempo total jogado, em minutos. */
  playtimeMinutes: number
  /** Quando foi jogado pela última vez (data e hora no formato ISO), ou null se nunca foi jogado. */
  lastPlayedAt: string | null
  /** Quando entrou na biblioteca (data e hora no formato ISO). */
  addedAt: string
  /** Console ou sistema do jogo (ex.: "PlayStation 2"). */
  platform: string | null
  /** De onde o jogo vem (ex.: "PCSX2"). */
  library: string | null
  /** Arquivo da ROM, para jogos de emulador. */
  romPath: string | null
  /** Emulador que abre o jogo. */
  emulatorId: EmulatorId | null
  /** Descrição (vem do IGDB, em inglês). */
  description: string | null
  /** Gêneros como o IGDB escreve (ex.: ["Racing", "Simulator"]); a tela traduz (genreLabel()). */
  genres: string[]
  developers: string[]
  publishers: string[]
  /** Data de lançamento, no formato AAAA-MM-DD. */
  releaseDate: string | null
  /** Endereços das imagens do jogo (protocolo playtrove-img:), ou null se ele não tiver. O ícone da lista é um pedaço da capa. */
  coverUrl: string | null
  backgroundUrl: string | null
  /** Quando os metadados foram baixados pela última vez (ISO), ou null se nunca. */
  metadataUpdatedAt: string | null
  /** Minha nota, de 1 a 10 em meias estrelas (9 = quatro e meia), ou null se ainda não avaliei. */
  rating: number | null
  /** A dificuldade que eu achei, de 1 a 10 em meias pimentas, ou null. */
  difficulty: number | null
  /** Minha análise do jogo, ou null. */
  review: string | null
  /** O progresso nas conquistas do RetroAchievements, ou null se o jogo não tiver (ou não foi achado lá). */
  achievements: AchievementProgress | null
}

/** Emuladores que o app sabe usar. */
export type EmulatorId = "pcsx2" | "duckstation" | "retroarch" | "rpcs3"

/** Um emulador, como a aba Emuladores mostra. */
export interface EmulatorInfo {
  id: EmulatorId
  name: string
  /** Consoles que ele roda, para mostrar na tela (ex.: "PlayStation 2"); null = vários, um core para cada (RetroArch). */
  platforms: string | null
  /** Executável configurado (encontrado sozinho ou escolhido pelo usuário), ou null. */
  path: string | null
  /** O executável configurado existe no disco? */
  found: boolean
}

/** Um core do RetroArch instalado (cada core roda um ou mais consoles). */
export interface RetroArchCore {
  /** Nome do arquivo sem a extensão (ex.: "mgba_libretro"). */
  id: string
  /** Nome para mostrar (ex.: "Nintendo - Game Boy Advance (mGBA)"). */
  name: string
  /** Console(s) do core (ex.: "Nintendo DS"). */
  system: string
  /** Extensões de ROM que o core abre, sem o ponto (ex.: ["gba", "gb"]). */
  extensions: string[]
}

/** Uma pasta de ROMs: os arquivos dela abrem num emulador (e num core, no RetroArch). */
export interface RomFolder {
  id: number
  path: string
  emulatorId: EmulatorId
  /** Core do RetroArch (só para o RetroArch). */
  core: string | null
  /** Console dos jogos da pasta (ex.: "PlayStation 2"). */
  platform: string
}

/** O que uma varredura de pastas encontrou. */
export interface ScanResult {
  /** Títulos dos jogos novos que entraram na biblioteca. */
  added: string[]
  /** Ids dos jogos novos (na mesma ordem de `added`). */
  addedIds: number[]
  /** Quantos arquivos já estavam na biblioteca. */
  alreadyInLibrary: number
  /** Problemas (ex.: pasta que não existe mais). */
  errors: string[]
}

/** Tudo o que a interface precisa da biblioteca, de uma vez só. */
export interface LibrarySnapshot {
  games: Game[]
  statuses: Status[]
  rules: StatusRules
}

/** Quanto se jogou num dia (para o gráfico de atividade das Estatísticas). */
export interface DailyPlaytime {
  /** Data no horário do computador, AAAA-MM-DD. */
  date: string
  minutes: number
}

/** A situação da atualização do app (o aviso de versão nova e Configurações → Sobre). */
export interface UpdateStatus {
  /**
   * unsupported: rodando pelo npm run dev, sem atualização; idle: ainda não procurou; checking;
   * latest: esta já é a versão mais nova; available: há uma versão nova; downloading; ready: baixada,
   * o app fecha para instalar e abre de novo; error: não deu para procurar ou baixar (ex.: sem internet).
   */
  state: "unsupported" | "idle" | "checking" | "latest" | "available" | "downloading" | "ready" | "error"
  /** A versão nova, quando há uma. */
  version: string | null
  /** Quanto do download já foi, de 0 a 100. */
  percent: number
  /** Versão portátil: não se atualiza sozinha; o aviso leva à página de download. */
  portable: boolean
  /** Procurar versão nova sempre que o app abrir (Configurações → Sobre). */
  autoCheck: boolean
}

/** O que está configurado para baixar metadados (as chaves em si nunca voltam para a interface). */
export interface MetadataConfig {
  /** O IGDB (descrição, gênero, desenvolvedora, lançamento) tem Client ID e Client Secret salvos. */
  igdb: boolean
  /** Client ID do IGDB (não é segredo; aparece na tela para o usuário conferir). */
  igdbClientId: string | null
  /** O SteamGridDB (capa, ícone e fundo) tem a chave salva. */
  steamGridDb: boolean
  /** Baixar sozinho os metadados dos jogos novos, quando uma pasta de ROMs é procurada. */
  autoDownload: boolean
}

/** Andamento do download de metadados (o main avisa a cada jogo). */
export interface MetadataProgress {
  running: boolean
  /** Jogos já processados nesta leva. */
  done: number
  /** Total de jogos da leva. */
  total: number
  /** Jogo sendo processado agora. */
  current: string | null
  /** Jogos em que algo foi encontrado. */
  found: number
  /** Títulos dos jogos em que nada foi encontrado. */
  notFound: string[]
  /** Problemas (ex.: chave errada, sem internet). */
  errors: string[]
}
