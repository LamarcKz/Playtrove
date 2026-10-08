/**
 * Contrato da comunicação entre o processo principal (main) e a interface (renderer).
 * Os dois lados importam daqui, então os nomes dos canais nunca ficam diferentes.
 */
import type { AchievementsConfig, AchievementsOverview, GameAchievements, UnlockedAchievement } from "./achievements"
import type { GameEvaluation } from "./evaluation"
import type { Language } from "./i18n"
import type {
  DailyPlaytime,
  EmulatorId,
  EmulatorInfo,
  LibrarySnapshot,
  MetadataConfig,
  MetadataProgress,
  RetroArchCore,
  RomFolder,
  ScanResult,
  Status,
  StatusRules,
  UpdateStatus,
} from "./types"

/** Nomes dos canais IPC. */
export const IPC_CHANNELS = {
  /** Pergunta a versão do app. Renderer → main, com resposta (invoke/handle). */
  appVersion: "app:version",
  /** Abre no navegador um dos sites de EXTERNAL_LINKS (send/on). */
  appOpenLink: "app:open-link",
  /** Abre no navegador o formulário de bug do GitHub, com a versão do app e a do Windows preenchidas (send/on). */
  appReportBug: "app:report-bug",
  /** O idioma do app: perguntar e trocar (invoke/handle). */
  appGetLanguage: "app:get-language",
  appSetLanguage: "app:set-language",
  /** Botões da barra do topo. Renderer → main, sem resposta (send/on). */
  windowControls: "window:controls",
  /**
   * Estado da janela (maximizada ou não). Funciona nos dois sentidos: o renderer pergunta
   * o estado atual (invoke/handle) e o main avisa sempre que ele muda (webContents.send/on).
   */
  windowState: "window:state",
  /** Pede a biblioteca inteira: jogos, status e regras (invoke/handle). */
  libraryGet: "library:get",
  /** Main → renderer: algo mudou na biblioteca e a interface deve pedir os dados de novo. */
  libraryChanged: "library:changed",
  /** Muda o status de um jogo (invoke/handle). */
  gamesSetStatus: "games:set-status",
  /** Cria, renomeia, reordena e apaga status, e troca as regras automáticas (invoke/handle). */
  statusesCreate: "statuses:create",
  statusesRename: "statuses:rename",
  statusesReorder: "statuses:reorder",
  statusesDelete: "statuses:delete",
  statusesSetRules: "statuses:set-rules",
  /** Emuladores: listar (e detectar sozinho na primeira vez), procurar de novo, escolher o executável e os cores do RetroArch. */
  emulatorsList: "emulators:list",
  emulatorsDetect: "emulators:detect",
  emulatorsPickPath: "emulators:pick-path",
  emulatorsCores: "emulators:cores",
  /** Pastas de ROMs: listar, escolher uma pasta (janela do Windows), adicionar, tirar e procurar jogos. */
  romFoldersList: "rom-folders:list",
  romFoldersPick: "rom-folders:pick",
  romFoldersAdd: "rom-folders:add",
  romFoldersRemove: "rom-folders:remove",
  romFoldersScan: "rom-folders:scan",
  /** Abre um jogo no emulador (invoke/handle). */
  gamesPlay: "games:play",
  /** Jogos abertos agora: o renderer pergunta (invoke/handle) e o main avisa quando muda (send/on). */
  gamesRunning: "games:running",
  /** Marca ou desmarca um jogo como favorito (invoke/handle). */
  gamesSetFavorite: "games:set-favorite",
  /** Mostra a ROM do jogo no Explorador de Arquivos (invoke/handle). */
  gamesShowRom: "games:show-rom",
  /** Salva a avaliação do usuário: nota, dificuldade e análise (invoke/handle). */
  gamesSetEvaluation: "games:set-evaluation",
  /** Metadados: o que está configurado, salvar as chaves (conferindo antes) e baixar sozinho para jogos novos. */
  metadataGetConfig: "metadata:get-config",
  metadataSetIgdb: "metadata:set-igdb",
  metadataSetSteamGridDb: "metadata:set-steamgriddb",
  metadataSetAutoDownload: "metadata:set-auto-download",
  /** Coloca jogos na fila de download de metadados (invoke/handle). */
  metadataDownload: "metadata:download",
  /** Andamento dos downloads: o renderer pergunta (invoke/handle) e o main avisa a cada passo (send/on). */
  metadataProgress: "metadata:progress",
  /** Tempo jogado por dia, nos últimos dias (invoke/handle). */
  statsDailyPlaytime: "stats:daily-playtime",
  /**
   * Conquistas do RetroAchievements: a conta (sem a chave), salvar a conta (conferindo antes),
   * atualizar agora, as conquistas de um jogo e tudo o que a aba mostra (invoke/handle).
   */
  achievementsGetConfig: "achievements:get-config",
  achievementsSetAccount: "achievements:set-account",
  achievementsSync: "achievements:sync",
  achievementsGame: "achievements:game",
  achievementsOverview: "achievements:overview",
  /** Main → renderer: começou ou terminou de atualizar as conquistas. */
  achievementsStatus: "achievements:status",
  /** Main → renderer: conquistas novas desbloqueadas (para o aviso). */
  achievementsUnlocked: "achievements:unlocked",
  /**
   * Atualização do app: a situação (o renderer pergunta com invoke/handle e o main avisa quando muda,
   * com send/on), procurar agora, instalar a versão encontrada e ligar ou desligar a procura ao abrir.
   */
  updatesStatus: "updates:status",
  updatesCheck: "updates:check",
  updatesInstall: "updates:install",
  updatesSetAutoCheck: "updates:set-auto-check",
} as const

/**
 * Sites que a interface pode abrir no navegador (as páginas para criar as chaves de metadados e a de
 * download das versões). A interface manda só o nome; o endereço fica aqui, e o main não abre nenhum outro.
 */
export const EXTERNAL_LINKS = {
  twitchConsole: "https://dev.twitch.tv/console/apps",
  steamGridDbApi: "https://www.steamgriddb.com/profile/preferences/api",
  retroAchievementsSettings: "https://retroachievements.org/settings",
  releases: "https://github.com/LamarcKz/Playtrove/releases/latest",
} as const
export type ExternalLink = keyof typeof EXTERNAL_LINKS

/** Ações aceitas pelo canal "window:controls". */
export const WINDOW_CONTROL_ACTIONS = ["minimize", "toggle-maximize", "close"] as const
export type WindowControlAction = (typeof WINDOW_CONTROL_ACTIONS)[number]

/** O que o canal "window:state" informa sobre a janela. */
export interface WindowState {
  isMaximized: boolean
}

/** Funções que o preload expõe para o React em `window.api`. */
export interface AppApi {
  app: {
    getVersion: () => Promise<string>
    /** Abre um dos sites de EXTERNAL_LINKS no navegador padrão. */
    openLink: (link: ExternalLink) => void
    /** Abre o formulário de bug do GitHub, com a versão do app e a do Windows já preenchidas. */
    reportBug: () => void
    /** O idioma do app agora (o escolhido nas Configurações ou, sem escolha, o do Windows). */
    getLanguage: () => Promise<Language>
    /** Troca o idioma e guarda a escolha. */
    setLanguage: (language: Language) => Promise<void>
  }
  windowControls: {
    minimize: () => void
    /** Maximiza a janela ou, se ela já estiver maximizada, restaura o tamanho anterior. */
    toggleMaximize: () => void
    close: () => void
    /** Pergunta se a janela está maximizada agora. */
    getState: () => Promise<WindowState>
    /** Chama `callback` sempre que a janela maximizar ou restaurar. Devolve uma função para parar de ouvir. */
    onStateChange: (callback: (state: WindowState) => void) => () => void
  }
  library: {
    /** Jogos, status e regras, de uma vez. */
    get: () => Promise<LibrarySnapshot>
    /** Chama `callback` sempre que algo mudar na biblioteca. Devolve uma função para parar de ouvir. */
    onChange: (callback: () => void) => () => void
  }
  games: {
    setStatus: (gameId: number, statusId: number) => Promise<void>
    /** Abre o jogo no emulador dele. Rejeita com a mensagem do problema (ex.: emulador não configurado). */
    play: (gameId: number) => Promise<void>
    /** Ids dos jogos abertos agora. */
    getRunning: () => Promise<number[]>
    /** Chama `callback` com os jogos abertos sempre que um abre ou fecha. Devolve uma função para parar de ouvir. */
    onRunningChange: (callback: (gameIds: number[]) => void) => () => void
    setFavorite: (gameId: number, favorite: boolean) => Promise<void>
    /** Abre o Explorador de Arquivos com a ROM do jogo selecionada. */
    showRom: (gameId: number) => Promise<void>
    /** Salva a nota, a dificuldade e a análise do jogo (null apaga cada uma). */
    setEvaluation: (gameId: number, evaluation: GameEvaluation) => Promise<void>
  }
  metadata: {
    getConfig: () => Promise<MetadataConfig>
    /** Confere e salva o Client ID e o Client Secret do IGDB (null apaga). Rejeita se estiverem errados. */
    setIgdb: (credentials: { clientId: string; clientSecret: string } | null) => Promise<MetadataConfig>
    /** Confere e salva a chave do SteamGridDB (null apaga). Rejeita se ela estiver errada. */
    setSteamGridDb: (key: string | null) => Promise<MetadataConfig>
    setAutoDownload: (enabled: boolean) => Promise<MetadataConfig>
    /** Baixa os metadados dos jogos dados ou, sem ids, dos que ainda não têm. Devolve quantos entraram na fila. */
    download: (gameIds?: number[]) => Promise<number>
    getProgress: () => Promise<MetadataProgress>
    /** Chama `callback` a cada passo dos downloads. Devolve uma função para parar de ouvir. */
    onProgress: (callback: (progress: MetadataProgress) => void) => () => void
  }
  emulators: {
    list: () => Promise<EmulatorInfo[]>
    /** Procura de novo os emuladores que ainda não foram encontrados. */
    detect: () => Promise<EmulatorInfo[]>
    /** Abre a janela do Windows para escolher o executável do emulador. */
    pickPath: (id: EmulatorId) => Promise<EmulatorInfo[]>
    /** Cores instalados no RetroArch configurado. */
    cores: () => Promise<RetroArchCore[]>
  }
  romFolders: {
    list: () => Promise<RomFolder[]>
    /** Abre a janela do Windows para escolher uma pasta. null se o usuário cancelar. */
    pick: () => Promise<string | null>
    add: (folder: Omit<RomFolder, "id">) => Promise<RomFolder>
    remove: (id: number) => Promise<void>
    /** Procura jogos numa pasta, ou em todas (sem id). */
    scan: (id?: number) => Promise<ScanResult>
  }
  stats: {
    /** Quanto se jogou em cada um dos últimos 30 dias, do mais antigo para hoje. */
    dailyPlaytime: () => Promise<DailyPlaytime[]>
  }
  achievements: {
    getConfig: () => Promise<AchievementsConfig>
    /** Confere e salva a conta do RetroAchievements (null apaga). Rejeita se a chave ou o usuário estiverem errados. */
    setAccount: (account: { username: string; apiKey: string } | null) => Promise<AchievementsConfig>
    /** Atualiza as conquistas de todos os jogos agora. */
    sync: () => Promise<void>
    /** As conquistas de um jogo da biblioteca, ou null se ele não estiver no RetroAchievements. */
    game: (gameId: number) => Promise<GameAchievements | null>
    overview: () => Promise<AchievementsOverview>
    /** Chama `callback` quando começa ou termina uma atualização. Devolve uma função para parar de ouvir. */
    onStatus: (callback: (config: AchievementsConfig) => void) => () => void
    /** Chama `callback` com as conquistas novas. Devolve uma função para parar de ouvir. */
    onUnlocked: (callback: (achievements: UnlockedAchievement[]) => void) => () => void
  }
  updates: {
    getStatus: () => Promise<UpdateStatus>
    /** Procura uma versão nova agora. */
    check: () => Promise<void>
    /** Baixa e instala a versão encontrada (o app fecha e abre de novo) ou, na portátil, abre a página de download. */
    install: () => Promise<void>
    /** Liga ou desliga a procura de versão nova sempre que o app abre. */
    setAutoCheck: (enabled: boolean) => Promise<void>
    /** Chama `callback` sempre que a situação muda. Devolve uma função para parar de ouvir. */
    onStatus: (callback: (status: UpdateStatus) => void) => () => void
  }
  statuses: {
    create: (name: string) => Promise<Status>
    rename: (id: number, name: string) => Promise<void>
    /** `ids` tem todos os status, na ordem nova. */
    reorder: (ids: number[]) => Promise<void>
    /** Apaga o status e passa os jogos dele para `moveToId`. */
    remove: (id: number, moveToId: number) => Promise<void>
    setRules: (rules: StatusRules) => Promise<void>
  }
}
