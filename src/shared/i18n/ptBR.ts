/**
 * Os textos do app em português do Brasil. É o dicionário base: o inglês (en.ts) precisa ter as
 * mesmas chaves, e o TypeScript confere. As funções montam os textos com números e nomes, com o
 * plural e a concordância de cada idioma. Nos passos a passo, o que está entre ** aparece em negrito.
 */
export const ptBR = {
  /** O idioma das datas e dos números (Intl). */
  locale: "pt-BR",

  common: {
    cancel: "Cancelar",
    save: "Salvar",
    add: "Adicionar",
    remove: "Remover",
    delete: "Apagar",
    change: "Trocar",
    clear: "Limpar",
    loading: "Carregando…",
    /** "1 jogo", "3 jogos". */
    games: (count: number) => (count === 1 ? "1 jogo" : `${count} jogos`),
    /** "A, B, C e mais 2" (a lista já vem com as vírgulas). */
    andMore: (list: string, rest: number) => `${list} e mais ${rest}`,
  },

  /** Os nomes das informações dos jogos (detalhes, colunas da Lista e filtros). */
  fields: {
    name: "Nome",
    status: "Status",
    playtime: "Tempo jogado",
    lastPlayed: "Última vez jogado",
    library: "Biblioteca",
    platform: "Plataforma",
    genre: "Gênero",
    developer: "Desenvolvedora",
    publisher: "Publicadora",
    release: "Lançamento",
    releaseYear: "Ano de lançamento",
    rating: "Nota",
    difficulty: "Dificuldade",
    achievements: "Conquistas",
  },

  pages: {
    library: "Biblioteca",
    stats: "Estatísticas",
    achievements: "Conquistas",
    emulators: "Emuladores",
    settings: "Configurações",
  },

  sidebar: {
    label: "Menu principal",
  },

  topBar: {
    minimize: "Minimizar",
    maximize: "Maximizar",
    restore: "Restaurar",
    close: "Fechar",
    dev: "DEV",
    devHint: "Versão de desenvolvimento (npm run dev), com uma cópia da sua biblioteca",
  },

  toast: {
    close: "Fechar aviso",
  },

  dialog: {
    close: "Fechar",
  },

  /** O controle na barra do topo (DualSense). */
  controller: {
    full: "Cheia",
    charging: (percent: number | null) => `Carregando ${percent}%`,
    connected: (name: string, connection: "usb" | "bluetooth") =>
      `${name} conectado ${connection === "usb" ? "por USB" : "por Bluetooth"}`,
    readingBattery: "lendo a bateria…",
    batteryNotCharging: (percent: number | null) => `bateria em ${percent}%, sem carregar`,
    battery: (percent: number | null) => `bateria em ${percent}%`,
    chargingStatus: (percent: number | null) => `carregando (${percent}%)`,
    fullStatus: (percent: number | null) => `carga completa (${percent}%)`,
    unknownBattery: "bateria desconhecida",
  },

  /** Tempo e datas curtas (lib/format.ts). */
  format: {
    neverPlayed: "Nunca jogado",
    today: "Hoje",
    yesterday: "Ontem",
    daysAgo: (days: number) => `Há ${days} dias`,
    /** "45 min" */
    minutes: (minutes: number | string) => `${minutes} min`,
    /** "2 h", "1,5 h" (o número já vem no formato do idioma) */
    hours: (hours: number | string) => `${hours} h`,
  },

  library: {
    views: { details: "Detalhes", grid: "Grade", list: "Lista", kanban: "Kanban" },
    viewMode: "Modo de exibição",
    searchPlaceholder: "Buscar na biblioteca...",
    searchLabel: "Buscar jogos",
    filters: "Filtros",
    closeFilters: "Fechar filtros",
    emptyTitle: "Sua biblioteca está vazia",
    emptyDescription: "Os jogos aparecem aqui quando você adicionar as pastas das suas ROMs na aba Emuladores.",
    goToEmulators: "Ir para Emuladores",
    noResultsTitle: "Nenhum jogo encontrado",
    noResultsDescription: "Tente outra busca ou desligue os filtros.",
    clearFilters: "Limpar filtros",
  },

  filters: {
    title: "Filtros",
    close: "Fechar filtros",
    favorites: "Favoritos",
    recent: "Recentes",
    recentHint: (days: number) => `Últimos ${days} dias`,
    all: "Todos",
    noData: "Sem dados ainda",
    playtimeRanges: {
      never: "Nunca jogado",
      "under-1h": "Menos de 1 h",
      "1-10h": "1 a 10 h",
      "10-100h": "10 a 100 h",
      "over-100h": "Mais de 100 h",
    },
    /** As faixas dos filtros Nota e Dificuldade: "5 estrelas", "4 a 4,5 estrelas", "1 a 1,5 estrela", "Meia estrela"... */
    scoreRange: (kind: "rating" | "difficulty", range: string) => {
      const [one, many] = kind === "rating" ? ["estrela", "estrelas"] : ["pimenta", "pimentas"]
      if (range === "none") return kind === "rating" ? "Sem nota" : "Sem dificuldade"
      if (range === "half") return `Meia ${one}`
      if (range === "5") return `5 ${many}`
      return `${range} a ${range},5 ${range === "1" ? one : many}`
    },
  },

  details: {
    title: "Detalhes",
    close: "Fechar detalhes",
    of: (game: string) => `Detalhes de ${game}`,
    more: "Mais",
    moreActions: "Mais ações",
    favorite: "Favorito",
    cover: (game: string) => `Capa de ${game}`,
    myReview: "Minha análise",
    description: "Descrição",
    noDescription: 'Nenhuma descrição ainda. Use "Mais" → "Baixar metadados" para buscar.',
    myRating: "Minha nota",
    play: "Jogar",
    running: "Em execução",
    opening: "Abrindo...",
    playError: (game: string) => `Não deu para abrir ${game}`,
  },

  /** O menu Mais de um jogo. */
  actions: {
    rate: "Avaliar jogo…",
    writeReview: "Escrever análise…",
    editReview: "Editar análise…",
    downloadMetadata: "Baixar metadados",
    addFavorite: "Marcar como favorito",
    removeFavorite: "Tirar dos favoritos",
    showRom: "Mostrar a ROM no Explorador",
    metadataError: "Não deu para baixar os metadados",
    favoriteError: "Não deu para mudar o favorito",
    folderError: "Não deu para abrir a pasta",
  },

  rating: {
    title: (game: string) => `Avaliar ${game}`,
    hint: "Clique na metade de um ícone para dar meia estrela (ou meia pimenta).",
    noRating: "Sem nota",
    noDifficulty: "Sem dificuldade",
    /** "4,5 de 5 estrelas" (a nota já vem no formato do idioma). */
    describe: (kind: "rating" | "difficulty", score: string) =>
      `${score} de 5 ${kind === "rating" ? "estrelas" : "pimentas"}`,
    saveError: "Não deu para salvar a avaliação",
  },

  review: {
    title: (game: string) => `Minha análise de ${game}`,
    hint: "O que você achou do jogo? Deixe em branco para apagar a análise.",
    label: "Minha análise",
    placeholder: "Escreva aqui o que achou: a história, a jogabilidade, o que marcou…",
    saveError: "Não deu para salvar a análise",
  },

  kanban: {
    empty: "Nenhum jogo",
  },

  stats: {
    emptyTitle: "Sem estatísticas ainda",
    emptyDescription: "As estatísticas aparecem quando a biblioteca tiver jogos.",
    summary: "Resumo",
    gamesInLibrary: "Jogos na biblioteca",
    favorites: (count: number) => (count === 1 ? "1 favorito" : `${count} favoritos`),
    inGames: (games: string) => `Em ${games}`,
    average: "Média por jogo jogado",
    neverPlayedCount: (count: number) => (count === 1 ? "1 jogo nunca jogado" : `${count} jogos nunca jogados`),
    playedRecently: "Jogados nos últimos 30 dias",
    topPlayed: "Os 10 mais jogados",
    nothingPlayed: "Nenhum jogo foi jogado ainda.",
    byStatus: "Jogos por status",
    activity: "Atividade nos últimos 30 dias",
    activityDetail: (time: string, days: number) => `${time} em ${days === 1 ? "1 dia" : `${days} dias`}`,
    activityEmpty:
      "Nenhum jogo foi jogado nos últimos 30 dias. O tempo de cada dia conta o que você joga pelo botão Jogar e o que os emuladores registram; o que foi jogado antes disso aparece só nos totais.",
    activityChart: "Tempo jogado por dia, nos últimos 30 dias",
    nothingPlayedDay: "nada jogado",
    day: "Dia",
    byPlatform: "Por plataforma",
    byPlatformLabel: "Jogos por plataforma",
    noPlatform: "Sem plataforma",
    byLibrary: "Por biblioteca",
    byLibraryLabel: "Jogos por biblioteca",
    noLibrary: "Sem biblioteca",
    groupPlayed: (time: string) => `${time} jogadas`,
    groupNothing: "Nada jogado ainda",
    lastPlayed: "Jogados por último",
    neverPlayed: "Nunca jogados",
    andMore: (games: string) => `e mais ${games}`,
    allPlayed: "Todos os jogos já foram jogados.",
  },

  /** Os gráficos de colunas (Estatísticas e Conquistas). */
  charts: {
    today: "Hoje",
    viewAsTable: "Ver em tabela",
  },

  achievements: {
    /** No PS3 são troféus (masculino); no RetroAchievements, conquistas. */
    sources: {
      retroachievements: {
        title: "Conquistas",
        count: (count: number) => (count === 1 ? "1 conquista" : `${count} conquistas`),
        /** "3 de 5 conquistas" */
        countOf: (unlocked: number, total: number) => `${unlocked} de ${total} ${total === 1 ? "conquista" : "conquistas"}`,
        /** "3 de 5 desbloqueadas" */
        unlockedOf: (unlocked: number, total: number) => `${unlocked} de ${total} desbloqueadas`,
        unlocked: "Desbloqueadas",
        latest: "Últimas desbloqueadas",
        all: "Todas",
        seeAll: "Ver todas",
        titleOf: (game: string) => `Conquistas de ${game}`,
        list: "Lista de conquistas",
        progress: "Progresso nas conquistas",
        unlockedToast: "Conquista desbloqueada",
      },
      rpcs3: {
        title: "Troféus",
        count: (count: number) => (count === 1 ? "1 troféu" : `${count} troféus`),
        countOf: (unlocked: number, total: number) => `${unlocked} de ${total} ${total === 1 ? "troféu" : "troféus"}`,
        unlockedOf: (unlocked: number, total: number) => `${unlocked} de ${total} desbloqueados`,
        unlocked: "Desbloqueados",
        latest: "Últimos desbloqueados",
        all: "Todos",
        seeAll: "Ver todos",
        titleOf: (game: string) => `Troféus de ${game}`,
        list: "Lista de troféus",
        progress: "Progresso nos troféus",
        unlockedToast: "Troféu desbloqueado",
      },
    },
    grades: { platina: "Platina", ouro: "Ouro", prata: "Prata", bronze: "Bronze" },
    rarities: { comum: "Comum", rara: "Rara", "muito-rara": "Muito rara", ultrarrara: "Ultrarrara" },
    /** "Ouro: 2" */
    gradeCount: (grade: string, count: number) => `${grade}: ${count}`,
    /** "Ouro: 0 de 3" */
    gradeProgress: (grade: string, unlocked: number, total: number) => `${grade}: ${unlocked} de ${total}`,
    platinum: "Platina",
    points: (points: number) => (points === 1 ? "1 ponto" : `${points} pontos`),
    pointsOf: (points: number, total: number) => `${points} de ${total} pontos`,
    /** "3% dos jogadores" (a porcentagem já vem no formato do idioma). */
    ofPlayers: (percent: string) => `${percent} dos jogadores`,
    locked: "Falta",
    lockedFilter: "Faltam",
    show: "Mostrar",
    showHidden: "Mostrar ocultos",
    hiddenTitle: "Troféu oculto",
    hiddenDescription: "Continue jogando para descobrir.",
    hardcore: "Hardcore",
    /** O aviso de muitas de uma vez: "5 conquistas novas". */
    newGrouped: (count: number, kind: "achievements" | "trophies" | "both") =>
      `${count} ${kind === "achievements" ? "conquistas novas" : kind === "trophies" ? "troféus novos" : "conquistas e troféus novos"}`,

    // A aba Conquistas
    emptyTitle: "Conecte o RetroAchievements",
    emptyDescription:
      "As conquistas vêm da sua conta no RetroAchievements: salve o seu usuário e a Web API Key em Configurações. Os troféus dos jogos de PS3 vêm do RPCS3 e aparecem aqui sozinhos, depois que você jogar.",
    goToSettings: "Ir para Configurações",
    ps3Hint: {
      before: "Os troféus do PS3 vêm do RPCS3. Para as conquistas dos outros consoles, ",
      link: "conecte o RetroAchievements",
      after: ".",
    },
    account: "Conta:",
    updatedAt: (time: string) => `atualizado às ${time}`,
    updating: "Atualizando…",
    update: "Atualizar",
    summary: "Resumo das conquistas",
    unlockedTile: "Conquistas",
    unlockedTileDetail: (total: number, percent: number) => `de ${total} (${percent}%)`,
    platinums: "Platinas",
    platinumsDetail: "Jogos platinados",
    pointsTile: "Pontos",
    pointsTileDetail: "Do RetroAchievements",
    gamesTile: "Jogos com conquistas",
    perDay: "Desbloqueadas por dia",
    last30Days: "Últimos 30 dias",
    perDayChart: "Conquistas desbloqueadas por dia, nos últimos 30 dias",
    perMonth: "Desbloqueadas por mês",
    last12Months: "Últimos 12 meses",
    perMonthChart: "Conquistas desbloqueadas por mês, nos últimos 12 meses",
    chartCount: (count: number) => (count === 1 ? "1 conquista" : `${count} conquistas`),
    chartNone: "nenhuma conquista",
    day: "Dia",
    month: "Mês",
    chartColumn: "Conquistas",
    games: "Jogos",
    gamesList: "Jogos com conquistas",
    searching: "Procurando os jogos da biblioteca no RetroAchievements…",
    noGames: "Nenhum jogo da biblioteca tem conquistas no RetroAchievements ainda.",
    recent: "Desbloqueadas por último",
    recentList: "Conquistas recentes",
    noRecent: "Nenhuma conquista desbloqueada ainda.",
    progressIn: (game: string) => `Progresso em ${game}`,

    // Configurações → Conquistas
    settingsIntro:
      "As conquistas vêm da sua conta no RetroAchievements. Quem desbloqueia são os emuladores (entre na conta em cada um: PCSX2, DuckStation e RetroArch); o app lê o que o site registrou a cada 5 minutos e depois de fechar um jogo, e avisa quando aparece uma conquista nova.",
    settingsTrophies:
      "Os troféus dos jogos de PS3 vêm do próprio RPCS3, sem conta: o app lê o que ele guarda a cada minuto e logo depois de fechar um jogo.",
    serviceDescription: "Conquistas dos jogos de emulador, com a raridade de cada uma.",
    savedUser: (user: string) => `Usuário: ${user}`,
    username: "Usuário",
    apiKey: "Web API Key",
    steps: [
      "Entre no site do RetroAchievements com a mesma conta que você usa nos emuladores (ou crie uma, é grátis).",
      "Abra as configurações da conta (botão abaixo) e procure a seção **Keys**.",
      "Copie a **Web API Key**, cole aqui junto com o seu nome de usuário e clique em Salvar.",
    ],
    openSite: "Abrir as configurações do RetroAchievements",
    neverSynced: "Ainda não atualizou.",
    syncing: "Atualizando as conquistas…",
    lastSync: (date: string) => `Última atualização: ${date}`,
    syncNow: "Atualizar agora",
  },

  emulators: {
    title: "Emuladores",
    description:
      "O app procura os emuladores sozinho, nos atalhos do Menu Iniciar e da Área de Trabalho. Se algum não for encontrado, escolha o executável dele.",
    detectAgain: "Procurar de novo",
    found: "Encontrado",
    notFound: "Não encontrado",
    missing: (path: string) => `Não existe mais: ${path}`,
    /** O RetroArch roda vários consoles. */
    manyConsoles: "Vários consoles (um core para cada)",
    noCores: "Nenhum core instalado",
    cores: (count: number, names: string) => `${count === 1 ? "1 core" : `${count} cores`}: ${names}`,
    change: "Trocar...",
    choose: "Escolher...",
  },

  romFolders: {
    title: "Pastas de ROMs",
    description: "Os jogos de cada pasta (e das subpastas) entram na biblioteca e abrem no emulador escolhido para ela.",
    scanAll: "Procurar jogos em todas",
    empty: "Nenhuma pasta ainda. Adicione a pasta de cada console (ex.: a pasta com as ROMs de PS2).",
    scan: "Procurar",
    scanFolder: (path: string) => `Procurar jogos em ${path}`,
    removeFolder: (path: string) => `Tirar a pasta ${path}`,
    add: "Adicionar pasta",
    newFolder: "Nova pasta de ROMs",
    folder: "Pasta:",
    emulator: "Emulador",
    core: "Core",
    noCoresInstalled: "Nenhum core instalado no RetroArch",
    chooseCore: "Escolha o core",
    console: "Console",
    addAndScan: "Adicionar e procurar jogos",
    scanError: "Não deu para procurar jogos",
    addError: "Não deu para adicionar a pasta",
    newGames: (count: number) => (count === 1 ? "1 jogo novo na biblioteca" : `${count} jogos novos na biblioteca`),
    noNewGames: "Nenhum jogo novo",
    alreadyInLibrary: (count: number) =>
      count === 1 ? "1 jogo já estava na biblioteca." : `${count} jogos já estavam na biblioteca.`,
    nothingFound: "Nenhum jogo encontrado",
    nothingFoundHint: "A pasta não tem arquivos que o emulador escolhido abre.",
    someFailed: "Alguns jogos não foram procurados",
  },

  metadata: {
    intro:
      "A capa dos jogos de emulador vem do libretro-thumbnails, que não pede chave. A descrição, os gêneros, a desenvolvedora, a publicadora e o lançamento vêm do IGDB, e o fundo (mais a capa dos jogos que o libretro-thumbnails não tiver) vem do SteamGridDB. Esses dois são gratuitos, mas cada um pede uma chave, que você cria uma vez só. O ícone de cada jogo na lista é um pedaço da capa.",
    alwaysOn: "Sempre ligado",
    libretroDescription: "As capas oficiais que o RetroArch usa (a caixa escaneada), achadas pelo nome exato da ROM.",
    noKeyNeeded: "Não precisa de chave.",
    igdbDescription: "Descrição, gêneros, desenvolvedora, publicadora e lançamento.",
    igdbSteps: [
      "Entre na Twitch (ou crie uma conta grátis) e ligue a **verificação em duas etapas**, em Configurações → Segurança e privacidade. A Twitch exige isso para criar aplicativos.",
      "Abra o console de desenvolvedor (botão abaixo) e clique em **Registrar seu aplicativo** (Register Your Application).",
      "Preencha: **Nome**: um nome que ninguém usou ainda (ex.: Playtrove + o seu nome); **URL de redirecionamento OAuth**: http://localhost; **Categoria**: Application Integration; **Tipo de cliente**: Confidencial. Clique em Criar.",
      "Clique em **Gerenciar** no aplicativo criado, copie o Client ID e clique em **Novo segredo** (New Secret) para gerar o Client Secret.",
      "Cole os dois aqui e clique em Salvar.",
    ],
    igdbLink: "Abrir o console da Twitch",
    sgdbDescription: "Capa, ícone e imagem de fundo, feitos pela comunidade.",
    keySaved: "Chave salva.",
    apiKey: "Chave da API",
    sgdbSteps: [
      "Abra o SteamGridDB (botão abaixo) e entre com a sua conta da Steam (**Login**, no alto da página).",
      "Na página de API das preferências, clique em **Generate API Key**.",
      "Copie a chave, cole aqui e clique em Salvar.",
    ],
    sgdbLink: "Abrir a página da chave",
    autoDownload: "Baixar sozinho para os jogos novos",
    autoDownloadHint: "Quando uma pasta de ROMs é procurada e encontra jogos novos.",
    allHaveMetadata: "Todos os jogos já têm metadados.",
    missing: (games: string) => `${games} ainda sem metadados.`,
    redownload: "Baixar de novo para todos",
    redownloadHint: "Busca tudo de novo, inclusive as capas, para todos os jogos",
    download: "Baixar metadados",
    downloading: (position: number, total: number) => `Baixando ${position} de ${total}...`,
    nothingToDownload: "Nada para baixar",
    downloadError: "Não deu para baixar os metadados",
    /** Na barra do topo: "Metadados 3/7". */
    badge: "Metadados",
    progressLabel: (position: number, total: number) => `Baixando metadados: ${position} de ${total}`,
    downloadingGame: (game: string) => `Baixando: ${game}`,
    downloadingAll: "Baixando metadados",
    /** O aviso do fim de uma leva. */
    notFoundList: (list: string) => `Não encontrados: ${list}.`,
    downloadedFor: (count: number) =>
      count === 1 ? "Metadados baixados para 1 jogo" : `Metadados baixados para ${count} jogos`,
    notFoundOne: "O jogo não foi encontrado",
    notFoundMany: (games: string) => `${games} não encontrados`,
    checkNames: (list: string) => `${list}. Confira se o nome do jogo está certo.`,
    someFailed: "Alguns metadados não foram baixados",
  },

  /** Os cartões dos serviços com chave (metadados e conquistas). */
  services: {
    configured: "Configurado",
    notConfigured: "Não configurado",
    keysOf: (service: string) => `Chaves do ${service}`,
    checking: "Conferindo...",
    howToGetKeys: "Como conseguir as chaves",
    howToGetKey: "Como conseguir a chave",
  },

  statuses: {
    intro: "Os status são as colunas do Kanban, nesta ordem.",
    list: "Status",
    nameOf: (status: string) => `Nome do status ${status}`,
    moveUp: (status: string) => `Subir ${status}`,
    moveDown: (status: string) => `Descer ${status}`,
    deleteOf: (status: string) => `Apagar ${status}`,
    confirmDelete: (status: string) => `Apagar “${status}”?`,
    moveGames: (count: number) => (count === 1 ? "O jogo dele vai para" : `Os ${count} jogos dele vão para`),
    receiver: "Status que recebe os jogos",
    newName: "Nome do novo status",
    newPlaceholder: "Novo status",
    rules: "Regras automáticas",
    newGameRule: "Jogo novo entra em",
    firstPlayRule: "Ao ser jogado pela primeira vez, vai para",
  },

  /** Os status que vêm com o app: o nome muda com o idioma, até o usuário renomear. */
  statusPresets: {
    planToPlay: "Planejo jogar",
    onHold: "Parei por um tempo",
    abandoned: "Abandonei",
    playing: "Jogando",
    goingFor100: "Fazendo 100%",
    goingForPlatinum: "Platinando",
    beaten: "Zerado",
    complete100: "100%",
    platinum: "Platinado",
  },

  settings: {
    general: "Geral",
    language: "Idioma",
    languageHint: "Na primeira vez, o app usa o idioma do Windows.",
    statuses: "Status",
    metadata: "Metadados",
    achievements: "Conquistas",
    about: "Sobre",
    version: (version: string) => `Versão ${version}`,
    reportBug: "Reportar um problema",
  },

  /** A atualização do app: o aviso de versão nova e Configurações → Sobre. */
  updates: {
    available: (version: string) => `Versão ${version} disponível`,
    installHint: "O app baixa a versão nova, instala e abre de novo.",
    portableHint: "Baixe a versão nova na página do Playtrove.",
    install: "Atualizar",
    download: "Baixar",
    later: "Agora não",
    downloading: (percent: number) => `Baixando a atualização… ${percent}%`,
    ready: "Instalando e abrindo de novo…",
    checkNow: "Procurar atualizações",
    checking: "Procurando…",
    latest: "Esta é a versão mais recente.",
    error: "Não deu para procurar agora. Confira a internet e tente de novo.",
    unsupported: "Rodando pelo código-fonte: a atualização automática só vale no app instalado.",
    autoCheck: "Procurar versão nova ao abrir o app",
  },

  /** Os gêneros do IGDB (guardados como vêm de lá, em inglês). Os que não estão aqui aparecem como vieram. */
  genres: {
    Adventure: "Aventura",
    Arcade: "Arcade",
    "Card & Board Game": "Cartas e tabuleiro",
    Fighting: "Luta",
    "Hack and slash/Beat 'em up": "Hack and slash",
    Indie: "Indie",
    MOBA: "MOBA",
    Music: "Música",
    Pinball: "Pinball",
    Platform: "Plataforma",
    "Point-and-click": "Point-and-click",
    Puzzle: "Quebra-cabeça",
    "Quiz/Trivia": "Quiz",
    Racing: "Corrida",
    "Real Time Strategy (RTS)": "Estratégia em tempo real",
    "Role-playing (RPG)": "RPG",
    Shooter: "Tiro",
    Simulator: "Simulação",
    Sport: "Esporte",
    Strategy: "Estratégia",
    Tactical: "Tático",
    "Turn-based strategy (TBS)": "Estratégia por turnos",
    "Visual Novel": "Visual novel",
  } as Record<string, string>,

  /** Os erros que o processo principal manda para a tela. */
  errors: {
    invalidId: "Id inválido.",
    invalidValue: "Valor inválido.",
    invalidOrder: "Ordem inválida.",
    invalidText: "Texto inválido.",
    invalidGameList: "Lista de jogos inválida.",
    invalidEvaluation: "Avaliação inválida.",
    invalidRating: "Nota inválida.",
    invalidDifficulty: "Dificuldade inválida.",
    invalidReview: "Análise inválida.",
    /** O número já vem no formato do idioma ("10.000"). */
    reviewTooLong: (max: string) => `A análise pode ter até ${max} caracteres.`,
    invalidAccount: "Conta inválida.",
    invalidLanguage: "Idioma inválido.",
    raUsername: "Preencha o nome de usuário do RetroAchievements.",
    fillIn: (field: string) => `Preencha ${field}.`,
    tooLong: (field: string) => `Confira ${field}: o texto está grande demais.`,
    /** Os campos das chaves, para as duas mensagens acima. */
    keyFields: {
      steamGridDbKey: "a chave do SteamGridDB",
      raApiKey: "a Web API Key",
      igdbClientId: "o Client ID",
      igdbClientSecret: "o Client Secret",
    },
    unknownEmulator: "Emulador desconhecido.",
    gameNotFound: "Jogo não encontrado.",
    noRom: "Esse jogo não tem ROM.",
    romNotFound: (path: string) => `A ROM não foi encontrada: ${path}`,
    alreadyRunning: "Esse jogo já está aberto.",
    notFromRomFolder: "Esse jogo não tem ROM: ele não veio de uma pasta de ROMs.",
    emulatorNotFound: (emulator: string) => `O ${emulator} não foi encontrado. Configure ele na aba Emuladores.`,
    launchFailed: (emulator: string, reason: string) => `Não deu para abrir o ${emulator}: ${reason}`,
    statusNotFound: "Status não encontrado.",
    statusOrder: "A nova ordem precisa ter todos os status, uma vez cada.",
    chooseOtherStatus: "Escolha outro status para receber os jogos.",
    statusNameEmpty: "O status precisa de um nome.",
    statusNameTooLong: (max: number) => `O nome pode ter até ${max} letras.`,
    statusNameTaken: (status: string) => `Já existe um status chamado "${status}".`,
    chooseEmulator: "Escolha um emulador.",
    folderMissing: "Essa pasta não existe.",
    chooseCore: "Escolha o core do RetroArch para essa pasta.",
    typeConsole: "Escreva o console dos jogos dessa pasta.",
    folderAlreadyAdded: "Essa pasta já está na lista.",
    folderGone: (path: string) => `A pasta ${path} não existe mais.`,
    coreMissing: (core: string, path: string) => `O core ${core} não foi encontrado no RetroArch (pasta ${path}).`,
    noConnection: (service: string) => `Não deu para falar com o ${service}. Confira a conexão com a internet.`,
    igdbWrongKeys: "O Client ID ou o Client Secret do IGDB estão errados.",
    twitchError: (status: number) => `A Twitch respondeu com o erro ${status}. Tente de novo mais tarde.`,
    igdbNoToken: "A Twitch não devolveu o token de acesso do IGDB.",
    igdbRefused: "O IGDB recusou o acesso. Confira o Client ID e o Client Secret.",
    igdbError: (status: number) => `O IGDB respondeu com o erro ${status}.`,
    steamGridDbWrongKey: "A chave do SteamGridDB está errada.",
    steamGridDbError: (status: number) => `O SteamGridDB respondeu com o erro ${status}.`,
    steamGridDbRefused: "O SteamGridDB não aceitou o pedido.",
    noMetadataServices: "Configure o IGDB ou o SteamGridDB em Configurações → Metadados.",
    /** O nome de um jogo que não deu para ler. */
    gameFallback: (id: number) => `Jogo ${id}`,
    raWrongKey: "O RetroAchievements não aceitou a chave. Confira o usuário e a Web API Key em Configurações.",
    raRateLimited: "O RetroAchievements pediu para esperar um pouco. O app tenta de novo daqui a alguns minutos.",
    raError: (status: number) => `O RetroAchievements respondeu com erro ${status}.`,
    raUserNotFound: (user: string) => `Não achei o usuário "${user}" no RetroAchievements.`,
    cantProtectKey: "O Windows não deixou guardar a chave com segurança neste computador.",
  },

  /** As janelas do Windows que o app abre. */
  dialogs: {
    pickEmulator: (emulator: string) => `Escolha o executável do ${emulator}`,
    programs: "Programas",
    pickRomFolder: "Escolha a pasta com as ROMs",
    startupError: "Erro ao iniciar o Playtrove",
    repairedTitle: "Banco de dados consertado",
  },

  /** O aviso de quando o banco estava danificado e foi consertado ao abrir. */
  repair: {
    message: "O banco de dados da biblioteca estava danificado e foi consertado.",
    recovered: (tables: string) => `Recuperado: ${tables}.`,
    nothingRecovered: "Não deu para recuperar nenhuma parte do banco.",
    lost: (table: string, effect: string) => `Não deu para recuperar: ${table}. Por isso, ${effect}.`,
    damagedFile: (path: string) => `O arquivo danificado foi guardado em: ${path}`,
    /** O nome de cada tabela para o usuário. */
    tables: {
      statuses: "status",
      games: "jogos",
      emulators: "emuladores",
      rom_folders: "pastas de ROMs",
      settings: "configurações e chaves",
      play_sessions: "sessões de jogo",
      ra_catalog: "catálogo do RetroAchievements",
      ra_games: "jogos do RetroAchievements",
      achievements: "conquistas",
      trophy_sets: "conjuntos de troféus do RPCS3",
      trophies: "troféus do RPCS3",
    },
    /** O que acontece com cada tabela que não deu para recuperar. */
    effects: {
      statuses: "os status voltaram ao padrão (os jogos com um status que sumiu foram para o de jogo novo)",
      games: "os jogos saíram da biblioteca (procure as pastas de ROMs de novo, na aba Emuladores)",
      emulators: "os emuladores vão ser procurados de novo",
      rom_folders: "as pastas de ROMs precisam ser adicionadas de novo (aba Emuladores)",
      settings: "as configurações voltaram ao padrão e as chaves de metadados precisam ser salvas de novo",
      play_sessions: "a atividade por dia das Estatísticas recomeça do zero (o tempo total dos jogos fica)",
      ra_catalog: "o catálogo do RetroAchievements vai ser baixado de novo",
      ra_games: "as conquistas vão ser buscadas de novo no RetroAchievements",
      achievements: "as conquistas vão ser buscadas de novo no RetroAchievements",
      trophy_sets: "os troféus vão ser lidos de novo do RPCS3",
      trophies: "os troféus vão ser lidos de novo do RPCS3",
    },
  },
}

/** O formato de um dicionário do app (o do português é o modelo). */
export type Messages = typeof ptBR
