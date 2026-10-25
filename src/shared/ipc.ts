/**
 * Contrato entre a interface (React) e a parte de trás do app (o Rust, em src-tauri): as funções que a
 * interface chama (`window.api`, que a ponte lib/tauriApi.ts liga aos comandos do Rust) e os avisos que
 * o Rust manda, com os mesmos nomes dos dois lados.
 */
import type { AchievementsConfig, AchievementsOverview, GameAchievements, UnlockedAchievement } from "./achievements"
import type { ConnectedController } from "./controllers"
import type { GameEvaluation } from "./evaluation"
import type { Language } from "./i18n"
import type {
  DailyPlaytime,
  EmulatorId,
  EmulatorInfo,
  LibrarySnapshot,
  MetadataConfig,
  MetadataProgress,
  MusicConfig,
  MusicReview,
  MusicPreview,
  RetroArchCore,
  RomFolder,
  ScanResult,
  Status,
  StatusRules,
  UpdateStatus,
} from "./types"

/** Os avisos do Rust para a interface (o `emit` do Rust e o `listen` da ponte). */
export const EVENTS = {
  /** A janela maximizou ou restaurou. */
  windowState: "window:state",
  /** Algo mudou na biblioteca: a interface pede os dados de novo. */
  libraryChanged: "library:changed",
  /** Os jogos abertos agora (um abriu ou fechou). */
  gamesRunning: "games:running",
  /** O andamento dos downloads de metadados. */
  metadataProgress: "metadata:progress",
  /** As preferências de música tema foram salvas. */
  musicConfig: "music:config",
  /** Começou ou terminou a atualização das conquistas. */
  achievementsStatus: "achievements:status",
  /** Conquistas novas desbloqueadas (para o aviso). */
  achievementsUnlocked: "achievements:unlocked",
  /** A situação da atualização do app mudou. */
  updatesStatus: "updates:status",
  /** Os controles conectados: um conectou, desconectou ou a bateria mudou. */
  controllersChanged: "controllers:changed",
} as const

/**
 * Sites que a interface pode abrir no navegador (as páginas para criar as chaves e a de download das
 * versões). A interface manda só o nome; os endereços ficam no Rust (src-tauri/src/links.rs), que não
 * abre nenhum outro.
 */
export const EXTERNAL_LINKS = ["twitchConsole", "steamGridDbApi", "retroAchievementsSettings", "releases"] as const
export type ExternalLink = (typeof EXTERNAL_LINKS)[number]

/** O que o aviso "window:state" informa sobre a janela. */
export interface WindowState {
  isMaximized: boolean
}

/** As funções que a interface chama em `window.api` (cada uma é um comando do Rust, pela ponte lib/tauriApi.ts). */
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
    /** Escolhe um MP4/WebM e guarda uma cópia como fundo do jogo. Cancelar conserva o vídeo atual. */
    pickBackgroundVideo: (gameId: number) => Promise<void>
    /** Remove somente a cópia do vídeo guardada pelo app. */
    removeBackgroundVideo: (gameId: number) => Promise<void>
    /** Volta a buscar o trailer automaticamente, preservando o arquivo original de vídeos manuais. */
    useAutomaticBackgroundVideo: (gameId: number) => Promise<void>
    /** Importa uma faixa local com prioridade sobre a busca automática. */
    pickThemeMusic: (gameId: number) => Promise<void>
    /** Remove a cópia interna e desativa a busca automática deste jogo. */
    removeThemeMusic: (gameId: number) => Promise<void>
    useAutomaticThemeMusic: (gameId: number) => Promise<void>
  }
  music: {
    getReviews: () => Promise<MusicReview[]>
    search: (gameId: number, query?: string) => Promise<MusicReview>
    preview: (gameId: number, generation: string, videoId: string, operationId?: string) => Promise<MusicPreview>
    choose: (gameId: number, generation: string, videoId: string, operationId?: string) => Promise<void>
    /** Revoga operações anteriores e devolve a autorização para a próxima. */
    cancelPreview: () => Promise<string>
    getConfig: () => Promise<MusicConfig>
    setConfig: (config: MusicConfig) => Promise<MusicConfig>
    onConfigChange: (callback: (config: MusicConfig) => void) => () => void
    /** Enfileira a busca das músicas automáticas ainda não consultadas. */
    download: () => Promise<number>
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
  /** Os controles conectados (DualSense), que o Rust lê, e o aviso de quando mudam. */
  controllers: {
    list: () => Promise<ConnectedController[]>
    /** Chama `callback` com a lista nova. Devolve uma função para parar de ouvir. */
    onChange: (callback: (controllers: ConnectedController[]) => void) => () => void
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
