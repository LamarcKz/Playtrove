# Estrutura do projeto

Guia de onde fica cada coisa no Playtrove e de qual arquivo abrir para criar cada funcionalidade nova.

Para trabalhar no projeto, Codex e Claude Code usam o mesmo guia de regras técnicas: `CLAUDE.md` (o estado do projeto e as notas do mantenedor ficam fora do repositório). O Codex começa pelo `AGENTS.md`, que orienta a leitura integral desse guia e a consulta a este mapa, sem manter uma segunda cópia das regras.

## A ideia geral: 2 partes que conversam

O app é feito com o **Tauri**: uma janela do Windows com a interface dentro (o WebView2, o mesmo motor do Edge) e a parte de trás em **Rust**. As duas partes trocam mensagens:

```text
 src/renderer (React)              lib/tauriApi.ts             src-tauri (Rust)
┌───────────────────────┐        ┌───────────────┐        ┌──────────────────────────┐
│ INTERFACE             │ window │ PONTE         │ invoke │ PARTE DE TRÁS            │
│ telas, botões, grid,  │ ─.api─►│ cada função   │ ──────►│ janela, banco SQLite,    │
│ lista de jogos        │ ◄───── │ vira um       │ ◄──────│ arquivos, abrir jogos,   │
│                       │ avisos │ comando       │  emit  │ internet, controle       │
└───────────────────────┘        └───────────────┘        └──────────────────────────┘
```

- **Rust** (`src-tauri`): o "motor" do app. Cria a janela e é o único que mexe no banco, no disco, na internet e no Windows. Cada coisa que a interface pede é um **comando** (`src-tauri/src/commands.rs`).
- **interface** (`src/renderer`): o React. É uma página web dentro da janela e, por segurança, só fala com o Rust pelos comandos.
- **ponte** (`src/renderer/lib/tauriApi.ts`): monta o `window.api`, em que cada função chama o comando do Rust de mesmo nome (em snake_case: `games.setStatus` → `games_set_status`) e cada `on...` ouve um aviso do Rust.
- **shared** (`src/shared`): os tipos e textos que a interface usa, no mesmo formato do que o Rust manda (o `Game`, os dicionários...). Os textos que o Rust mostra saem dos mesmos dicionários (`npm run tauri:mensagens` gera o `src-tauri/messages.json`).

Os comandos de hoje (o nome do comando no Rust, e quem chama na interface):

| Comando | Quem usa | O que faz |
|---|---|---|
| `app_version` | `SettingsPage.tsx` (seção "Sobre") | A versão do app (a do `package.json`) |
| `app_get_language` e `app_set_language` | `I18nProvider.tsx` e `SettingsPage.tsx` (Configurações → Geral) | O idioma do app e a troca dele (o Rust guarda a escolha e avisa que a biblioteca mudou, porque o nome dos status padrão muda junto) |
| `app_open_link` | `ServiceCard.tsx` (Configurações → Metadados e Conquistas) | Abre no navegador uma das páginas de `EXTERNAL_LINKS` (onde criar as chaves e a página de download das versões). A interface manda só o nome; o Rust não abre nenhum outro endereço (`links.rs`) |
| `app_report_bug` | `SettingsPage.tsx` (Configurações → Sobre) | Abre no navegador o formulário de bug do GitHub, com a versão do app e a do Windows preenchidas (`links.rs`) |
| `window_minimize`, `window_toggle_maximize`, `window_close` e `window_get_state` | `TopBar.tsx` e `hooks/useFullscreen.ts` | Minimizar, maximizar/restaurar e fechar; consultar `isMaximized`, `isFullscreen` e `isFocused` nativos |
| `window_set_fullscreen` | `hooks/useFullscreen.ts` | Entra/sai da tela cheia nativa e devolve o estado reconciliado; o Windows restaura a posição e o estado anteriores |
| `fullscreen_get_config` e `fullscreen_set_config` | `hooks/useFullscreen.ts` e `fullscreen/FullscreenPreferences.tsx` | Leem/gravam início em tela cheia, reprodução e volume próprios desse modo, onde abrir (Hub ou biblioteca) e o perfil (nome e avatar), com validação integral do patch e transação |
| `library_get` | `hooks/useLibrary.ts` | A biblioteca inteira: jogos, status e regras |
| `games_set_status` | `hooks/useLibrary.ts` (Kanban) | Salva o status novo de um jogo |
| `statuses_create`, `statuses_rename`, `statuses_reorder`, `statuses_remove` e `statuses_set_rules` | `StatusSettings.tsx` | Criam, renomeiam, mudam a ordem e apagam status, e trocam as regras automáticas |
| `emulators_list`, `emulators_detect`, `emulators_pick_path` e `emulators_cores` | `hooks/useEmulators.ts` (aba Emuladores) | Os emuladores e onde está cada um (na primeira vez, o Rust procura sozinho), procurar de novo, escolher o executável numa janela do Windows e os cores do RetroArch |
| `rom_folders_list`, `rom_folders_pick`, `rom_folders_add`, `rom_folders_remove` e `rom_folders_scan` | `hooks/useEmulators.ts` e `RomFolderList.tsx` | As pastas de ROMs: listar, escolher uma pasta numa janela do Windows, adicionar, tirar e procurar jogos nelas |
| `games_play` e `games_get_running` | `PlayButton.tsx` e `hooks/useRunningGames.ts` | Abre o jogo no emulador (responde quando ele abriu, ou com a mensagem do problema) e os jogos abertos agora |
| `games_set_favorite` e `games_show_rom` | `GameActionsMenu.tsx` (menu "Mais") | Marcam ou desmarcam o favorito e mostram a ROM no Explorador de Arquivos |
| `games_pick_background_video`, `games_remove_background_video` e `games_use_automatic_background_video` | `GameActionsMenu.tsx` (menu "Mais") | Escolhem um MP4/WebM e guardam uma cópia com prioridade manual, removem a cópia interna e desativam o automático, ou reativam e enfileiram a busca do trailer |
| `games_pick_theme_music`, `games_remove_theme_music` e `games_use_automatic_theme_music` | `GameActionsMenu.tsx` (menu "Mais") | Importam MP3/M4A/WAV de até 32 MiB, removem a cópia interna e desativam a música automática, ou reativam e enfileiram uma busca |
| `music_get_config`, `music_set_config` e `music_download` | `hooks/useMusicConfig.ts`, `MusicSettings.tsx` e `LibraryThemeMusic.tsx` | Preferências de reprodução/volume/automático e repetição explícita de músicas ausentes, preservando escolhas manuais |
| `music_get_reviews`, `music_search`, `music_preview`, `music_choose` e `music_cancel_preview` | `MusicReviewPanel.tsx`, `MusicReviewDialog.tsx` e `musicPreviewPlayer.ts` | Revisões persistidas, pesquisa textual, audição temporária sob demanda, confirmação prioritária e cancelamento |
| `games_set_evaluation` | `RatingDialog.tsx` e `ReviewDialog.tsx` (menu "Mais") | Muda só as partes enviadas da avaliação: a nota e a dificuldade, ou a análise (o Rust confere os valores: de 1 a 10, ou vazio) |
| `metadata_get_config`, `metadata_set_igdb`, `metadata_set_steam_grid_db` e `metadata_set_auto_download` | `MetadataSettings.tsx` (Configurações → Metadados) | O que está configurado (sem as chaves), salvar as chaves (o Rust confere antes, com um pedido de teste) e ligar ou desligar o download sozinho para jogos novos |
| `metadata_download` e `metadata_get_progress` | `MetadataSettings.tsx`, `GameActionsMenu.tsx` e `hooks/useMetadataProgress.ts` | Leva única de metadados/trailers/música; sem ids considera ausências e, se só faltar música, não refaz imagens/descrição. Ação explícita inclui música mesmo com automático desligado; progresso termina antes da revisão humana |
| `stats_daily_playtime` | `pages/StatsPage.tsx` | O tempo jogado em cada um dos últimos 30 dias (das sessões guardadas no banco) |
| `achievements_get_config` e `achievements_set_account` | `hooks/useAchievements.ts` e `AchievementsSettings.tsx` (Configurações → Conquistas) | A conta do RetroAchievements (o nome e a situação da atualização; a chave nunca volta) e salvar ou tirar a conta (o Rust confere no site antes de salvar) |
| `achievements_sync` | Botões "Atualizar" (aba Conquistas e Configurações) | Busca agora as conquistas de todos os jogos |
| `achievements_game` e `achievements_overview` | `hooks/useAchievements.ts` | As conquistas de um jogo (o cartão dos Detalhes e a janela "Ver todas") e tudo o que a aba Conquistas mostra |
| `updates_get_status`, `updates_check`, `updates_install` e `updates_set_auto_check` | `hooks/useUpdates.ts`, `UpdateNotice.tsx` e `UpdateSettings.tsx` (Configurações → Sobre) | A atualização do app: a situação, procurar agora, instalar a versão encontrada (baixa, fecha, instala e abre de novo; na portátil, abre a página de download) e ligar ou desligar a procura ao abrir |
| `controllers_list` | `hooks/useControllers.ts` | Os controles conectados (DualSense), com a bateria |
| `controllers_get_input` e `controllers_set_input_enabled` | `hooks/useFullscreenInput.ts` | Snapshot de entrada e habilitação opt-in do leitor rápido; o Rust exige tela cheia nativa, foco e nenhum jogo em execução |

E os avisos do Rust para a interface (`EVENTS`, em `src/shared/ipc.ts`):

| Aviso | Quem ouve | Quando chega |
|---|---|---|
| `window:state` | `TopBar.tsx`, `hooks/useFullscreen.ts` e `hooks/useFullscreenInput.ts` | Mudaram maximização, tela cheia ou foco nativo da própria janela; o foco considera o HWND em primeiro plano, incluindo o WebView interno |
| `fullscreen:config` | `hooks/useFullscreen.ts` | Preferências próprias de início, reprodução ou volume da tela cheia mudaram |
| `library:changed` | `hooks/useLibrary.ts` | Algo mudou na biblioteca: a interface pede os dados de novo |
| `games:running` | `hooks/useRunningGames.ts` | Um jogo abriu ou fechou |
| `metadata:progress` | `hooks/useMetadataProgress.ts` | A cada passo da fila de metadados |
| `music:config` | `hooks/useMusicConfig.ts` | Reprodução, volume ou busca automática de música mudaram |
| `achievements:status` e `achievements:unlocked` | `hooks/useAchievements.ts` e `AchievementNotifier.tsx` | Começou ou terminou de atualizar as conquistas, e as conquistas novas (para o aviso no canto) |
| `updates:status` | `hooks/useUpdates.ts` | A situação da atualização do app mudou |
| `controllers:changed` | `hooks/useControllers.ts` | Um controle conectou ou desconectou, ou a bateria mudou |
| `controllers:input` | `hooks/useFullscreenInput.ts` | Mudou o snapshot de botões, com `sequence`, `generation` e `controllerKey`; reconexão/reativação exigem neutralidade |

Só nos testes automáticos, o Rust tem também os comandos `test_*` (`src-tauri/src/test_hooks.rs`), que fora deles não fazem nada.

## Como a tela está dividida

```text
 logo  [busca] [filtros] | [detalhes][grade][lista][kanban]  (arrastar)  🎮 USB 🔋100%  ─  ☐  ✕   ← TopBar
      ╭────────────────────────────────────────────────────────┬─────────────
  ▤   │ página atual                                           │ painel de     ← main (App.tsx)
  📊  │ Biblioteca: modo Detalhes (lista + detalhes grandes),  │ filtros (abre
  🏆  │ o principal; modo Grade (capas), modo Lista (linhas    │ e fecha pelo
  🕹  │ com colunas) ou modo Kanban (uma coluna por status)    │ botão)
  ⚙   │                                                        │
 Sidebar (só ícones)
```

- A barra do topo e o menu lateral têm a mesma cor e não têm linha entre eles: formam uma moldura, e a página fica encaixada nela, com o canto arredondado.
- **Filtros:** o botão ao lado da busca abre o painel de filtros na direita, como no Playnite (`FilterPanel.tsx`). Favoritos e Recentes ficam em caixinhas no topo; embaixo, cada filtro é um seletor, um campo que abre a lista de opções com caixinhas. Dá para marcar várias opções, e o campo mostra as marcadas. Cada opção mostra quantos jogos ela tem. Os filtros são Status, Tempo jogado, Nota, Dificuldade, Biblioteca, Plataforma e, com os metadados, Gênero, Desenvolvedora, Publicadora e Ano de lançamento; um filtro sem dados em nenhum jogo aparece desativado. Dentro de um filtro vale "ou" (Jogando ou Zerado); entre filtros vale "e" (favorito e jogando). Favoritos e Recentes são filtros, e não abas. Com o painel fechado, os filtros continuam valendo (o botão mostra um pontinho azul).
- **Busca:** acha o jogo por qualquer pedaço do nome, sem ligar para maiúsculas ou acentos ("cronicas" acha "Crônicas").
- **Kanban:** cada coluna é um status do jogo (Planejo jogar, Jogando, Zerado...), e arrastar um jogo para outra coluna muda o status dele. As 9 colunas dividem a largura da tela, sem rolar para os lados. Os status não têm cor: aparecem só com o nome, em todo o app. Os filtros valem em todos os modos: no Kanban, eles escolhem quais jogos aparecem, e o filtro de status escolhe quais colunas aparecem.
- Na Grade, na Lista e no Kanban, clicar num jogo abre o painel de detalhes à direita. No Kanban, ele abre por cima do quadro, para não espremer as colunas. Trocar de modo fecha o painel (o jogo continua destacado).
- Nas abas Estatísticas, Conquistas, Emuladores e Configurações, o meio da barra do topo mostra o nome da página em vez da busca.
- **Estatísticas:** o resumo no topo (jogos, tempo jogado, média, jogados nos últimos 30 dias), os 10 mais jogados, os jogos por status, por plataforma e por biblioteca, o gráfico da atividade dos últimos 30 dias (passe o mouse numa coluna para ver o dia; "Ver em tabela" mostra os mesmos números), os jogados por último e os nunca jogados.
- **Conquistas:** com a conta do RetroAchievements salva em Configurações, os jogos achados no site mostram o troféu com o progresso ("3/6") na lista da esquerda, na Grade e na coluna Conquistas da Lista, e os Detalhes ganham um cartão à direita do título (o progresso, os troféus de cada tipo, as últimas insígnias e "Ver todas"). Tudo segue o padrão dos troféus do PS3: bronze, prata, ouro e platina, com pegos e total; no RetroAchievements, o tipo sai dos pontos (bronze até 9, prata até 24, ouro com 25 ou mais) e a platina é ter todas. A aba Conquistas tem o resumo (conquistas, platinas, pontos e jogos), os gráficos por dia e por mês, os jogos (do desbloqueio mais recente para o mais antigo, com os troféus de cada tipo) e as desbloqueadas por último. A raridade (pela porcentagem de jogadores do site, como na PlayStation: comum, rara, muito rara e ultrarrara) aparece em texto na linha de cada conquista. Conquista nova vira um aviso no canto.
- **Troféus do PS3:** com o RPCS3 configurado na aba Emuladores, os jogos de PS3 mostram os troféus que ele guarda, sem conta: o cartão dos Detalhes ("Troféus") tem quantos de cada tipo (bronze, prata, ouro e platina, nas cores do PS3; antes da primeira vez que o jogo abre no RPCS3, só o aviso de quando eles aparecem), e a janela "Ver todos" esconde os troféus ocultos que faltam até clicar em "Mostrar ocultos". Na aba Conquistas, eles entram junto com as do RetroAchievements.
- **Emuladores:** a aba mostra onde está cada emulador (PCSX2, DuckStation, RetroArch, RPCS3, PPSSPP, Dolphin e Azahar; o app procura sozinho nos atalhos do menu Iniciar e da Área de Trabalho e nas pastas vizinhas aos que já achou) e as pastas de ROMs. Cada pasta diz qual emulador abre os jogos dela (e qual core, no RetroArch) e de qual console eles são; o app sugere tudo pelo nome da pasta. "Procurar" coloca na biblioteca as ROMs que ainda não estão nela. Os avisos rápidos (no canto de baixo, à direita) contam o que aconteceu.
- **Jogar:** abre a ROM no emulador da pasta dela, com a configuração do próprio emulador (o app não força tela cheia). O RetroArch abre maximizado, em janela (se ele estiver em tela cheia na configuração dele, fica assim). Enquanto o emulador está aberto, o botão mostra "Em execução"; quando ele fecha, o tempo jogado e a última vez jogado são atualizados. O app também mostra o tempo que os emuladores registram por conta própria, para o que foi jogado fora dele aparecer. Na primeira vez, o jogo sai de "Planejo jogar" e vai para "Jogando" (regra automática de Configurações → Status).
- **Imagens e metadados:** no modo Detalhes, a lista mostra o ícone de cada jogo (sem ícone, um pedaço da capa), e a área grande mostra a arte de fundo, a capa acima do nome, a descrição e as informações (gênero, desenvolvedora, publicadora, lançamento). A Grade centraliza as capas inteiras em áreas iguais 2:3; o painel lateral mostra o fundo atrás da capa na proporção original. Sem imagem, aparece o desenho padrão (um controle num degradê). Com o IGDB configurado, a fila baixa também um trailer do YouTube para os Detalhes. O menu "Mais" baixa os metadados de um jogo, marca como favorito, escolhe um vídeo local com prioridade sobre o trailer, remove e desativa o vídeo ou reativa o trailer automático, e mostra a ROM na pasta. O vídeo se repete sem som apenas nos Detalhes, com pausa automática ao ocultar a janela, movimento reduzido e imagem de reserva. Enquanto os metadados são baixados, a barra do topo mostra "Metadados 3/7".
- **Música tema:** um único áudio acompanha o jogo selecionado em Detalhes, Grade, Lista e Kanban do desktop, com reprodução e volume em Configurações → Geral. A faixa salva toca offline, com transições suaves; janela inativa, jogo aberto, saída da Biblioteca e entrada em tela cheia interrompem esse player. A tela cheia tem preferências e player próprios. Metadados reúne a busca automática e a revisão das músicas. A fila também busca temas junto dos metadados. O menu "Mais" importa MP3/M4A/WAV, remove a cópia e desativa o automático ou reativa a busca. A seleção automática no YouTube é conservadora e pode terminar sem resultado; escolhas manuais ficam preservadas.
- **Controle:** com um DualSense conectado, a barra do topo mostra por onde ele está ligado (USB ou Bluetooth), a bateria e se ela está carregando (em verde). Passando o mouse, aparece tudo por extenso. Sem controle, não aparece nada.
- **Tela cheia:** substitui a moldura desktop por uma biblioteca horizontal e Detalhes Signature. Todos, Recentes e Favoritos guardam seleção própria durante a sessão; a busca por título consulta todos os jogos, ignorando maiúsculas/acentos. Os painéis de opções, conquistas, preferências e teclado virtual restringem o foco ao escopo atual. Favorito, status, avaliação e análise gravam os mesmos dados do desktop. A preferência de iniciar em tela cheia e o áudio próprio ficam em Configurações → Geral e no painel fullscreen. Durante a execução de um jogo, input e mídia ficam suspensos; o lançamento é serializado, consulta os jogos em execução e retorna ao mesmo jogo nos detalhes. O desktop mantém seu estado oculto e restaura foco ao sair. A configuração de emuladores/pastas continua no desktop.
- **Idiomas:** o app inteiro em português e inglês. O idioma fica em Configurações → Geral e muda na hora, sem reabrir; na primeira vez, vale o do Windows (português → português; qualquer outro → inglês). Os status que vêm com o app mudam de nome junto (Planejo jogar → Plan to play), e os criados ou renomeados ficam como o usuário escreveu. Os nomes dos jogos, as descrições do IGDB, as conquistas do RetroAchievements e os troféus do RPCS3 vêm de fora e não mudam.

## Pastas e arquivos

### Raiz do projeto

| Arquivo | O que faz |
|---|---|
| `package.json` | Nome, versão (a que aparece em Configurações e no instalador), dependências e comandos (`npm run ...`) |
| `vite.config.ts` | A interface: servida pelo Vite no endereço fixo 1420 no `npm run dev` (`npm run web:dev`, que o Tauri chama) e gerada em `out/web` (`npm run web:build`), que vai dentro do app. Também os atalhos de import `@/` e `@shared/` |
| `tsconfig.json` | Junta as configurações do TypeScript abaixo |
| `tsconfig.node.json` | TypeScript do `vite.config.ts` |
| `tsconfig.web.json` | TypeScript da interface: `src/renderer` e `src/shared` |
| `tsconfig.test.json` | TypeScript dos testes e dos scripts |
| `components.json` | Configuração do shadcn/ui, usada pelo comando `npx shadcn add` |
| `.gitignore` | O que o Git deve ignorar (`node_modules`, `out`, `dist`, o que o Rust compila em `src-tauri/target`...) |
| `.gitattributes` | Faz o Git guardar os arquivos de texto sempre com o mesmo tipo de quebra de linha (LF) |
| `.githooks/` | Travas do Git: impedem commit e envio direto na `main` (ver "Histórico e versões") e commit com dados pessoais, pelos padrões de uma lista fora do Git (ver "Privacidade" no `CLAUDE.md`) |
| `.claude/settings.json` | Configuração do Claude Code para o projeto: os comandos liberados sem perguntar (leitura, conferência de tipos, build e testes rápidos) e os bloqueados pelo guia (ver "Convenções de código" no `CLAUDE.md`). A pasta `.claude/worktrees/` e o `settings.local.json` são só deste computador e ficam fora do Git |
| `scripts/next-version.mjs` | O comando `npm run versao`: diz qual deve ser a próxima versão, pelos commits desde a última, e monta o rascunho das notas |
| `scripts/backend-messages.mjs` | O comando `npm run tauri:mensagens`: gera o `src-tauri/messages.json`, com as partes dos dicionários que o Rust usa (nomes dos status padrão, erros e janelas do Windows), nos dois idiomas. As funções viram modelos com `{0}`, `{1}`... O `tests/unit/backendMessages.test.ts` acusa quando o arquivo ficou para trás |
| `scripts/dev-library.mjs` | O comando `npm run dev:nova-copia`: joga fora a cópia da biblioteca do `npm run dev` (`%APPDATA%\Playtrove Dev`), só com ele fechado; o próximo `npm run dev` copia de novo a do app instalado |
| `scripts/dist.mjs` | O comando `npm run dist`: gera em `dist/` o instalador (`Playtrove-Setup-X.Y.Z.exe`, assinado com a chave do projeto), a versão portátil (`Playtrove-X.Y.Z-portable.zip`, só o `Playtrove.exe` e o `portable.txt`), o `latest.json` (o que o app lê para se atualizar, com a assinatura) e o `latest.yml` (o que o app em Electron, até a 0.7.x, lê: ele aponta para o instalador novo, e é assim que quem tem a 0.7.x passa para o app em Tauri) |
| `scripts/release-build-env.mjs` | Prepara as flags do build de release Windows x64 do Tauri a partir das flags de ambiente (encoded, `RUSTFLAGS`, target e build, nessa prioridade), remapeia perfil e repositório para `/build/user` e `/build/app`, e limita o caminho do PDB ao nome do arquivo. Usa `CARGO_ENCODED_RUSTFLAGS` sem alterar o ambiente do processo chamador; substitui as `rustflags` de arquivos Cargo, que precisam ser fornecidas por `RUSTFLAGS` ou encoded para serem mantidas |
| `scripts/build-test-app.mjs` | Compila o app dos testes (o build de desenvolvimento do Tauri, com a interface embutida) em `src-tauri/target/testes`. O `npm run test:app` roda ele antes do Playwright |
| `build/` | O ícone (`icon.ico`, com todos os tamanhos do Windows: o .exe, o instalador e a janela) e o `portable.txt` que vai no .zip da versão portátil |
| `tests/unit/` | Testes rápidos da lógica da interface (Vitest), sem abrir o app: filtros, datas, estrelas e pimentas, as contas das Estatísticas, a sugestão das pastas de ROMs, os idiomas (`i18n.test.ts`: os dois dicionários completos e nenhum texto da tela fora deles), o `messages.json` do Rust em dia e o `npm run versao`. A lógica da parte de trás tem os testes dela no próprio Rust |
| `tests/unit/release-build-env.test.ts` | Confere remapeamentos com espaços e barras Windows/Unix, precedência e preservação das flags de ambiente (encoded, `RUSTFLAGS`, target Windows x64 e build), origens vazias e o uso de somente o nome do PDB no build de release |
| `tests/unit/themeMusicPlayer.test.ts` | Confere seleção rápida, rampas, volume, pausa manual, bloqueio de autoplay, suspensão, desmontagem e StrictMode com um áudio falso e temporizadores controlados |
| `tests/unit/musicConfigSaveQueue.test.ts` | Confere escritas lentas entre telas, cancelamento de alterações ainda não enviadas, combinação de patches e recuperação depois de falhas |
| `tests/unit/fullscreenNavigation.test.ts` | Snapshots de entrada, neutralidade, sequência/geração, bordas, repetição direcional, coleções/busca, restauração da seleção e edição do texto virtual |
| `tests/unit/fullscreenSession.test.ts` | Serialização de consulta/lançamento, bloqueio com jogo aberto e liberação depois de falhas |
| `tests/fakeDiscs.ts`, `fakeTrophies.ts` e `fakePng.ts` | Arquivos de mentira para os testes do app: discos (ISOs, os .bin de PS1, o PARAM.SFO, o EBOOT.PBP, os de GameCube, Wii e 3DS), os troféus do RPCS3 e imagens PNG |
| `tests/app/` | Testes do app de verdade (Playwright): abrem a janela (a versão DEV) e clicam como uma pessoa. `helpers.ts` abre o app dos testes com uma pasta de dados temporária e liga o Playwright na janela pela depuração do WebView2, cria pastas de arquivos de mentira (`createFiles()`) e combina a resposta da janela do Windows de escolher arquivo ou pasta (`mockOpenDialog()`). `fakeMetadataServer.ts` é um IGDB, um SteamGridDB e um RetroAchievements de mentira, com imagens geradas na hora, trailers MP4 e músicas M4A sintéticos, para os testes não usarem a internet |
| `tests/app/layout.spec.ts` | Confere as quatro abas de conteúdo em português e inglês, pelas dimensões e pelo DOM (sem capturas): largura útil, colunas, ausência de transbordamento, ações alcançáveis e formulários preservados ao redimensionar |
| `tests/app/fullscreen.spec.ts` | Fluxos de tela cheia em dados temporários: estado nativo, biblioteca/detalhes, preferências, busca e teclado, dados compartilhados, foco/input sintético, mídia e execução simulada. Não usa HID nem emuladores reais |
| `tests/app/covers.spec.ts` | Confere as capas pelas dimensões e pelo DOM (sem capturas): áreas iguais 2:3 na Grade, arte inteira e status alinhados, proporção original nos Detalhes e no painel lateral, limites de tamanho e área estável durante carregamento (com a imagem retida pelo app até o teste liberar), sem imagem ou em erro |
| `tests/app/backgroundVideo.spec.ts` | Confere seleção, importação, cancelamento, reprodução sem som, pausa, troca de jogo/modo, persistência, remoção, falha e movimento reduzido com WebM sintético e dados temporários |
| `tests/app/automaticTrailers.spec.ts` | Confere trailer automático, prioridade manual, remoção/desativação, reativação, falha e busca de trailers pendentes em jogos antigos, usando MP4 sintético servido localmente; não acessa YouTube nem prepara ou executa ferramentas externas |
| `tests/app/themeMusic.spec.ts` | Confere importação, cópia e persistência, os quatro modos, foco, pausa e preferências, busca automática, prioridade manual, remoção/reativação e fila compartilhada; usa WAV/M4A sintéticos, servidor local e dados temporários, sem YouTube nem ferramentas externas |
| `tests/app/musicUi.spec.ts` | Confere os controles de música em português e inglês e retém capturas nos resultados. Com `PLAYTROVE_CAPTURE_MUSIC=1`, atualiza somente `docs/screenshots/<idioma>/music.png` usando a biblioteca de demonstração |
| `tests/app/backgroundVideoDev.spec.ts` | Serve o componente real pelo Vite em desenvolvimento e confere o ciclo extra do StrictMode, reprodução de mídia sintética, movimento reduzido e desmontagem, com Edge headless e cache temporário |
| `vitest.config.ts` e `playwright.config.ts` | Configuração dos dois tipos de teste da interface |
| `README.md` e `README.pt-BR.md` | Página de apresentação do projeto no GitHub, em inglês (a que o GitHub mostra) e em português: logo, sobre, recursos, capturas de tela, download, privacidade, bugs, como compilar e roadmap |
| `LICENSE` | A licença do código (MIT) |
| `THIRD-PARTY-NOTICES.md` | Os avisos de licença do que vem de terceiros: o Aniki ReMake e o Aniki Helper (MIT), portados na tela cheia, e a fonte Exo 2 (OFL) |
| `SECURITY.md` | Como avisar de um problema de segurança (em particular, pelo GitHub) |
| `.github/workflows/tests.yml` | O robô dos testes (GitHub Actions): a cada envio para a `main` ou a `desenvolvimento` e a cada Pull Request, prepara o Rust e roda o `npm test` num Windows limpo do GitHub, e marca o commit com ✓ ou ✗ |
| `.github/workflows/website.yml` | Pede ao repositório separado `LamarcKz/Playtrove-site` uma publicação após lançar uma estável ou editar, remover ou despublicar uma release (inclusive converter uma estável em pré-lançamento), ou por execução manual. Publicações iniciais de pré-lançamentos são ignoradas; o site seleciona só releases publicadas e estáveis. Usa um GitHub App limitado a Actions no site; não compila o app nem altera sua versão |
| `.github/ISSUE_TEMPLATE/` | Os formulários das Issues no GitHub: bug (`bug_report.yml`, com os campos `version` e `windows` que o botão "Reportar um problema" preenche) e ideia (`feature_request.yml`) |
| `docs/logo.svg` | Logo do projeto (o mesmo baú do ícone do app), usado no README |
| `docs/screenshots/` | Capturas de tela do app usadas nos READMEs: `en/` e `pt-BR/`, com os mesmos nomes de arquivo |
| `AGENTS.md` | Ponto de entrada do Codex: orienta a leitura integral do guia compartilhado e a consulta a este mapa |
| `CLAUDE.md` | Guia compartilhado do Codex e do Claude Code: o que o app faz e as regras técnicas de trabalho (o estado do projeto fica fora do repositório) |
| `out/` | Gerada pelo build da interface (`out/web`). Não edite |
| `dist/` | Gerada pelo `npm run dist`: o instalador, a versão portátil, o `latest.json` e o `latest.yml`. Não edite |

### `src/shared`: os tipos e os textos

| Arquivo | O que faz |
|---|---|
| `ipc.ts` | O contrato com o Rust: os avisos (`EVENTS`), os nomes das páginas que o app pode abrir no navegador (`EXTERNAL_LINKS`, com os endereços em `src-tauri/src/links.rs`) e o formato do `window.api` (`AppApi`) |
| `i18n/index.ts` | Os idiomas (`Language`, `LANGUAGES` com o nome de cada um na própria língua), `messagesFor()` (os textos de um idioma) e `genreLabel()` (um gênero do IGDB no idioma do app) |
| `i18n/ptBR.ts` | **Todos os textos do app em português**: o dicionário base, que define o formato (`Messages`). As funções montam os textos com números e nomes, com o plural certo. As partes que o Rust mostra (`statusPresets`, `errors`, `dialogs` e `repair`) vão para o `src-tauri/messages.json` pelo `npm run tauri:mensagens` |
| `i18n/en.ts` | Os mesmos textos em inglês (o TypeScript acusa se faltar alguma chave) |
| `achievements.ts` | O que o Rust manda das conquistas: a raridade, os tipos de troféu do PS3 (`TROPHY_GRADES`: platina, ouro, prata e bronze; os nomes ficam nos dicionários), o progresso de um jogo, as conquistas dele, o resumo da aba e a situação da conta |
| `evaluation.ts` | A avaliação do usuário: `formatScore()` (9 → "4,5", ou "4.5" em inglês), o tamanho máximo da análise e o formato que a janela salva (`GameEvaluation`) |
| `types.ts` | Tipos de dados: `DailyPlaytime` (o tempo de um dia, para as Estatísticas), `Game` (o jogo), `Status` (um status), `StatusRules` (as regras automáticas), `LibrarySnapshot` (tudo junto, como a interface recebe), os da aba Emuladores (`EmulatorInfo`, `RetroArchCore`, `RomFolder` e `ScanResult`), os dos metadados (`MetadataConfig` e `MetadataProgress`), o da música (`MusicConfig`) e o da atualização (`UpdateStatus`) |
| `romFolders.ts` | `suggestFolderSetup()`: sugere emulador, core e console para uma pasta de ROMs pelo nome dela (ex.: "PS2" → PCSX2, "PSP" → PPSSPP, "GameCube" e "Wii" → Dolphin, "3DS" → Azahar) |
| `controllers.ts` | Controle/bateria (`ConnectedController`), botões normalizados (`ControllerButton`) e snapshot de entrada (`ControllerInputSnapshot`, com sequência, geração e chave do controle) |
| `fullscreen.ts` | `FullscreenConfig`: `startOnLaunch`, `musicPlayback`, `musicVolume`, `startDestination` (Hub ou biblioteca), `profileName` e `profileAvatar` (um de `PROFILE_AVATARS`), independentes do desktop |

### `src/renderer`: interface React

| Arquivo | O que faz |
|---|---|
| `index.html` | HTML da janela. Tem a classe `dark` (tema escuro padrão) e a regra de segurança (CSP): imagens do app e de `http://playtrove-img.localhost`, vídeos de `http://playtrove-video.localhost` e áudios de `http://playtrove-music.localhost` e prévias de `http://playtrove-music-preview.localhost` |
| `main.tsx` | Liga a ponte com o Rust (`window.api`), o React na página e o CSS |
| `api.d.ts` | Avisa o TypeScript que `window.api` existe e qual é o formato dele (`AppApi`) |
| `App.tsx` | Alterna desktop/tela cheia conforme o estado nativo. Mantém montado o desktop com página, busca, filtros, modo e seleção; conserva o shell fullscreen após a primeira entrada. Liga a biblioteca, os status, o idioma e os avisos rápidos |
| `styles/globals.css` | Tailwind e **todas as cores do app** (variáveis CSS dos temas escuro e claro) |
| `hooks/useI18n.ts` | `useI18n()`: o idioma, os textos dele (`t`, ex.: `t.pages.library`) e `setLanguage()` para trocar |
| `hooks/useLibrary.ts` | A biblioteca que está no banco (jogos, status e regras). Recarrega sozinha quando algo muda. `setGameStatus()` muda o status de um jogo |
| `hooks/useStatuses.ts` | Os status para qualquer componente: `useStatuses()` (a lista) e `useStatusName()` (o nome pelo id) |
| `hooks/useControllers.ts` | Acompanha os controles conectados: aparecem e somem sozinhos, e a bateria é lida de novo a cada 5 segundos. Quem lê é o Rust; a interface só ouve (`window.api.controllers`) |
| `hooks/useFullscreen.ts` | `useFullscreenMode()` acompanha o estado nativo, serializa transições e restaura o foco do desktop; `useFullscreenConfig()` carrega, grava e sincroniza preferências por `fullscreen:config` |
| `lib/fullscreenConfig.ts` | Fila de preferências: resposta otimista, patches serializados e reconciliação de eventos, falhas e leituras antigas sem perder mudanças pendentes |
| `hooks/useFullscreenInput.ts` | Atividade da janela, habilitação do input nativo, navegação espacial restrita ao painel visível, confirmação, teclas e repetição direcional |
| `hooks/useEmulators.ts` | Os dados da aba Emuladores (emuladores, cores do RetroArch e pastas de ROMs) e as ações de cada um |
| `hooks/useRunningGames.ts` | Os jogos abertos agora (o Rust avisa quando um abre ou fecha) |
| `hooks/useToast.ts` | `useToast()`: mostra um aviso rápido no canto da tela (ex.: "3 jogos novos na biblioteca") |
| `hooks/useMetadataProgress.ts` | O andamento do download de metadados, com um aviso de quando a leva termina |
| `hooks/useMusicConfig.ts` | Preferências de reprodução, volume e busca automática; sincroniza pelo evento `music:config` e grava mudanças em ordem, inclusive as do controle de volume |
| `hooks/useMusicReviews.ts` | Carrega revisões persistidas com estado loading/erro explícito e atualiza em library:changed/fim da fila |
| `hooks/useAchievements.ts` | A conta do RetroAchievements e a situação da atualização (acompanha os avisos do Rust), as conquistas de um jogo e o resumo da aba Conquistas |
| `lib/utils.ts` | `cn()`: junta classes do Tailwind sem conflito |
| `lib/devBuild.ts` | `devMark`: a janela roda o código em desenvolvimento, no `npm run dev` (`?dev=library`, com a cópia da biblioteca) ou nos testes automáticos (`?dev=tests`). A barra do topo mostra a marca DEV |
| `lib/format.ts` | Textos no idioma do app: `formatPlaytime()` ("12 h 30 min" ou "12h 30m"), `formatLastPlayed()` ("Hoje", "Há 5 dias", "12/08/2026"), `formatReleaseDate()` ("14/10/2003" ou "10/14/2003"), `formatDateTime()`, `formatTime()`, `listTitles()` (os primeiros nomes e "e mais 2", nos avisos) e `shortCoreName()` (o nome curto de um core do RetroArch, como "mGBA") |
| `lib/filters.ts` | A busca e os filtros: `LibraryFilters` (o que pode ser filtrado), `filterGames()` (quem passa), as faixas de tempo jogado, as de nota e dificuldade (`SCORE_RANGES`) e o período de "Recentes" (`RECENT_DAYS`, 30 dias) |
| `lib/errors.ts` | `errorMessage()`: a mensagem de um erro para mostrar ao usuário |
| `lib/tauriApi.ts` | A ponte com o Rust (`createTauriApi()`): o `window.api`, com cada função chamando o comando do Rust de mesmo nome (em snake_case) e cada `on...` ouvindo um aviso de `EVENTS` |
| `lib/metadata.ts` | `describeMetadataResult()`: o aviso que resume uma leva de downloads de metadados |
| `lib/themeMusicPlayer.ts` | Um áudio por seleção: atraso de 300 ms, rampas de 500 ms, volume e pausa manual, recuperação de autoplay e cancelamento de reproduções antigas ao trocar de faixa, suspender ou desmontar |
| `lib/musicConfigSaveQueue.ts` | Grava patches de preferências em uma fila compartilhada entre telas, sem reenviar alterações pendentes de componentes desmontados ou sobrescrever campos com um estado antigo |
| `lib/musicPreviewPlayer.ts` | Player da prévia, cancelamento/respostas antigas, volume e exclusão de áudio ambiente, mantendo cache ao confirmar |
| `lib/musicReview.ts`, `lib/musicReviewsLoader.ts` | Classificação de pendências/contagem e leitura compartilhada sem tratar desconhecido/falha como lista vazia |
| `lib/fullscreenNavigation.ts` | Coleções/busca global, restauração da seleção e máquina de input com neutralidade, sequência/geração, ações por borda e repetição só direcional |
| `lib/fullscreenHub.ts` | Os números do perfil e os cartões de atividade do Welcome Hub, calculados com os jogos e a atividade diária |
| `lib/fullscreenSession.ts` | `FullscreenLaunchGuard`: serializa consulta de jogos abertos e lançamento, bloqueando cliques/ações concorrentes |
| `lib/fullscreenText.ts` | Edição do texto virtual por seleção/cursor, exclusão e limite de tamanho |
| `lib/score.ts` | As contas das estrelas e das pimentas: quanto de cada ícone fica pintado, a nota escolhida pelo clique ou pelo teclado e o texto para leitores de tela ("4,5 de 5 estrelas") |
| `lib/stats.ts` | As contas das Estatísticas: o resumo, os mais jogados, os grupos por plataforma e biblioteca, os jogos por status, o eixo do gráfico de atividade e as colunas dos gráficos por dia e por mês (`dayColumns()` e `monthColumns()`) |
| `lib/achievements.ts` | A cor de cada tipo de troféu (`GRADE_TEXT`), a porcentagem curta de jogadores ("3%", "0,4%") e o progresso em %. `sortAchievements` dá as ordenações do painel de troféus da tela cheia. As palavras de cada fonte ("conquistas" ou "troféus") ficam nos dicionários (`achievements.sources`) |

#### `src/renderer/fullscreen`: apresentação em tela cheia

| Arquivo | O que faz |
|---|---|
| `FullscreenShell.tsx` | Estado da sessão: biblioteca horizontal, Detalhes Signature, coleções, busca global, seleção por coleção, painéis, menu principal, mapa de botões do Aniki, dados comuns e lançamento/retorno. Restringe input ao painel atual e suspende interação durante execução |
| `AnikiStage.tsx` | Palco de 1920×1080 do tema, ajustado ao monitor como no Playnite |
| `AnikiTopBar.tsx` | Barra do topo da interface Padrão: coleção, Menu, Buscar, troféus desbloqueados, controle e relógio |
| `AnikiLibrary.tsx` | Biblioteca horizontal: nome do jogo sobre a arte, etiquetas, legenda dos botões e faixa de capas |
| `AnikiShortcutBar.tsx` | Legenda dos botões do controle, com a ação de segurar |
| `AnikiHub.tsx` | Welcome Hub: páginas de perfil e de atividade, com os pontos de página e a legenda dos botões |
| `AnikiQuickPanels.tsx` | Acesso rápido (perfil, configurações, jogo aleatório, atualizar biblioteca e energia) e Opções rápidas (música, volume e onde abrir) |
| `AnikiAvatar.tsx` | Avatares próprios do Playtrove para o perfil, no círculo dourado do Aniki |
| `AnikiMainMenu.tsx` | Menu principal: configurações, jogo aleatório, minimizar, voltar ao modo janela e sair |
| `AnikiGlyph.tsx` | Ícones (Segoe Fluent Icons, os códigos do Aniki) e glifos dos botões do DualSense |
| `FullscreenKeyboard.tsx` | Editor de busca/análise com teclado virtual e físico: maiúsculas, acentos, pontuação, espaço, cursor, exclusão e quebra de linha na análise; aplicar/salvar e cancelar preservam o rascunho separado |
| `FullscreenPreferences.tsx` | Início em tela cheia e reprodução/volume independentes, usado no painel fullscreen e em Configurações → Geral |
| `FullscreenMedia.tsx` | Player próprio usando `ThemeMusicPlayer`, música salva com preferências fullscreen e a imagem de fundo do jogo; respeita foco, visibilidade e suspensão |
| `AnikiSignature.tsx` | Detalhes no layout Signature: nome sobre a arte, painel de vidro com capa, nota e dificuldade, botões, dados e barra de conquistas |
| `AnikiTrailerCard.tsx` | Trailer em miniatura dos detalhes: sem som, depois de 600 ms, com movimento reduzido e pausa na suspensão |
| `AnikiDescription.tsx` | Painel de descrição do Signature, com a análise e o botão de editar |
| `AnikiTrophies.tsx` | Painel de troféus do Aniki: cabeçalho com capa e progresso, pegos de cada tipo, cartões, ordenação, filtro e ocultos |

#### `src/renderer/pages`: as telas (abas)

| Arquivo | O que faz |
|---|---|
| `index.ts` | Lista das páginas (`PageId`) com o ícone de cada uma (`PAGE_ICONS`): Biblioteca, Estatísticas, Conquistas, Emuladores e Configurações. Os nomes ficam nos dicionários (`pages`) |
| `StatsPage.tsx` | Estatísticas: o resumo, os blocos com barras, a atividade e as listas de jogos. Vazia, mostra um botão para a aba Emuladores |
| `AchievementsPage.tsx` | Conquistas: a conta e o botão "Atualizar", o resumo, os gráficos por dia e por mês, os jogos com o progresso e as desbloqueadas por último. Sem conta, um botão leva às Configurações |
| `LibraryPage.tsx` | Biblioteca nos modos Detalhes (o principal), Grade, Lista e Kanban, com o painel de filtros na direita quando ele está aberto e um único player de música tema acompanhando a seleção. A filtragem em si fica em `lib/filters.ts`. Vazia, mostra um botão que leva à aba Emuladores |
| `EmulatorsPage.tsx` | Emuladores: onde está cada emulador e as pastas de ROMs, com os botões de procurar jogos. Resume cada procura num aviso rápido (`describeScan()`) |
| `SettingsPage.tsx` | Configurações: Geral (incluindo preferências fullscreen), Status e Sobre (nome e **versão do app**) numa pilha, Metadados e Conquistas na outra; duas colunas a partir de 1120 px úteis, sem desmontar formulários ao redimensionar |

#### `src/renderer/components`: pedaços da interface

**Janela e navegação**

| Arquivo | O que faz |
|---|---|
| `TopBar.tsx` | Barra única do topo: logo, ferramentas, metadados, controle, entrada em tela cheia e botões minimizar, maximizar/restaurar e fechar. O ícone do meio acompanha `window:state`; arrastar pela barra move a janela (`data-tauri-drag-region`) |
| `AppLogo.tsx` | Logo do app (controle num quadrado azul), usado na barra do topo e em Configurações |
| `ControllerIndicator.tsx` | Controle conectado na barra do topo: ícone, USB ou Bluetooth, bateria (verde carregando, vermelha quando fraca) e o texto completo no tooltip |
| `MetadataStatus.tsx` | "Metadados 3/7" na barra do topo enquanto os metadados são baixados (o jogo da vez no tooltip) e o aviso com o resumo no fim |
| `Sidebar.tsx` | Menu lateral só com ícones (Biblioteca, Estatísticas, Conquistas, Emuladores e Configurações). O nome de cada página aparece num tooltip |
| `LibraryTools.tsx` | Ferramentas da Biblioteca na barra do topo: busca, filtros e seletor de modo (Detalhes, Grade, Lista e Kanban) |
| `FilterButton.tsx` | Botão de filtros (ao lado da busca): abre e fecha o painel de filtros. Mostra um pontinho azul quando há filtro ligado |
| `FilterPanel.tsx` | Painel de filtros na direita: Favoritos e Recentes em caixinhas, um seletor para cada filtro e o botão "Limpar". Os filtros de texto (Biblioteca, Plataforma, Gênero, Desenvolvedora, Publicadora e Ano) ficam em `VALUE_FILTERS`, e os de Nota e Dificuldade em `SCORE_FILTERS`; sem dados em nenhum jogo, aparecem desativados |
| `FilterSelect.tsx` | Um seletor de filtro, como os do Playnite: o campo mostra as opções marcadas (ou "Todos") e abre a lista com caixinhas e a quantidade de jogos de cada opção |
| `SearchBar.tsx` | Campo de busca (só guarda o texto) |
| `EmptyState.tsx` | Aviso de "nada aqui ainda", usado nas páginas vazias, com um botão opcional |
| `I18nProvider.tsx` | O idioma para toda a interface (`useI18n()`): começa com o que veio no endereço da janela, confere com o Rust e troca na hora |
| `RichText.tsx` | Um texto do dicionário com partes em negrito (`**assim**`), usado nos passos a passo das chaves |
| `ToastProvider.tsx` | Os avisos rápidos (`useToast()`): aparecem no canto de baixo, à direita, no máximo 3 de cada vez, e somem sozinhos. O `pinned` fica no alto da pilha enquanto quiser (o aviso de versão nova) |
| `UpdateNotice.tsx` | O aviso de versão nova, no canto dos avisos: "Atualizar" (ou "Baixar", na portátil) e "Agora não"; depois do clique, o andamento do download |
| `UpdateSettings.tsx` | Configurações → Sobre: a situação da atualização, "Procurar atualizações" (ou "Atualizar", com versão nova) e a opção de procurar ao abrir o app |
| `AchievementNotifier.tsx` | Ouve o Rust e mostra o aviso "Conquista desbloqueada" ou "Troféu desbloqueado" (4 ou mais de uma vez viram um aviso só) |
| `ServiceCard.tsx` | O cartão de um serviço com chave (IGDB, SteamGridDB e RetroAchievements): configurado ou não, os campos, o passo a passo e o botão que abre o site |
| `MetadataSettings.tsx` | Configurações → Metadados: chaves dos serviços, automático para jogos novos, aquisição de trilhas, contador que distingue baixar/revisar/sem resultado e acesso às candidatas depois da leva |
| `MusicSettings.tsx` | Configurações → Geral: reprodução e volume da música ambiente; aquisição fica em Metadados |
| `MusicReviewPanel.tsx`, `MusicReviewDialog.tsx` | Lista persistente e revisão com escuta/escolha após os metadados, busca editável e importação local |
| `AchievementsSettings.tsx` | Configurações → Conquistas: a conta do RetroAchievements (usuário e Web API Key) e a situação da atualização, com "Atualizar agora" |
| `StatusSettings.tsx` | Configurações → Status: renomear, mudar a ordem, criar e apagar status (escolhendo para onde vão os jogos), e as duas regras automáticas |

**Aba Estatísticas**

| Arquivo | O que faz |
|---|---|
| `ContentPage.tsx` | Área comum de Estatísticas, Conquistas, Configurações e Emuladores: rolagem vertical, margens de 16/24 px, largura máxima de 1600 px e container `content` para organizar as colunas pela largura útil |
| `BarList.tsx` | Lista com barras horizontais de uma cor só: nome, barra proporcional e o valor escrito (os mais jogados, os status, as plataformas...); nos cartões estreitos, a barra fica abaixo do nome e do valor |
| `ActivityChart.tsx` | O gráfico da atividade dos últimos 30 dias (um `ColumnChart` com o tempo jogado de cada dia) |
| `ColumnChart.tsx` | O gráfico de colunas das Estatísticas e das Conquistas: dica ao passar o mouse (ou com o foco do teclado), o maior valor escrito em cima e a versão em tabela |
| `StatsBlocks.tsx` | Os blocos das telas de números: `StatTile` (um número do resumo), `StatsCard` (um bloco com título) e `EmptyNote` (bloco sem dados) |

**Conquistas** (a aba e o que aparece na biblioteca)

| Arquivo | O que faz |
|---|---|
| `AchievementParts.tsx` | Pedaços usados em vários lugares: a barra de progresso, a insígnia (sem imagem, um troféu), o troféu com "3/6" (na cor da platina quando o jogo é platinado) e os troféus por tipo (`TrophyIcon` e `GradeCounts`, "0/3") |
| `AchievementsCard.tsx` | O cartão dos Detalhes, à direita do título: o progresso, os pontos (só no RetroAchievements), os troféus de cada tipo, as últimas insígnias e "Ver todas" |
| `AchievementsDialog.tsx` | A janela com todas as conquistas (ou troféus) de um jogo (Todas, Desbloqueadas e Faltam), cada uma com o tipo do troféu e, no RetroAchievements, a raridade, a porcentagem de jogadores e os pontos (no PS3, o pacote extra), e a data. Os troféus ocultos que faltam ficam escondidos até "Mostrar ocultos" |

**Aba Emuladores**

| Arquivo | O que faz |
|---|---|
| `EmulatorList.tsx` | Os 4 emuladores: encontrado ou não, o executável (com o botão para escolher ou trocar) e, no RetroArch, os cores instalados |
| `RomFolderList.tsx` | As pastas de ROMs (emulador, core, console e quantos jogos vieram de cada uma), com os botões Procurar e tirar, e o formulário de pasta nova, já preenchido com a sugestão pelo nome da pasta |

**Biblioteca, modo Detalhes** (o principal, como no print do Playnite)

| Arquivo | O que faz |
|---|---|
| `GameList.tsx` | Lista de jogos da esquerda (ícone, nome e o troféu com o progresso nas conquistas) |
| `GameIcon.tsx` | Ícone pequeno do jogo (lista, Lista e Kanban). Sem ícone, um pedaço da capa; sem os dois, o desenho padrão |
| `GameDetailsView.tsx` | Área grande da direita: arte de fundo, a capa na proporção original acima do título (até 160 × 288 px), a estrela de favorito, os botões "Jogar" e "Mais" com a nota e a dificuldade ao lado, "Detalhes" e, na coluna da direita, "Minha análise" em cima da "Descrição". Nos jogos com conquistas, o cartão delas fica à direita do título |
| `GameDetailsBackdrop.tsx` | Fundo exclusivo dos Detalhes: vídeo local automático em repetição sem som, preferência de movimento reduzido e imagem enquanto carrega ou falha. Pausa quando a janela fica oculta e encerra a mídia ao trocar de jogo ou sair dos Detalhes |

**Biblioteca, modo Grade**

| Arquivo | O que faz |
|---|---|
| `GameGrid.tsx` | Grid responsivo: as colunas se ajustam à largura da janela; os cartões ficam alinhados pelo topo, com áreas de capa iguais. A altura total ainda varia quando títulos e status quebram linha |
| `GameCard.tsx` | Card do jogo: capa inteira centralizada numa área 2:3 de até 384 px de altura, fundo neutro nas sobras e status numa faixa logo abaixo dessa área, título, tempo jogado e progresso nas conquistas, com zoom no hover. Títulos e status longos podem quebrar linha |
| `GameCover.tsx` | Capa inteira sem cortes, distorção ou preenchimento desfocado. `layout="grid"` reserva uma área 2:3 estável; o padrão acompanha a proporção natural nos Detalhes e no painel. Durante o carregamento, sem capa ou em erro, mostra o desenho padrão |

**Biblioteca, modo Lista**

| Arquivo | O que faz |
|---|---|
| `GameTable.tsx` | Uma linha por jogo, com as colunas Nome, Status, Plataforma, Biblioteca, Tempo jogado, Nota, Dificuldade e Conquistas |

**Biblioteca, modo Kanban**

| Arquivo | O que faz |
|---|---|
| `GameKanban.tsx` | Quadro com uma coluna por status. As colunas dividem a largura da tela (nada de rolar para os lados) e ficam mais compactas ou mais largas conforme o tamanho da janela. Arrastar um card para outra coluna muda o status do jogo |

**Usados em vários modos**

| Arquivo | O que faz |
|---|---|
| `GameDetailsPanel.tsx` | Painel lateral que abre ao clicar num jogo (Grade, Lista e Kanban; no Kanban ele fica por cima do quadro): o fundo atrás da capa na proporção original (até 176 × 320 px), o título, "Jogar", o menu "Mais", a nota e a dificuldade, as informações e a análise |
| `GameBackdrop.tsx` | A imagem de fundo do jogo, que vai sumindo para baixo (modo Detalhes e painel lateral); aceita a camada de vídeo dos Detalhes por baixo do degradê |
| `GameActionsMenu.tsx` | O menu "Mais" de um jogo: avaliar (abre a `RatingDialog`), escrever ou editar a análise (abre a `ReviewDialog`), baixar metadados, marcar como favorito, escolher ou remover o vídeo de fundo e a música tema, reativar suas buscas automáticas e mostrar a ROM no Explorador |
| `LibraryThemeMusic.tsx` | Um player preservado entre os quatro modos da Biblioteca, sem faixa de controles visível; acompanha foco e visibilidade da janela e jogos abertos, e libera o áudio na desmontagem |
| `RatingDialog.tsx` | Janela "Avaliar jogo": a nota em estrelas e a dificuldade em pimentas, as duas com meio ícone (pelo `ScoreInput`) |
| `ReviewDialog.tsx` | Janela "Minha análise": o texto do usuário sobre o jogo (em branco apaga) |
| `ScoreInput.tsx` | Escolher a nota clicando nos ícones (metade esquerda = meio ícone) ou pelo teclado (setas de meio em meio), com o botão "Limpar" |
| `ScoreIcons.tsx` | As cinco estrelas (ou pimentas) só para mostrar, com meio ícone; usada nos detalhes, no painel lateral e na Lista |
| `GameScores.tsx` | "Minha nota" e "Dificuldade" com o rótulo pequeno em cima, no estilo da Steam, ao lado do "Jogar" |
| `icons/PepperIcon.tsx` | O ícone de pimenta, desenhado no traço do lucide (que não tem pimenta) |
| `PlayButton.tsx` | Botão verde "Jogar": abre o jogo no emulador, mostra "Em execução" enquanto ele está aberto e, se não der, um aviso com o motivo |
| `GameInfoList.tsx` | Lista de informações do jogo (Status, Tempo jogado, Última vez jogado, Biblioteca, Plataforma, Gênero, Desenvolvedora, Publicadora e Lançamento) |

**`ui/`**: componentes do shadcn/ui (`button`, `input`, `textarea`, `separator`, `tooltip`, `toggle`, `toggle-group`, `checkbox`, `select`, `dropdown-menu` e `dialog`), criados pelo `npx shadcn add`. O `dropdown-menu` é a lista que abre nos seletores de filtro.

### `src-tauri`: a parte de trás, em Rust

O app em Tauri 2: a janela, o banco, os emuladores, a internet e tudo o que não é tela (até a 0.7.x, isso era o processo principal do Electron). Um módulo por assunto; os testes de cada um ficam no fim do próprio arquivo (`#[cfg(test)]`), com bancos em memória e pastas temporárias.

| Arquivo | O que faz |
|---|---|
| `Cargo.toml` | O projeto em Rust e as dependências (`tauri`, `rusqlite` com o SQLite embutido, `serde`...). A versão do app vem do `package.json` (pelo `tauri.conf.json`). Os build scripts saem com as informações de depuração também no release (`[profile.release.build-override]`), porque o Smart App Control do Windows pode bloquear build scripts sem elas |
| `build.rs` | Executa o `tauri_build` e observa `../package.json` para regenerar os recursos de versão do Windows quando a versão do aplicativo muda |
| `tauri.conf.json` | Configuração do Tauri: nome, id, o Vite no endereço 1420 no desenvolvimento e `out/web` no build; o instalador (o padrão do Tauri, só para o usuário, em inglês e português, com os ganchos de `windows/hooks.nsh`) e a atualização (a chave pública que confere a assinatura e o endereço do `latest.json` da última release) |
| `windows/hooks.nsh` | Os ganchos do instalador: a passagem de quem tem o app em Electron (até a 0.7.x). Antes de instalar, tira o app antigo sem perguntar nada (a biblioteca fica) e, quando veio do atualizador dele (sem telas), abre o app novo no fim |
| `capabilities/default.json` | O que a janela pode pedir ao Tauri: ouvir os avisos do Rust e arrastar ou maximizar pela barra do topo |
| `messages.json` | Os textos que o Rust mostra, gerados dos dicionários pelo `npm run tauri:mensagens` (não editar à mão) |
| `rustfmt.toml` | A formatação do Rust (`cargo fmt`) |
| `src/main.rs` | Abre o app: a pasta de dados, o banco (com o aviso, se ele foi consertado), o idioma, os jogos de exemplo dos testes, os protocolos de imagens, vídeos e músicas, a janela e a lista dos comandos |
| `src/commands.rs` | Os comandos que a interface chama. Recebem os valores crus (JSON), conferem pelo `validation.rs` e avisam a tela (`library:changed`) depois de gravar |
| `src/validation.rs` | Confere o que vem da tela (ids, textos, sim ou não, a ordem e as regras dos status, a avaliação) |
| `src/errors.rs` | `AppError`: o erro que a tela mostra, já no idioma do app (`AppError::text`) |
| `src/dates.rs` | `iso()`: as datas no formato do banco (o `toISOString()` do JavaScript) |
| `src/sample_games.rs` | Os 12 jogos de exemplo dos testes (`PLAYTROVE_SAMPLE_GAMES=1`) |
| `src/emulators.rs` | O que o app sabe de cada emulador (`PRESETS`: nome do executável, lugares comuns, extensões, argumentos e se abre maximizado), a tabela `emulators`, a detecção automática (atalhos, lugares comuns e pastas vizinhas), os cores do RetroArch e o comando para abrir um jogo |
| `src/system_sources.rs` | De onde a detecção lê no Windows de verdade: os atalhos do menu Iniciar e da Área de Trabalho, lidos pelo próprio Windows (COM) |
| `src/rom_scanner.rs` | As pastas de ROMs (tabela `rom_folders`) e a varredura: o nome limpo do jogo (`title_from_file_name`), as ISOs e pastas de PS3 e o .cue no lugar dos .bin |
| `src/discs.rs` | O código do jogo no disco (PS1, PS2, PS3, PSP, GameCube, Wii e 3DS) e o nome dos jogos de PS3, lendo só alguns bytes. Os discos de mentira dos testes ficam no módulo `fake_discs` |
| `src/launcher.rs` | O Jogar: abre o emulador separado do app, guarda os jogos abertos e, quando ele fecha, devolve o tempo jogado. Ao fechar o app, `finish_all` registra o tempo até ali |
| `src/emulator_window.rs` | Maximiza a janela do RetroArch quando ela aparecer, pelas funções do Windows |
| `src/emulator_playtime.rs` | Lê o tempo que os emuladores registram (PCSX2, DuckStation, RPCS3, PPSSPP, Dolphin, Azahar e RetroArch) e junta com a biblioteca, sem contar duas vezes |
| `src/playtime_sync.rs` | Relê esses registros ao abrir, a cada minuto, depois de uma varredura e logo depois de um jogo fechar |
| `src/stats.rs` | A atividade por dia das Estatísticas (últimos 30 dias, no horário do computador) |
| `src/test_support.rs` | Só dos testes: pastas temporárias, arquivos de mentira e o banco em memória |
| `src/secrets.rs` | As chaves das APIs, criptografadas no mesmo formato do safeStorage do Electron: a chave AES protegida pelo Windows (DPAPI) no arquivo "Local State" da pasta de dados e cada segredo em AES-GCM ("v10"). Assim as chaves salvas num app valem no outro |
| `src/metadata/http.rs` | Os pedidos pela internet (`HttpClient`, com o `ureq`; os testes passam uma internet de mentira, `fake::FakeFetch`), os endereços dos serviços (os de verdade ou os do servidor de mentira) e o erro que para a leva (`MetadataError::Stop`) ou pula um jogo (`Skip`) |
| `src/metadata/igdb.rs`, `steam_grid_db.rs` e `libretro.rs` | Os três serviços: o IGDB (token da Twitch, busca, plataformas, ids de vídeos do YouTube e o desempate pelo jogo original), o SteamGridDB (capa e fundo) e o endereço da capa no libretro-thumbnails |
| `src/metadata/matching.rs` | O texto da busca e a escolha do resultado mais parecido |
| `src/metadata/download.rs` | O download de um jogo: a ordem das fontes das imagens, o trailer e a música automáticos e a gravação, preservando mídia manual; falha de mídia vira aviso sem perder descrição ou imagens, e ausência registra a consulta. Pedidos explícitos de música dispensam os outros metadados |
| `src/metadata/trailer_downloader.rs` | Baixa o trailer por id validado do YouTube, usando ferramentas verificadas: MP4 H.264 até 720p e 100 MiB, preferindo sem áudio, sem FFmpeg nem configuração, cookies, plugins ou componentes remotos |
| `src/metadata/theme_downloader.rs` | Busca estruturada de OST por nome/plataforma e variações, até 3 consultas/10 resultados/30 IDs; distingue recomendação forte de candidatas para escolha. Download cancelável de AAC/M4A até 10 minutos/32 MiB/180 s por operação, com ferramentas verificadas dos trailers e sem conversão |
| `src/metadata/trailer_tools.rs` | Prepara yt-dlp 2026.10.21 e Deno 2.9.8 das releases oficiais em `<dados do app>/tools`, com versões e hashes SHA-256 fixos, cache verificado e extração restrita do executável |
| `src/metadata/trailer_tools_process.rs` | Executa o downloader oculto no Windows, com ambiente restrito e JobObject associado antes da execução; limita a saída e encerra também os descendentes ao terminar ou esgotar o prazo. Os testes usam subprocessos do próprio harness, incluindo timeout com descendente |
| `src/metadata/queue.rs` | A fila: um jogo de cada vez, numa linha de execução à parte, com o andamento (`MetadataProgress`); preserva os pedidos de metadados e de música quando o mesmo jogo recebe os dois |
| `src/metadata/credentials.rs` | As chaves e a configuração de Configurações → Metadados (a tela nunca recebe as chaves) |
| `src/achievements/` | As conquistas: os tipos que a tela recebe (`types.rs`), o RetroAchievements (`client.rs`, `matching.rs`, `store.rs`, `sync.rs` e `badges.rs`), os troféus do RPCS3 (`trophy_files.rs`, `trophy_store.rs`, `trophy_sync.rs` e `trophy_icons.rs`), o que as telas mostram (`views.rs`) e o serviço que atualiza sozinho e avisa (`service.rs`) |
| `src/metadata/service.rs` | A ligação com o app: a sessão do IGDB guardada entre os downloads, a fila e os avisos `metadata:progress` |
| `src/controllers.rs` | Descoberta HID a cada segundo, indicador DualSense/Edge e bateria econômica a cada 5 s (`controllers:changed`). Input opt-in mantém um leitor por aparelho com timeout de 20 ms, dá prioridade sobre a bateria e publica mudanças (`controllers:input`). Só DualSense navega; Edge continua como indicador. Não inicializa hardware nos testes |
| `src/controller_input.rs` | Parser puro dos relatórios DualSense USB 0x01 e Bluetooth simples 0x01/completo 0x31; botões e analógico esquerdo com zona morta, neutralidade, sequência/geração e invalidação após desconexão/reativação |
| `src/fullscreen.rs` | Preferências próprias na tabela `settings`: início desligado, música ligada e volume 20%; valida todo o patch antes de gravar em transação e mantém os dados desktop separados |
| `src/links.rs` | Os sites que o app abre no navegador (`EXTERNAL_LINKS`, com os mesmos nomes do `src/shared/ipc.ts`, conferidos pelo `backendMessages.test.ts`) e o formulário de bug, com a versão do app e a do Windows (lida do registro, como o Electron escrevia) |
| `src/data_folder.rs` | Onde ficam os dados: pasta temporária nos testes, `data` ao lado do .exe na portátil, `%APPDATA%\Playtrove` no app de verdade e a cópia `%APPDATA%\Playtrove Dev` no desenvolvimento (a mesma das versões em Electron) |
| `src/database.rs` | Abre o banco (sem WAL), confere (`quick_check`) e, se estiver danificado, conserta: copia o que dá para ler para um banco novo, acerta o que ficou sem par, guarda o arquivo danificado ao lado e monta o aviso (`describe_repair`) |
| `src/migrations.rs` | Migrações SQLite, sempre acrescentadas ao fim: 1–8 mantêm compatibilidade com Electron; 9 vídeo local; 10 modos/consulta de trailers; 11 música local/modos/revisão; 12 buscas/candidatas persistentes e origem das músicas em `music_searches`/`music_sources` |
| `src/settings.rs` | Ler e gravar na tabela `settings` |
| `src/i18n.rs` | O idioma (o escolhido ou o do Windows) e `text()`, que busca os textos no `messages.json` |
| `src/library.rs` | A biblioteca que a tela mostra (`LibrarySnapshot`): jogos, status com o nome no idioma, regras e o progresso nas conquistas e nos troféus. Também muda o status, o favorito e a avaliação de um jogo, e cria, renomeia, reordena e apaga status e troca as regras automáticas |
| `src/images.rs` | As imagens dos jogos pelo protocolo `playtrove-img` (`http://playtrove-img.localhost/<id>/cover.png`), só da pasta de imagens e fora da linha da janela; o tipo de cada imagem e a gravação de uma imagem nova no lugar da antiga |
| `src/videos.rs` | Importa MP4/WebM e associa trailers a `images/<id>/background-video-<identificador>.<ext>`, controla os modos automático/manual/desativado, troca ou remove somente cópias internas e gera `backgroundVideoUrl`. O protocolo `playtrove-video` serve `GET`/`HEAD` e intervalos de bytes de até 2 MiB fora da linha da janela, limitado à pasta do jogo |
| `src/music.rs` | Preferências, importação MP3/M4A/WAV até32 MiB, modos/revisão e helpers de cópia/validação em `images/<id>/theme-music-<identificador>.<ext>`. Protocolo `playtrove-music` serve GET/HEAD e intervalos até2 MiB restritos a cópias internas/caminhos canônicos; busca e associação de candidatas ficam em `music_search.rs` |
| `src/music_search.rs` | Buscas e candidatas persistentes, distinção escolha/ausência/falha, origem do vídeo escolhido, repetição explícita e instalação protegida pela geração/revisão |
| `src/music_previews.rs` | Prévia sob demanda em cache próprio, 1 download/2 arquivos/64 MiB, cancelamento, promoção sem baixar novamente e protocolo `playtrove-music-preview` autorizado por token/revisão |
| `src/updates.rs` | A atualização do app: procurar versão nova (5 s depois de abrir, se a opção estiver ligada, ou quando o usuário pede), baixar avisando o andamento (`updates:status`) e instalar; na portátil, só abrir a página de download. Quem procura é o atualizador do Tauri, que só instala o que tiver a assinatura da chave do projeto; nos testes, um de mentira (`PLAYTROVE_FAKE_UPDATE`); no `npm run dev:tauri`, ninguém |
| `src/window.rs` | Janela sem barra do Windows, maximizada ou em tela cheia pela preferência de início. Reconcilia `isMaximized`/`isFullscreen` em `window:state`, restaura o estado nativo ao sair e desabilita input ao perder foco/sair. Idioma e marca DEV no endereço; `bring_to_front` atende à instância única no release. O WebView2 usa `<pasta de dados>\webview`, separado entre instalado, dev e testes |
| `src/state.rs` | O banco e o idioma enquanto o app está aberto |
| `src/test_hooks.rs` | Só para os testes do app (`tests/app`), e só com a pasta de dados deles: no lugar da janela de "Abrir", do navegador e do Explorador, respostas combinadas e uma lista do que foi pedido; o tamanho da janela; e imagens retidas até o teste liberar (para conferir a tela enquanto carregam). Fora dos testes, os comandos `test_*` não fazem nada |
| `src/test_mode.rs` | As variáveis `PLAYTROVE_*` dos testes, que só valem no build de desenvolvimento |

## Onde implementar cada funcionalidade futura

| Quero... | Abra |
|---|---|
| Mudar como a busca e os filtros funcionam | `src/renderer/lib/filters.ts` → `filterGames()` |
| Criar um filtro novo (ex.: Série, quando o `Game` tiver esse dado) | Em `src/renderer/lib/filters.ts`: o campo em `LibraryFilters`, em `EMPTY_FILTERS` e em `hasActiveFilters()`, e a regra em `filterGames()`. Depois, em `src/renderer/components/FilterPanel.tsx`, um item em `VALUE_FILTERS` (as opções e as quantidades são contadas sozinhas) |
| Mudar o período de "Recentes" | `src/renderer/lib/filters.ts` → `RECENT_DAYS` |
| Mudar as tabelas do banco | `src-tauri/src/migrations.rs`: uma migração nova no fim de `MIGRATIONS`. Nunca mude uma migração que já saiu numa versão |
| Ler ou gravar algo da biblioteca | `src-tauri/src/library.rs`, mais um comando (receita abaixo). Depois de gravar, chame `notify_library_changed()` |
| Mudar os status com que um banco novo começa | `src-tauri/src/migrations.rs` (os status padrão) e o nome de cada um nos dois idiomas, em `statusPresets`, nos dicionários de `src/shared/i18n/` (depois, `npm run tauri:mensagens`). Os status do usuário mudam em Configurações → Status |
| Adicionar informações a um jogo (gênero, capa...) | O campo no tipo `Game` (`src/shared/types.ts`) e no `Game` de `src-tauri/src/library.rs`, a coluna na tabela `games` (migração nova) e a leitura dela em `library.rs` |
| Mostrar essas informações nos detalhes | `src/renderer/components/GameInfoList.tsx` → lista `fields` |
| Suportar outro emulador | `src-tauri/src/emulators.rs` → um item novo em `PRESETS` (nome do executável, lugares comuns, extensões e argumentos; o emulador precisa fechar junto com o jogo, se tiver uma opção para isso) e o id dele em `EmulatorId` (no Rust e em `src/shared/types.ts`). Se ele registrar o tempo jogado, ensine o app a ler em `src-tauri/src/emulator_playtime.rs` |
| Mudar de onde vêm as capas | `src-tauri/src/metadata/download.rs` → a ordem das fontes de cada imagem. Uma fonte nova vira um módulo em `src-tauri/src/metadata/` |
| Ver o que o conserto do banco faz | `src-tauri/src/database.rs` → o conserto e o aviso (`describe_repair`) |
| Mudar os argumentos que abrem um jogo (ex.: sem tela cheia) | `src-tauri/src/emulators.rs` → os argumentos do emulador em `PRESETS` |
| Abrir outro emulador maximizado | `src-tauri/src/emulators.rs` → `maximize: true` no emulador (quem maximiza é o `src-tauri/src/emulator_window.rs`) |
| Mudar como o nome do jogo sai do nome do arquivo | `src-tauri/src/rom_scanner.rs` → `title_from_file_name()` |
| Reconhecer outro nome de pasta de ROMs (ex.: "Dreamcast") | `src/shared/romFolders.ts` → `KNOWN_FOLDERS` |
| Mudar o tempo mínimo que conta como jogado | `src-tauri/src/library.rs` (o mínimo de segundos de uma sessão) |
| Pôr outro bloco nas Estatísticas (ex.: por gênero) | A conta em `src/renderer/lib/stats.ts` (ex.: `groupGames()` com os gêneros) e o bloco em `src/renderer/pages/StatsPage.tsx` (`StatsCard` + `BarList`) |
| Mudar o período do gráfico de atividade | `ACTIVITY_DAYS` em `src-tauri/src/stats.rs` (e os textos "30 dias" nos dicionários, em `stats`) |
| Mudar a cor das barras dos gráficos | `--chart-bar` em `src/renderer/styles/globals.css` (confira o contraste com o fundo dos cartões: pelo menos 3:1) |
| Mudar as faixas de raridade das conquistas | `src-tauri/src/achievements/types.rs` → `rarity_of()` |
| Mudar quantos pontos do RetroAchievements fazem prata e ouro | `src-tauri/src/achievements/types.rs` → `grade_for_points()` (as cores dos tipos ficam em `--trophy-*` e `--platinum`, em `globals.css`) |
| Mudar de quanto em quanto tempo as conquistas e os troféus do RPCS3 são lidos | `src-tauri/src/achievements/service.rs` (os intervalos e as esperas depois de abrir e de fechar um jogo) |
| Achar no RetroAchievements um console que lá tem outro nome | `src-tauri/src/achievements/matching.rs` (os apelidos dos consoles) |
| Ler os troféus de outro emulador (ex.: um de PS4) | Um módulo como `src-tauri/src/achievements/trophy_files.rs` para os arquivos dele, guardando nas mesmas tabelas (`trophy_store.rs`) |
| Mostrar um aviso rápido no canto da tela | `useToast()` (`src/renderer/hooks/useToast.ts`), em qualquer componente |
| Pôr outra ação no menu "Mais" (ex.: editar, remover da biblioteca) | `src/renderer/components/GameActionsMenu.tsx`, mais um comando se a ação mexer no banco ou no disco |
| Buscar outro dado nos metadados (ex.: nota, série) | `src-tauri/src/metadata/igdb.rs` (o campo pedido e a leitura dele), a gravação em `library.rs`, a coluna no banco (migração nova) e o campo em `Game` (no Rust e em `src/shared/types.ts`) |
| Traduzir mais gêneros | `genres` nos dicionários (`src/shared/i18n/ptBR.ts` e `en.ts`), pelo nome que o IGDB usa |
| Mudar ou criar um texto da tela | `src/shared/i18n/ptBR.ts` e `en.ts` (os dois: o TypeScript acusa se faltar no inglês). Na interface, `const { t } = useI18n()`; no Rust, `text()` de `src-tauri/src/i18n.rs`, depois do `npm run tauri:mensagens` |
| Criar outro idioma | Um dicionário novo em `src/shared/i18n/` (do tipo `Messages`), o id em `Language`, `LANGUAGES` e `MESSAGES` (`src/shared/i18n/index.ts`), o idioma no Rust (`src-tauri/src/i18n.rs`, com a regra do Windows) e o `npm run tauri:mensagens` |
| Reconhecer outro console na busca de metadados | `src-tauri/src/metadata/igdb.rs` (o id da plataforma no IGDB) |
| Mudar como o resultado certo da busca é escolhido | `src-tauri/src/metadata/matching.rs` |
| Mudar o tamanho ou o tipo das imagens baixadas | `src-tauri/src/metadata/steam_grid_db.rs` e, as do IGDB, `src-tauri/src/metadata/download.rs` |
| Mudar onde as imagens aparecem | `GameCover.tsx` (capa), `GameIcon.tsx` (ícone), `GameBackdrop.tsx` (fundo), usados em `GameDetailsView.tsx`, `GameDetailsPanel.tsx`, `GameCard.tsx` e `GameList.tsx` |
| Mudar o vídeo de fundo | `src-tauri/src/videos.rs` (importação, modos, associação e protocolo por intervalos), `metadata/download.rs` e `metadata/trailer_downloader.rs` (trailer automático), `metadata/trailer_tools.rs` (ferramentas e hashes), `metadata/trailer_tools_process.rs` (processo e descendentes), `GameActionsMenu.tsx` (ações) e `GameDetailsBackdrop.tsx` (reprodução e imagem de reserva) |
| Mudar a música tema | `src-tauri/src/music.rs` (preferências/importação/protocolo), `music_search.rs`/`music_previews.rs` (candidatas/escolhas/prévias), `metadata/theme_downloader.rs` (busca/áudio), `metadata/queue.rs` (fila), `MusicReviewDialog.tsx`/`MusicReviewPanel.tsx`/`MetadataSettings.tsx` (revisão e aquisição), `LibraryThemeMusic.tsx`/`lib/themeMusicPlayer.ts`/`lib/musicPreviewPlayer.ts` (reprodução) |
| Ampliar a tela cheia (hub, configuração completa, perfil, layouts, temas, ferramentas ou conectores) | `src/renderer/fullscreen/FullscreenShell.tsx` e seus painéis; transições em `hooks/useFullscreen.ts`/`src-tauri/src/window.rs`, preferências em `src-tauri/src/fullscreen.rs` e `src/shared/fullscreen.ts`. Esses recursos ainda ficam no roadmap |
| Mudar a navegação por controle | `src-tauri/src/controller_input.rs` (pacotes), `controllers.rs` (serviço opt-in), `src/renderer/lib/fullscreenNavigation.ts` (ações, toque/segurar e repetição), `hooks/useFullscreenInput.ts` (foco/escopo) e o mapa em `fullscreen/FullscreenShell.tsx` |
| Lembrar o modo de exibição e os filtros ao reabrir o app | `src/renderer/App.tsx` → estados `libraryView` e `libraryFilters` (salvar em algum lugar, ex.: na tabela `settings`, por um comando) |
| Criar outro modo de exibição | `src/renderer/components/LibraryTools.tsx` (`LibraryView` e `VIEWS`) e `src/renderer/pages/LibraryPage.tsx` |
| Opções em Configurações (ex.: tema claro/escuro) | `src/renderer/pages/SettingsPage.tsx`, seção "Geral". O tema é a classe `dark` do `<html>` (`src/renderer/index.html`) |
| Mudar as cores | `src/renderer/styles/globals.css` (bloco `.dark`). Se mudar o fundo, ajuste também `BACKGROUND_COLOR` em `src-tauri/src/window.rs` |
| Criar uma página nova no menu | Um arquivo novo em `src/renderer/pages`; o id e o ícone em `pages/index.ts`, e o nome nos dois dicionários (`pages`); mostrar a página em `App.tsx`; e colocar no menu em `components/Sidebar.tsx` (`MAIN_NAV`) |
| Mudar o instalador ou a versão portátil | O `bundle` do `src-tauri/tauri.conf.json`, os ganchos de `src-tauri/windows/hooks.nsh` e o `scripts/dist.mjs` |
| Mudar o ícone do app | `build/icon.ico` (o .exe, o instalador e a janela), `docs/logo.svg` (README) e `src/renderer/components/AppLogo.tsx` (barra do topo). Os três têm o mesmo desenho |
| Mostrar outro modelo de controle (ex.: DualShock 4) | `src-tauri/src/controllers.rs`: o modelo em `SUPPORTED_CONTROLLERS` e o jeito de ler a bateria dele |
| Importar jogos de outros lugares (Steam, GOG, pastas de jogos de PC) | Um módulo novo no Rust, como o `src-tauri/src/rom_scanner.rs` faz com as pastas de ROMs, entregue à interface por um comando |
| Usar outro componente do shadcn/ui | Rode `npx shadcn add nome-do-componente`: ele aparece em `src/renderer/components/ui/` |

## Receita: criar um comando novo

Exemplo: um comando para a interface marcar um jogo como favorito.

1. **Rust (`src-tauri/src/commands.rs`)**: a função com `#[tauri::command]`, com o nome em snake_case (`games_set_favorite`). Os valores chegam crus (`serde_json::Value`): confira tudo antes de usar, pelas funções de `validation.rs` (`to_id()`, `to_bool()`...), e devolva o erro como `AppError` (a mensagem no idioma do app). Se mudou a biblioteca, chame `notify_library_changed()`. Um comando que espera a internet ou o disco por muito tempo leva `#[tauri::command(async)]`, para não travar a janela.
2. **`src-tauri/src/main.rs`**: o comando na lista do `generate_handler!`.
3. **`src/shared/ipc.ts`**: a função no `AppApi` (ex.: `games: { setFavorite: (gameId: number, favorite: boolean) => Promise<void> }`).
4. **`src/renderer/lib/tauriApi.ts`**: a função chamando o comando (`invoke("games_set_favorite", { gameId, favorite })`; os nomes dos valores em camelCase, como o Rust recebe).
5. **Na interface**: chame `window.api.games.setFavorite(id, true)`.

**No sentido contrário** (o Rust avisando a interface de algo, como "a janela maximizou"), copie o modelo do aviso `window:state`:

- **Rust** (`src-tauri/src/window.rs`): `app.emit("window:state", dados)` quando o evento acontece.
- **`src/shared/ipc.ts`**: o nome em `EVENTS`.
- **ponte** (`src/renderer/lib/tauriApi.ts`, `onStateChange`): `subscribe(EVENTS.windowState, callback)`, que devolve uma função para parar de ouvir.
- **interface** (`src/renderer/components/TopBar.tsx`, `useIsMaximized`): começa a ouvir dentro de um `useEffect` e para de ouvir na limpeza dele.

O `library:changed` segue o mesmo modelo, sem dados: o Rust só avisa, e o `useLibrary` pede a biblioteca de novo.

Duas regras:

- O Rust nunca confia no que vem da tela: tudo passa pelo `validation.rs`, e nada fora das pastas do app é lido ou aberto a pedido da interface (as imagens só da pasta de imagens; os sites só os de `EXTERNAL_LINKS`).
- Não passe o evento de clique do React para funções do `window.api`. Use `onClick={() => window.api.algo()}`, e não `onClick={window.api.algo}`.

## Histórico e versões (Git e GitHub)

O projeto fica guardado com o Git, e o GitHub guarda uma cópia online, no repositório público `LamarcKz/Playtrove`. Funciona como os saves de um jogo:

- **commit** = salvar o jogo (a cada tarefa concluída);
- **push** = mandar o save para a nuvem (logo depois de cada commit);
- **branch** = um save paralelo;
- **release** = um capítulo concluído, ou seja, uma versão com nome, na aba "Releases".

### As duas linhas principais

| Branch | O que tem | Quando muda |
|---|---|---|
| `main` | A **versão estável**, igual à última release. É o que aparece na página do GitHub | Quando uma versão é lançada: com novidades, só com o seu OK, depois de você testar; só com correções, o Claude lança sozinho e te avisa. Também para corrigir algum texto da página, com o seu OK |
| `desenvolvimento` | O **trabalho em andamento**. É a que fica no seu computador e roda no `npm run dev` | A cada tarefa concluída |

Mudanças grandes (como o banco de dados) ganham uma branch própria, que sai da `desenvolvimento` e volta para ela quando fica pronta. Se não der certo, ela é apagada e nada se perde.

**Você não precisa lembrar disso.** O Claude segue esse fluxo sozinho (ele está no `CLAUDE.md`, lido no começo de toda sessão), e o Git tem uma trava (pasta `.githooks/`) que bloqueia salvar ou enviar direto na `main`.

### Números de versão

A versão tem três números, `MAIOR.MENOR.CORREÇÃO`, no padrão do [Versionamento Semântico](https://semver.org/lang/pt-BR/):

| Número | Quando sobe | Exemplo |
|---|---|---|
| **CORREÇÃO** (o último) | A versão só corrige erros | 0.2.0 → **0.2.1** |
| **MENOR** (o do meio) | A versão traz coisas novas (e o último volta a 0) | 0.2.1 → **0.3.0** |
| **MAIOR** (o primeiro) | O app fica completo para uso | 0.9.0 → **1.0.0** |

- Enquanto o primeiro número for **0**, o app ainda está sendo construído.
- O número **só muda quando uma versão é lançada**. Enquanto o trabalho acontece, o app continua mostrando o número da última versão (em Configurações → "Sobre").
- **Quem lança:** versões com novidades esperam você dizer "pode lançar". Versões só com correções o Claude lança sozinho, depois de testar, e te avisa.
- **Qual número:** o comando `npm run versao` olha o que mudou desde a última versão e diz qual deve ser a próxima, e por quê.
- **Número pedido no lançamento:** você pode pedir um número diferente do sugerido. A **0.7.1** saiu como correção, embora os commits fossem `refactor`, e a **0.8.0** subiu o número do meio na troca do Electron pelo Tauri. Isso não altera o calculador nem reescreve o histórico. Novas funcionalidades continuam seguindo o número do meio; a 1.0.0 depende de um marco de estabilidade.

### Para voltar atrás

É só pedir ao Claude, por exemplo "desfaz a última mudança" ou "volta como estava antes de X":

- mudanças que ainda não viraram commit são guardadas à parte (*stash*) e podem ser recuperadas;
- commits são desfeitos com um commit novo (*revert*), sem apagar nada do histórico;
- uma branch que não deu certo é apagada, e o resto continua intacto;
- qualquer versão lançada pode ser baixada de novo em "Releases".

## Outras informações úteis

- **`npm run dev` e recarga automática:** mudanças na interface (`src/renderer` e `src/shared`) aparecem na hora, sem fechar a janela. Mudanças no Rust (`src-tauri`) fazem o Tauri recompilar e reabrir o app sozinho. A primeira vez compila todas as dependências do Rust e leva alguns minutos.
- **Atalhos de import:** na interface, `@/` aponta para `src/renderer` e `@shared/` para `src/shared`. Exemplo: `import { Button } from "@/components/ui/button"`.
- **Onde fica o banco:** `%APPDATA%\Playtrove\playtrove.db` no app instalado, a pasta `data` ao lado do .exe na versão portátil e `%APPDATA%\Playtrove Dev\playtrove.db` no `npm run dev` (uma cópia do primeiro, para o código em teste nunca mexer nos jogos de verdade; `npm run dev:nova-copia` renova). É criado na primeira execução, com as tabelas e os 9 status. A biblioteca começa vazia. O WebView2 guarda o que precisa na pasta `webview`, ao lado do banco.
- **Testes:** `npm test` roda tudo: os da interface (`npm run test:unit`), os do Rust (`npm run test:rust`) e os do app (`npm run test:app`, que compila o app dos testes antes e abre a janela sozinho por alguns segundos). Os testes do app usam uma pasta de dados temporária (variável `PLAYTROVE_DATA_DIR`) com os 12 jogos de exemplo (`PLAYTROVE_SAMPLE_GAMES=1`), então nunca mexem na sua biblioteca, e fingem o idioma do Windows (`PLAYTROVE_SYSTEM_LANGUAGE`: português, e inglês nos testes de idioma). Input fullscreen usa eventos sintéticos e o serviço não inicializa HID nesse modo; testes físicos de USB/Bluetooth são separados e ainda pendentes para navegação.
- **Aviso de scripts do npm:** o npm 11 pede aprovação para scripts de instalação de pacotes. O do `esbuild` está negado de propósito em `allowScripts`, no `package.json`, porque não é necessário.
- **Dependências:** a interface não tem nada em `dependencies`: React, shadcn, Tailwind e o resto ficam em `devDependencies`, porque o Vite já os empacota dentro do app. As do Rust ficam no `src-tauri/Cargo.toml`.
- **Tooltip em volta de toggle:** o tooltip do shadcn sobrescreve o atributo `data-state` do botão que ele envolve. Por isso o modo ativo do seletor de modos (Detalhes, Grade, Lista e Kanban) é destacado por `aria-checked` (veja `LibraryTools.tsx`).
- **O que ainda falta:** fica no "Roadmap" do `README.md`, e não no código: aqui só entra o que já funciona.
- **Controle no Bluetooth:** no Bluetooth, o DualSense começa num modo simples, sem a bateria. Para ler a bateria, o app pede o modo completo, o mesmo que a Steam usa, e o controle fica nele até ser desligado. Se algum jogo antigo aberto fora da Steam não reconhecer o controle, feche o app e desligue e ligue o controle.
- **Leitura do controle:** fora da navegação fullscreen, a bateria usa leituras curtas a cada 5 segundos. O input opt-in mantém um único handle enquanto a janela está em tela cheia, focada e sem jogo aberto; aproveita os relatórios para bateria e desativa ao sair, perder foco ou jogar. Neutralidade e gerações impedem ações mantidas/antigas ao retomar. Não há dependência, driver ou permissão adicional para esse modo.

### Site público e guias

As fontes do site ficam em outro repositório, [Playtrove-site](https://github.com/LamarcKz/Playtrove-site), com dependências e builds próprios. Os guias de usuários e colaboradores em português e inglês mostram o último snapshot estável revisado cuja versão não ultrapasse a release publicada, identificado pelo seu número real. Os posts reaproveitam as notas públicas de cada release, preservando os dois idiomas, a versão, a data e o link de origem; não há API de IA nem commits automáticos de posts.

O aplicativo só contém o listener `website.yml`: um GitHub App com acesso apenas a Actions de `Playtrove-site` aciona `deploy.yml` na `main` de lá. O listener atende a publicação de estáveis e também edições, remoções, despublicações e conversões para pré-lançamento: o site reconstrói sua seleção de releases públicas e estáveis. Publicar um pré-lançamento novo não dispara essa atualização. O setup e os comandos de manutenção estão no `MAINTENANCE.md` do site. A chave privada fica em um secret do GitHub no repositório do aplicativo, nunca em arquivos. O listener só vale automaticamente para tags que já contenham esse workflow; releases antigas podem ser reconstruídas pela execução manual do workflow do site.
