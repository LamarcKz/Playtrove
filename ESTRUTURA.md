# Estrutura do projeto

Guia de onde fica cada coisa no Playtrove e de qual arquivo abrir para criar cada funcionalidade nova.

## A ideia geral: 3 partes que conversam

Um app Electron roda em partes separadas, que trocam mensagens entre si (isso se chama **IPC**):

```text
 src/renderer                     src/preload                  src/main
┌───────────────────────┐        ┌───────────────┐        ┌──────────────────────────┐
│ INTERFACE (React)     │ window │ PONTE         │  IPC   │ PROCESSO PRINCIPAL (Node)│
│ telas, botões, grid,  │ ─.api─►│ libera só     │ ──────►│ janela, banco SQLite,    │
│ lista de jogos        │ ◄───── │ algumas       │ ◄──────│ arquivos, abrir jogos    │
│                       │        │ funções       │        │                          │
└───────────────────────┘        └───────────────┘        └──────────────────────────┘
```

- **main** (`src/main`): o "motor" do app, roda no Node. Cria a janela e é o único que pode mexer no banco, no disco e no Windows.
- **renderer** (`src/renderer`): a interface em React. É uma página web dentro da janela e, por segurança, **não** tem acesso ao Node.
- **preload** (`src/preload`): a ponte segura. Entrega ao React só as funções liberadas, em `window.api`.
- **shared** (`src/shared`): código usado pelos dois lados, como os nomes dos canais IPC e o tipo `Game`.

Uma exceção: o controle (DualSense) é lido direto pela interface, pela **WebHID** (o acesso a aparelhos USB e Bluetooth que o próprio navegador oferece). O main só libera esse acesso, e apenas para os controles reconhecidos (`src/main/controllers.ts`).

Os canais IPC de hoje:

| Canal | Quem usa | O que faz |
|---|---|---|
| `app:version` | `SettingsPage.tsx` (seção "Sobre") | O main devolve a versão do `package.json` |
| `window:controls` | `TopBar.tsx` (botões da janela) | O main minimiza, maximiza/restaura ou fecha a janela |
| `window:state` | `TopBar.tsx` (botão maximizar) | O React pergunta se a janela está maximizada, e o main avisa sempre que isso muda (inclusive por duplo clique na barra ou Win+↑). É o exemplo de mensagem **do main para o React** |
| `library:get` | `hooks/useLibrary.ts` | O React pede a biblioteca inteira: jogos, status e regras |
| `library:changed` | `hooks/useLibrary.ts` | O main avisa que algo mudou na biblioteca, e o React pede os dados de novo |
| `games:set-status` | `hooks/useLibrary.ts` (Kanban) | Salva o status novo de um jogo |
| `statuses:create`, `statuses:rename`, `statuses:reorder`, `statuses:delete` e `statuses:set-rules` | `StatusSettings.tsx` | Criam, renomeiam, mudam a ordem e apagam status, e trocam as regras automáticas |
| `emulators:list`, `emulators:detect`, `emulators:pick-path` e `emulators:cores` | `hooks/useEmulators.ts` (aba Emuladores) | Os emuladores e onde está cada um (na primeira vez, o main procura sozinho), procurar de novo, escolher o executável numa janela do Windows e os cores do RetroArch |
| `rom-folders:list`, `rom-folders:pick`, `rom-folders:add`, `rom-folders:remove` e `rom-folders:scan` | `hooks/useEmulators.ts` e `RomFolderList.tsx` | As pastas de ROMs: listar, escolher uma pasta numa janela do Windows, adicionar, tirar e procurar jogos nelas |
| `games:play` | `PlayButton.tsx` | Abre o jogo no emulador. Responde quando o emulador abriu, ou com a mensagem do problema |
| `games:running` | `hooks/useRunningGames.ts` | Os jogos abertos agora. O main também avisa por esse canal quando um jogo abre ou fecha |
| `games:set-favorite` e `games:show-rom` | `GameActionsMenu.tsx` (menu "Mais") | Marcam ou desmarcam o favorito e mostram a ROM no Explorador de Arquivos |
| `games:set-evaluation` | `RatingDialog.tsx` e `ReviewDialog.tsx` (menu "Mais") | Muda só as partes enviadas da avaliação: a nota e a dificuldade, ou a análise (o main confere os valores: de 1 a 10, ou vazio) |
| `metadata:get-config`, `metadata:set-igdb`, `metadata:set-steamgriddb` e `metadata:set-auto-download` | `MetadataSettings.tsx` (Configurações → Metadados) | O que está configurado (sem as chaves), salvar as chaves (o main confere antes, com um pedido de teste) e ligar ou desligar o download sozinho para jogos novos |
| `metadata:download` | `MetadataSettings.tsx` e `GameActionsMenu.tsx` | Coloca jogos na fila de download de metadados (sem ids, os que ainda não têm) |
| `metadata:progress` | `hooks/useMetadataProgress.ts` | O andamento da fila: o React pergunta, e o main avisa a cada passo |
| `stats:daily-playtime` | `pages/StatsPage.tsx` | O tempo jogado em cada um dos últimos 30 dias (das sessões guardadas no banco) |
| `achievements:get-config` e `achievements:set-account` | `hooks/useAchievements.ts` e `AchievementsSettings.tsx` (Configurações → Conquistas) | A conta do RetroAchievements (o nome e a situação da atualização; a chave nunca volta) e salvar ou tirar a conta (o main confere no site antes de salvar) |
| `achievements:sync` | Botões "Atualizar" (aba Conquistas e Configurações) | Busca agora as conquistas de todos os jogos |
| `achievements:game` e `achievements:overview` | `hooks/useAchievements.ts` | As conquistas de um jogo (o cartão dos Detalhes e a janela "Ver todas") e tudo o que a aba Conquistas mostra |
| `achievements:status` e `achievements:unlocked` | `hooks/useAchievements.ts` e `AchievementNotifier.tsx` | Do main para o React: começou ou terminou de atualizar, e as conquistas novas (para o aviso no canto) |
| `app:open-link` | `ServiceCard.tsx` (Configurações → Metadados e Conquistas) | Abre no navegador uma das páginas de `EXTERNAL_LINKS` (onde criar as chaves e a página de download das versões). O React manda só o nome; o main não abre nenhum outro endereço |
| `updates:status`, `updates:check`, `updates:install` e `updates:set-auto-check` | `hooks/useUpdates.ts`, `UpdateNotice.tsx` e `UpdateSettings.tsx` (Configurações → Sobre) | A atualização do app: a situação (o main também avisa quando ela muda), procurar agora, instalar a versão encontrada (baixa, fecha, instala e abre de novo; na portátil, abre a página de download) e ligar ou desligar a procura ao abrir |
| `app:report-bug` | `SettingsPage.tsx` (Configurações → Sobre) | Abre no navegador o formulário de bug do GitHub, com a versão do app e a do Windows preenchidas (`bugReport.ts`) |
| `app:get-language` e `app:set-language` | `I18nProvider.tsx` e `SettingsPage.tsx` (Configurações → Geral) | O idioma do app e a troca dele (o main guarda a escolha e avisa que a biblioteca mudou, porque o nome dos status padrão muda junto) |

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
- **Troféus do PS3:** com o RPCS3 configurado na aba Emuladores, os jogos de PS3 mostram os troféus que ele guarda, sem conta: o cartão dos Detalhes ("Troféus") tem quantos de cada tipo (bronze, prata, ouro e platina, nas cores do PS3), e a janela "Ver todos" esconde os troféus ocultos que faltam até clicar em "Mostrar ocultos". Na aba Conquistas, eles entram junto com as do RetroAchievements.
- **Emuladores:** a aba mostra onde está cada emulador (PCSX2, DuckStation, RetroArch e RPCS3; o app procura sozinho nos atalhos do menu Iniciar e da Área de Trabalho e nas pastas vizinhas aos que já achou) e as pastas de ROMs. Cada pasta diz qual emulador abre os jogos dela (e qual core, no RetroArch) e de qual console eles são; o app sugere tudo pelo nome da pasta. "Procurar" coloca na biblioteca as ROMs que ainda não estão nela. Os avisos rápidos (no canto de baixo, à direita) contam o que aconteceu.
- **Jogar:** abre a ROM no emulador da pasta dela, com a configuração do próprio emulador (o app não força tela cheia). Enquanto o emulador está aberto, o botão mostra "Em execução"; quando ele fecha, o tempo jogado e a última vez jogado são atualizados. O app também mostra o tempo que os emuladores registram por conta própria, para o que foi jogado fora dele aparecer. Na primeira vez, o jogo sai de "Planejo jogar" e vai para "Jogando" (regra automática de Configurações → Status).
- **Imagens e metadados:** no modo Detalhes, a lista mostra o ícone de cada jogo (sem ícone, um pedaço da capa), e a área grande mostra a arte de fundo, a capa acima do nome, a descrição e as informações (gênero, desenvolvedora, publicadora, lançamento). A Grade mostra as capas, e o painel lateral mostra o fundo atrás da capa. Sem imagem, aparece o desenho padrão (um controle num degradê). O menu "Mais" baixa os metadados de um jogo, marca como favorito e mostra a ROM na pasta. Enquanto os metadados são baixados, a barra do topo mostra "Metadados 3/7".
- **Controle:** com um DualSense conectado, a barra do topo mostra por onde ele está ligado (USB ou Bluetooth), a bateria e se ela está carregando (em verde). Passando o mouse, aparece tudo por extenso. Sem controle, não aparece nada.
- **Idiomas:** o app inteiro em português e inglês. O idioma fica em Configurações → Geral e muda na hora, sem reabrir; na primeira vez, vale o do Windows (português → português; qualquer outro → inglês). Os status que vêm com o app mudam de nome junto (Planejo jogar → Plan to play), e os criados ou renomeados ficam como o usuário escreveu. Os nomes dos jogos, as descrições do IGDB, as conquistas do RetroAchievements e os troféus do RPCS3 vêm de fora e não mudam.

## Pastas e arquivos

### Raiz do projeto

| Arquivo | O que faz |
|---|---|
| `package.json` | Nome, versão (a que aparece em Configurações), dependências e comandos (`npm run ...`) |
| `electron.vite.config.ts` | Configuração do build (electron-vite) das 3 partes e dos atalhos de import `@/` e `@shared/` |
| `electron-builder.config.mjs` | Como o app vira o instalador e a versão portátil (electron-builder): o que vai no pacote (o build e as dependências do main, com só o binário do Windows do `better-sqlite3`), o ícone, o instalador de um clique e de onde vêm as versões novas (as releases do GitHub) |
| `tsconfig.json` | Junta as duas configurações do TypeScript abaixo |
| `tsconfig.node.json` | TypeScript do lado Node: `src/main`, `src/preload` e `src/shared` |
| `tsconfig.web.json` | TypeScript do lado da interface: `src/renderer` e `src/shared` |
| `components.json` | Configuração do shadcn/ui, usada pelo comando `npx shadcn add` |
| `.gitignore` | O que o Git deve ignorar (`node_modules`, `out`, `dist`...) |
| `.gitattributes` | Faz o Git guardar os arquivos de texto sempre com o mesmo tipo de quebra de linha (LF) |
| `.githooks/` | Travas do Git: impedem commit e envio direto na `main` (ver "Histórico e versões") |
| `scripts/next-version.mjs` | O comando `npm run versao`: diz qual deve ser a próxima versão, pelos commits desde a última, e monta o rascunho das notas |
| `scripts/dev-library.mjs` | O comando `npm run dev:nova-copia`: joga fora a cópia da biblioteca do `npm run dev` (`%APPDATA%\Playtrove Dev`), só com ele fechado; o próximo `npm run dev` copia de novo a do app instalado |
| `scripts/dist.mjs` | O comando `npm run dist`: gera em `dist/` o instalador (`Playtrove-Setup-X.Y.Z.exe`, com o `latest.yml` e o `.blockmap` que a atualização automática lê) e a versão portátil (`Playtrove-X.Y.Z-portable.zip`, com o `portable.txt` ao lado do .exe) |
| `build/` | Arquivos do instalador: o ícone (`icon.ico`, com todos os tamanhos do Windows) e o `portable.txt` que vai no .zip da versão portátil |
| `tests/unit/` | Testes rápidos da lógica (Vitest), sem abrir o app: filtros, datas, bateria do controle, banco de dados, emuladores, pastas de ROMs, abrir jogos e contar o tempo (com um emulador de mentira), os idiomas (`i18n.test.ts`: os dois dicionários completos e nenhum texto da tela fora deles) e `npm run versao` |
| `tests/fakeDiscs.ts` | Discos de mentira para os testes: ISOs, a versão "crua" de CD (os .bin de PS1) e o PARAM.SFO dos jogos de PS3 |
| `tests/app/` | Testes do app de verdade (Playwright): abrem a janela e clicam como uma pessoa. `helpers.ts` abre o app com uma pasta de dados temporária, cria pastas de arquivos de mentira (`createFiles()`) e simula a janela do Windows de escolher arquivo ou pasta (`mockOpenDialog()`). `fakeMetadataServer.ts` é um IGDB e um SteamGridDB de mentira (com imagens geradas na hora), para os testes de metadados não usarem a internet |
| `vitest.config.ts` e `playwright.config.ts` | Configuração dos dois tipos de teste |
| `tsconfig.test.json` | TypeScript dos testes e dos scripts |
| `README.md` e `README.pt-BR.md` | Página de apresentação do projeto no GitHub, em inglês (a que o GitHub mostra) e em português: logo, sobre, recursos, capturas de tela, download, privacidade, bugs, como compilar e roadmap |
| `LICENSE` | A licença do código (MIT) |
| `SECURITY.md` | Como avisar de um problema de segurança (em particular, pelo GitHub) |
| `.github/workflows/tests.yml` | O robô dos testes (GitHub Actions): a cada envio para a `main` ou a `desenvolvimento` e a cada Pull Request, roda o `npm test` num Windows limpo do GitHub e marca o commit com ✓ ou ✗ |
| `.github/ISSUE_TEMPLATE/` | Os formulários das Issues no GitHub: bug (`bug_report.yml`, com os campos `version` e `windows` que o botão "Reportar um problema" preenche) e ideia (`feature_request.yml`) |
| `docs/logo.svg` | Logo do projeto (o mesmo baú do ícone do app), usado no README |
| `docs/screenshots/` | Capturas de tela do app usadas nos READMEs: `en/` e `pt-BR/`, com os mesmos nomes de arquivo |
| `CLAUDE.md` | Instruções e estado do projeto para o Claude Code |
| `out/` | Gerada automaticamente pelo build. Não edite |
| `dist/` | Gerada pelo `npm run dist`: o instalador, a versão portátil e a pasta `win-unpacked` (o app pronto, sem instalar). Não edite |

### `src/main`: processo principal

| Arquivo | O que faz |
|---|---|
| `index.ts` | Ponto de partida: abre o banco, escolhe o idioma (o salvo ou o do Windows), registra os canais IPC e o protocolo das imagens, libera a leitura dos controles e cria a janela. Ao sair, registra o tempo dos jogos que ainda estão abertos e fecha o banco. Nos testes, usa outra pasta de dados e coloca os jogos de exemplo |
| `window.ts` | Cria a janela sem a barra do Windows (frameless), com as opções de segurança, e carrega a interface, com o idioma no endereço (`?lang=en`). A janela abre maximizada. `isAppOrigin()` confere se um pedido veio da própria interface |
| `i18n.ts` | O idioma do processo principal: `t()` dá os textos no idioma do app (os erros que vão para a tela, as janelas do Windows e o aviso do conserto do banco); `loadLanguage()` escolhe na abertura e `saveLanguage()` guarda a troca (tabela `settings`, chave `language`) |
| `controllers.ts` | Libera a interface para ler os controles reconhecidos pela WebHID, sem janela de escolha. Qualquer outro aparelho continua bloqueado |
| `ipc.ts` | Responde aos canais IPC (e confere tudo o que chega da interface). `notifyLibraryChanged()` avisa a interface que a biblioteca mudou |
| `database.ts` | Conexão com o SQLite: `openDatabase()`, `getDatabase()` e `closeDatabase()` |
| `databaseFile.ts` | Abre o arquivo do banco: confere se está íntegro, conserta se não estiver (guardando o arquivo danificado ao lado) e aplica as migrações |
| `repairNotice.ts` | O texto do aviso mostrado quando o banco precisou ser consertado (no idioma do app) |
| `migrations.ts` | Cria e atualiza as tabelas do banco, versão por versão (`MIGRATIONS`: 1 = status, jogos, emuladores, pastas e configurações; 2 = sessões de jogo; 3 = tempo e código do disco dos emuladores; 4 = reler os registros dos emuladores; 5 = a avaliação do usuário: nota, dificuldade e análise; 6 = as conquistas do RetroAchievements; 7 = os troféus do PS3, do RPCS3; 8 = os idiomas: a marca `preset` dos status padrão e os gêneros como o IGDB escreve), e os status com que a biblioteca começa (`DEFAULT_STATUSES`) |
| `library.ts` | Consultas da biblioteca: jogos, status (criar, renomear, reordenar e apagar; os padrão com o nome no idioma do app) e as regras automáticas. Também coloca os jogos de emulador na biblioteca (`addEmulatedGame()`) e registra cada vez que um jogo foi jogado (`recordPlaySession()`). Grava os metadados (`saveGameMetadata()`, sem apagar o que não foi encontrado) e o favorito |
| `settings.ts` | Lê e grava as configurações do app (tabela `settings`) |
| `secrets.ts` | Guarda e lê as chaves das APIs na tabela `settings`, criptografadas pelo Windows (`safeStorage`): só a conta do Windows que salvou consegue ler |
| `emulators.ts` | O que o app sabe de cada emulador (`EMULATOR_PRESETS`: executável, lugares comuns, extensões de ROM e argumentos), onde cada um está (tabela `emulators`), a procura automática (`detectEmulators()`), os cores do RetroArch e o comando para abrir uma ROM (`buildLaunchCommand()`) |
| `systemSources.ts` | O que vem do Windows: os atalhos do menu Iniciar e da Área de Trabalho (para a procura automática dos emuladores) e os idiomas preferidos (`systemLanguages()`) |
| `romScanner.ts` | As pastas de ROMs (tabela `rom_folders`) e a varredura: acha as ROMs (`findRoms()`), tira o nome do jogo do nome do arquivo (`titleFromFileName()`) e coloca os novos na biblioteca (`scanRomFolders()`) |
| `launcher.ts` | Abre um jogo no emulador (`launchGame()`), guarda os jogos abertos e registra o tempo jogado quando o emulador fecha (ou quando o app fecha) |
| `discs.ts` | Lê o disco de um jogo sem carregar o arquivo inteiro: o código (ex.: SLUS-20100, do SYSTEM.CNF ou do PARAM.SFO), o nome dos jogos de PS3 e o conjunto de troféus deles (`readPs3TrophySets()`, da pasta PS3_GAME/TROPDIR) |
| `emulatorPlaytime.ts` | O tempo que cada emulador registrou por conta própria (PCSX2, DuckStation, RPCS3 e RetroArch) e a junção disso com a biblioteca |
| `playtimeSync.ts` | Quando ler esses registros: ao abrir o app, a cada minuto, ao fechar um jogo e depois de cada varredura |
| `imageFiles.ts` | As imagens dos jogos no disco: o endereço que a interface usa (`imageUrl()`), a extensão pelo tipo da imagem e `saveGameImage()` (troca a imagem antiga do mesmo tipo) |
| `imageProtocol.ts` | O protocolo `playtrove-img://`, que entrega as imagens para a interface, só de dentro da pasta de imagens |
| `metadata/http.ts` | Os endereços dos serviços (e os de teste), o tipo `Fetch` e o `MetadataStopError` (erro que para a leva inteira) |
| `metadata/igdb.ts` | IGDB: token da Twitch, busca por nome (na plataforma do jogo; os gêneros ficam como o IGDB escreve) e os ids das plataformas |
| `metadata/steamGridDb.ts` | SteamGridDB: busca por nome e a capa e o fundo mais votados |
| `metadata/libretro.ts` | libretro-thumbnails: o endereço da capa oficial pelo console e pelo nome exato da ROM (sem chave) |
| `metadata/matching.ts` | Escolhe o resultado certo da busca: o nome de busca a partir do nome da ROM e a nota de parecido de cada resultado |
| `metadata/download.ts` | `downloadGameMetadata()`: junta os dois serviços para um jogo, baixa as imagens e grava no banco |
| `metadata/queue.ts` | A fila de downloads: um jogo de cada vez, avisando o andamento |
| `metadata/credentials.ts` | As chaves do IGDB e do SteamGridDB (guardadas pelo `secrets.ts`) |
| `achievements/client.ts` | A API do RetroAchievements: conferir a conta, os consoles, o catálogo de um console, o progresso do usuário num jogo e os jogos das conquistas recentes (e os endereços de teste) |
| `achievements/matching.ts` | Acha o console e o jogo do RetroAchievements para um jogo da biblioteca (os números da série têm que bater; hacks e "subsets" ficam de fora) |
| `achievements/badges.ts` | As insígnias no disco (`images/achievements/`), o endereço delas para a interface e o download das que faltam |
| `achievements/store.ts` | O banco das conquistas do RetroAchievements: a conta, o catálogo guardado, o progresso de cada jogo e a parte delas na aba |
| `achievements/sync.ts` | Uma rodada de atualização: acha os jogos novos no catálogo, escolhe quais atualizar, grava e baixa as insígnias. Devolve as conquistas novas |
| `achievements/service.ts` | Quando atualizar (ao salvar a conta, a cada 5 minutos, depois de fechar um jogo e no botão "Atualizar"), uma rodada de cada vez, avisando a interface. Os troféus do RPCS3 são relidos a cada minuto e logo depois de fechar um jogo |
| `achievements/trophyFiles.ts` | Os arquivos de troféus do RPCS3: onde fica a pasta (usuário ativo e `vfs.yml`), a lista de troféus (`TROPCONF.SFM`) e o que foi pego (`TROPUSR.DAT`, com a data no relógio do PS3) |
| `achievements/trophyStore.ts` | O banco dos troféus: guardar um conjunto (e dizer quais são novos), ligar os jogos de PS3 aos conjuntos (pelo disco ou pelo nome) e o que as telas mostram |
| `achievements/trophySync.ts` | Uma leitura dos troféus: só os conjuntos que mudaram, as imagens e a ligação com os jogos |
| `achievements/trophyIcons.ts` | As imagens dos troféus: copiadas diminuídas para `images/trophies/` e o endereço delas para a interface |
| `achievements/grades.ts` | `countGrades()`: quantos troféus de cada tipo o jogo tem e quantos foram pegos (no RetroAchievements, com a platina de quem pegou todas) |
| `achievements/views.ts` | Junta as conquistas do RetroAchievements e os troféus do PS3 para as telas: o progresso de cada jogo, as de um jogo e o resumo da aba (`getOverview()`) |
| `sampleGames.ts` | Os 12 jogos de exemplo (e uma sessão para os jogados nos últimos 30 dias), que entram só nos testes automáticos |
| `bugReport.ts` | O endereço do formulário de bug no GitHub, com a versão do app (e se é a portátil) e a do Windows já preenchidas |
| `dataFolder.ts` | Onde ficam os dados (`locateData()`): o nome do banco (`playtrove.db`) e a mudança da pasta da época do Bibliotecaofgames para a do Playtrove, na primeira vez. O banco e a chave que tranca as senhas (`Local State`) vão juntos; se a pasta antiga estiver em uso, ela é usada desta vez. Também acha a pasta da versão portátil (`portableDataFolder()`: `data`, ao lado do .exe, quando o `portable.txt` está lá) |
| `updateService.ts` | A atualização do app (`createUpdateService()`): procurar versão nova (ao abrir, se a opção estiver ligada, ou quando o usuário pede), baixar avisando o andamento e instalar; na portátil, só abrir a página de download. Não usa o Electron: os testes passam um atualizador de mentira |
| `updates.ts` | Quem procura as versões de verdade: o `electron-updater`, lendo as releases do GitHub (`LamarcKz/Playtrove`). No `npm run dev`, ninguém; nos testes, um de mentira (`PLAYTROVE_FAKE_UPDATE`). Também diz se o app é a versão portátil (`isPortable`) |
| `devLibrary.ts` | A biblioteca do `npm run dev` (`devLibrary()`): uma cópia da de verdade em `%APPDATA%\Playtrove Dev`, feita na primeira vez (o banco pelo `VACUUM INTO`, as imagens e a chave das senhas). A de verdade só é lida |
| `testMode.ts` | O que os testes automáticos pedem pelas variáveis `PLAYTROVE_*` (pasta de dados temporária, jogos de exemplo, idioma do Windows, servidor de mentira...). O app instalado ignora todas |
| `stats.ts` | `getDailyPlaytime()`: o tempo jogado em cada um dos últimos dias, somando as sessões (cada uma conta no dia em que terminou) |

### `src/preload`: a ponte

| Arquivo | O que faz |
|---|---|
| `index.ts` | Monta o `window.api` com as funções que o React pode usar |
| `index.d.ts` | Avisa o TypeScript do React que `window.api` existe (para ter autocompletar) |

### `src/shared`: usado pelos dois lados

| Arquivo | O que faz |
|---|---|
| `ipc.ts` | Nomes dos canais (`IPC_CHANNELS`), ações da janela, as páginas que o app pode abrir no navegador (`EXTERNAL_LINKS`) e o formato do `window.api` (`AppApi`) |
| `i18n/index.ts` | Os idiomas (`Language`, `LANGUAGES` com o nome de cada um na própria língua), `messagesFor()` (os textos de um idioma), `languageFromSystem()` (o idioma pelo do Windows), os status padrão (`StatusPreset`) e `genreLabel()` (um gênero do IGDB no idioma do app) |
| `i18n/ptBR.ts` | **Todos os textos do app em português**: o dicionário base, que define o formato (`Messages`). As funções montam os textos com números e nomes, com o plural certo |
| `i18n/en.ts` | Os mesmos textos em inglês (o TypeScript acusa se faltar alguma chave) |
| `achievements.ts` | As conquistas: a raridade no estilo da PlayStation (`RARITIES` e `rarityOf()`: comum a partir de 50% dos jogadores, rara a partir de 15%, muito rara a partir de 5% e ultrarrara abaixo disso), os tipos de troféu do PS3 (`TROPHY_GRADES`: platina, ouro, prata e bronze; os nomes ficam nos dicionários), o tipo das conquistas do RetroAchievements pelos pontos (`gradeForPoints()`) e o que o main manda para a tela (o progresso de um jogo, as conquistas dele, o resumo da aba e a situação da conta) |
| `evaluation.ts` | A avaliação do usuário: a nota e a dificuldade vão de 1 a 10, em meios ícones (`SCORE_MAX`, `isScore()` e `formatScore()`: 9 → "4,5", ou "4.5" em inglês), o tamanho máximo da análise e o formato que a janela salva (`GameEvaluation`) |
| `types.ts` | Tipos de dados: `DailyPlaytime` (o tempo de um dia, para as Estatísticas), `Game` (o jogo), `Status` (um status), `StatusRules` (as regras automáticas), `LibrarySnapshot` (tudo junto, como a interface recebe) os da aba Emuladores (`EmulatorInfo`, `RetroArchCore`, `RomFolder` e `ScanResult`) e os dos metadados (`MetadataConfig` e `MetadataProgress`) |
| `romFolders.ts` | `suggestFolderSetup()`: sugere emulador, core e console para uma pasta de ROMs pelo nome dela (ex.: "PS2" → PCSX2) |
| `controllers.ts` | Os controles reconhecidos (`SUPPORTED_CONTROLLERS`: DualSense e DualSense Edge), usados pelo main para liberar o acesso e pela interface para mostrar o nome |

### `src/renderer`: interface React

| Arquivo | O que faz |
|---|---|
| `index.html` | HTML da janela. Tem a classe `dark` (tema escuro padrão) e a regra de segurança (CSP), que só aceita imagens do app e do protocolo `playtrove-img:` |
| `main.tsx` | Liga o React na página e carrega o CSS |
| `App.tsx` | Layout: barra do topo + menu lateral + página atual. Guarda a página aberta, o texto da busca, o modo da Biblioteca e a biblioteca (assim nada disso se perde ao trocar de aba). Liga o idioma (`I18nProvider`) e os avisos rápidos (`ToastProvider`) |
| `styles/globals.css` | Tailwind e **todas as cores do app** (variáveis CSS dos temas escuro e claro) |
| `hooks/useI18n.ts` | `useI18n()`: o idioma, os textos dele (`t`, ex.: `t.pages.library`) e `setLanguage()` para trocar |
| `hooks/useLibrary.ts` | A biblioteca que está no banco (jogos, status e regras). Recarrega sozinha quando algo muda. `setGameStatus()` muda o status de um jogo |
| `hooks/useStatuses.ts` | Os status para qualquer componente: `useStatuses()` (a lista) e `useStatusName()` (o nome pelo id) |
| `hooks/useControllers.ts` | Acompanha os controles conectados: aparecem e somem sozinhos, e a bateria é lida de novo a cada 5 segundos |
| `hooks/useEmulators.ts` | Os dados da aba Emuladores (emuladores, cores do RetroArch e pastas de ROMs) e as ações de cada um |
| `hooks/useRunningGames.ts` | Os jogos abertos agora (o main avisa quando um abre ou fecha) |
| `hooks/useToast.ts` | `useToast()`: mostra um aviso rápido no canto da tela (ex.: "3 jogos novos na biblioteca") |
| `hooks/useMetadataProgress.ts` | O andamento do download de metadados, com um aviso de quando a leva termina |
| `hooks/useAchievements.ts` | A conta do RetroAchievements e a situação da atualização (acompanha os avisos do main), as conquistas de um jogo e o resumo da aba Conquistas |
| `lib/dualsense.ts` | Como ler o DualSense: `getConnection()` descobre se ele está no USB ou no Bluetooth, `parseBattery()` tira a bateria dos dados do controle e `readBattery()` abre o controle por um instante para fazer a leitura |
| `lib/utils.ts` | `cn()`: junta classes do Tailwind sem conflito |
| `lib/devBuild.ts` | `isDevBuild`: a janela é a do `npm run dev` (o main põe `?dev=1` no endereço). A barra do topo mostra a marca DEV |
| `lib/format.ts` | Textos no idioma do app: `formatPlaytime()` ("12 h 30 min" ou "12h 30m"), `formatLastPlayed()` ("Hoje", "Há 5 dias", "12/08/2026"), `formatReleaseDate()` ("14/10/2003" ou "10/14/2003"), `formatDateTime()`, `formatTime()`, `listTitles()` (os primeiros nomes e "e mais 2", nos avisos) e `shortCoreName()` (o nome curto de um core do RetroArch, como "mGBA") |
| `lib/filters.ts` | A busca e os filtros: `LibraryFilters` (o que pode ser filtrado), `filterGames()` (quem passa), as faixas de tempo jogado, as de nota e dificuldade (`SCORE_RANGES`) e o período de "Recentes" (`RECENT_DAYS`, 30 dias) |
| `lib/errors.ts` | `errorMessage()`: a mensagem de um erro para mostrar ao usuário |
| `lib/metadata.ts` | `describeMetadataResult()`: o aviso que resume uma leva de downloads de metadados |
| `lib/score.ts` | As contas das estrelas e das pimentas: quanto de cada ícone fica pintado, a nota escolhida pelo clique ou pelo teclado e o texto para leitores de tela ("4,5 de 5 estrelas") |
| `lib/stats.ts` | As contas das Estatísticas: o resumo, os mais jogados, os grupos por plataforma e biblioteca, os jogos por status, o eixo do gráfico de atividade e as colunas dos gráficos por dia e por mês (`dayColumns()` e `monthColumns()`) |
| `lib/achievements.ts` | A cor de cada tipo de troféu (`GRADE_TEXT`), a porcentagem curta de jogadores ("3%", "0,4%") e o progresso em %. As palavras de cada fonte ("conquistas" ou "troféus") ficam nos dicionários (`achievements.sources`) |

#### `src/renderer/pages`: as telas (abas)

| Arquivo | O que faz |
|---|---|
| `index.ts` | Lista das páginas (`PageId`) com o ícone de cada uma (`PAGE_ICONS`): Biblioteca, Estatísticas, Conquistas, Emuladores e Configurações. Os nomes ficam nos dicionários (`pages`) |
| `StatsPage.tsx` | Estatísticas: o resumo, os blocos com barras, a atividade e as listas de jogos. Vazia, mostra um botão para a aba Emuladores |
| `AchievementsPage.tsx` | Conquistas: a conta e o botão "Atualizar", o resumo, os gráficos por dia e por mês, os jogos com o progresso e as desbloqueadas por último. Sem conta, um botão leva às Configurações |
| `LibraryPage.tsx` | Biblioteca nos modos Detalhes (o principal), Grade, Lista e Kanban, com o painel de filtros na direita quando ele está aberto. A filtragem em si fica em `lib/filters.ts`. Vazia, mostra um botão que leva à aba Emuladores |
| `EmulatorsPage.tsx` | Emuladores: onde está cada emulador e as pastas de ROMs, com os botões de procurar jogos. Resume cada procura num aviso rápido (`describeScan()`) |
| `SettingsPage.tsx` | Configurações: seções Geral (o idioma), Status, Metadados, Conquistas e Sobre (nome e **versão do app**) |

#### `src/renderer/components`: pedaços da interface

**Janela e navegação**

| Arquivo | O que faz |
|---|---|
| `TopBar.tsx` | Barra única do topo, no estilo do Playnite: logo, ferramentas da página, o andamento dos metadados, o controle e os botões minimizar, maximizar/restaurar e fechar. O ícone do meio acompanha o estado da janela (canal `window:state`) |
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
| `I18nProvider.tsx` | O idioma para toda a interface (`useI18n()`): começa com o que veio no endereço da janela, confere com o main e troca na hora |
| `RichText.tsx` | Um texto do dicionário com partes em negrito (`**assim**`), usado nos passos a passo das chaves |
| `ToastProvider.tsx` | Os avisos rápidos (`useToast()`): aparecem no canto de baixo, à direita, no máximo 3 de cada vez, e somem sozinhos. O `pinned` fica no alto da pilha enquanto quiser (o aviso de versão nova) |
| `UpdateNotice.tsx` | O aviso de versão nova, no canto dos avisos: "Atualizar" (ou "Baixar", na portátil) e "Agora não"; depois do clique, o andamento do download |
| `UpdateSettings.tsx` | Configurações → Sobre: a situação da atualização, "Procurar atualizações" (ou "Atualizar", com versão nova) e a opção de procurar ao abrir o app |
| `AchievementNotifier.tsx` | Ouve o main e mostra o aviso "Conquista desbloqueada" ou "Troféu desbloqueado" (4 ou mais de uma vez viram um aviso só) |
| `ServiceCard.tsx` | O cartão de um serviço com chave (IGDB, SteamGridDB e RetroAchievements): configurado ou não, os campos, o passo a passo e o botão que abre o site |
| `MetadataSettings.tsx` | Configurações → Metadados: as chaves do IGDB e do SteamGridDB (com o passo a passo para criar cada uma e o botão que abre o site), baixar sozinho para os jogos novos e o botão "Baixar metadados" |
| `AchievementsSettings.tsx` | Configurações → Conquistas: a conta do RetroAchievements (usuário e Web API Key) e a situação da atualização, com "Atualizar agora" |
| `StatusSettings.tsx` | Configurações → Status: renomear, mudar a ordem, criar e apagar status (escolhendo para onde vão os jogos), e as duas regras automáticas |

**Aba Estatísticas**

| Arquivo | O que faz |
|---|---|
| `BarList.tsx` | Lista com barras horizontais de uma cor só: nome, barra proporcional e o valor escrito (os mais jogados, os status, as plataformas...) |
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
| `GameDetailsView.tsx` | Área grande da direita: arte de fundo, a capa acima do título, a estrela de favorito, os botões "Jogar" e "Mais" com a nota e a dificuldade ao lado, "Detalhes" e, na coluna da direita, "Minha análise" em cima da "Descrição". Nos jogos com conquistas, o cartão delas fica à direita do título |

**Biblioteca, modo Grade**

| Arquivo | O que faz |
|---|---|
| `GameGrid.tsx` | Grid responsivo: as colunas se ajustam à largura da janela |
| `GameCard.tsx` | Card do jogo: capa com o status numa faixa embaixo, título, tempo jogado e o progresso nas conquistas, com zoom no hover |
| `GameCover.tsx` | Capa do jogo (retrato, 2:3). Sem capa, ou se ela não carregar, o desenho padrão |

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
| `GameDetailsPanel.tsx` | Painel lateral que abre ao clicar num jogo (Grade, Lista e Kanban; no Kanban ele fica por cima do quadro): o fundo atrás da capa, o título, "Jogar", o menu "Mais", a nota e a dificuldade, as informações e a análise |
| `GameBackdrop.tsx` | A arte de fundo do jogo, que vai sumindo para baixo (modo Detalhes e painel lateral) |
| `GameActionsMenu.tsx` | O menu "Mais" de um jogo: avaliar (abre a `RatingDialog`), escrever ou editar a análise (abre a `ReviewDialog`), baixar metadados, marcar como favorito e mostrar a ROM no Explorador |
| `RatingDialog.tsx` | Janela "Avaliar jogo": a nota em estrelas e a dificuldade em pimentas, as duas com meio ícone (pelo `ScoreInput`) |
| `ReviewDialog.tsx` | Janela "Minha análise": o texto do usuário sobre o jogo (em branco apaga) |
| `ScoreInput.tsx` | Escolher a nota clicando nos ícones (metade esquerda = meio ícone) ou pelo teclado (setas de meio em meio), com o botão "Limpar" |
| `ScoreIcons.tsx` | As cinco estrelas (ou pimentas) só para mostrar, com meio ícone; usada nos detalhes, no painel lateral e na Lista |
| `GameScores.tsx` | "Minha nota" e "Dificuldade" com o rótulo pequeno em cima, no estilo da Steam, ao lado do "Jogar" |
| `icons/PepperIcon.tsx` | O ícone de pimenta, desenhado no traço do lucide (que não tem pimenta) |
| `PlayButton.tsx` | Botão verde "Jogar": abre o jogo no emulador, mostra "Em execução" enquanto ele está aberto e, se não der, um aviso com o motivo |
| `GameInfoList.tsx` | Lista de informações do jogo (Status, Tempo jogado, Última vez jogado, Biblioteca, Plataforma, Gênero, Desenvolvedora, Publicadora e Lançamento) |

**`ui/`**: componentes do shadcn/ui (`button`, `input`, `textarea`, `separator`, `tooltip`, `toggle`, `toggle-group`, `checkbox`, `select`, `dropdown-menu` e `dialog`), criados pelo `npx shadcn add`. O `dropdown-menu` é a lista que abre nos seletores de filtro.

## Onde implementar cada funcionalidade futura

| Quero... | Abra |
|---|---|
| Mudar como a busca e os filtros funcionam | `src/renderer/lib/filters.ts` → `filterGames()` |
| Criar um filtro novo (ex.: Série, quando o `Game` tiver esse dado) | Em `src/renderer/lib/filters.ts`: o campo em `LibraryFilters`, em `EMPTY_FILTERS` e em `hasActiveFilters()`, e a regra em `filterGames()`. Depois, em `src/renderer/components/FilterPanel.tsx`, um item em `VALUE_FILTERS` (as opções e as quantidades são contadas sozinhas) |
| Mudar o período de "Recentes" | `src/renderer/lib/filters.ts` → `RECENT_DAYS` |
| Mudar as tabelas do banco | `src/main/migrations.ts`: uma migração nova no fim de `MIGRATIONS`. Nunca mude uma migração que já saiu numa versão |
| Ler ou gravar algo da biblioteca | `src/main/library.ts`, mais um canal IPC (receita abaixo). Depois de gravar, chame `notifyLibraryChanged()` |
| Mudar os status com que um banco novo começa | `src/main/migrations.ts` → `DEFAULT_STATUSES` (e o nome de cada um nos dois idiomas, em `statusPresets`, nos dicionários de `src/shared/i18n/`). Os status do usuário mudam em Configurações → Status |
| Adicionar informações a um jogo (gênero, capa...) | O campo no tipo `Game` (`src/shared/types.ts`), a coluna na tabela `games` (migração nova) e `toGame()` em `src/main/library.ts` |
| Mostrar essas informações nos detalhes | `src/renderer/components/GameInfoList.tsx` → lista `fields` |
| Suportar outro emulador | `src/main/emulators.ts` → um item novo em `EMULATOR_PRESETS` (nome do executável, lugares comuns, extensões e argumentos; o emulador precisa fechar junto com o jogo) e o id dele em `EmulatorId` (`src/shared/types.ts`). Se ele registrar o tempo jogado, ensine o app a ler em `src/main/emulatorPlaytime.ts` |
| Mudar de onde vêm as capas | `src/main/metadata/download.ts` → a ordem das fontes em `candidates`. Uma fonte nova vira um módulo em `src/main/metadata/` |
| Ver o que o conserto do banco faz | `src/main/databaseFile.ts` → `repairDatabase()`; o texto do aviso fica em `repairNotice.ts` |
| Mudar os argumentos que abrem um jogo (ex.: sem tela cheia) | `src/main/emulators.ts` → `args` do emulador em `EMULATOR_PRESETS` |
| Mudar como o nome do jogo sai do nome do arquivo | `src/main/romScanner.ts` → `titleFromFileName()` |
| Reconhecer outro nome de pasta de ROMs (ex.: "Dreamcast") | `src/shared/romFolders.ts` → `KNOWN_FOLDERS` |
| Mudar o tempo mínimo que conta como jogado | `src/main/library.ts` → `MIN_SESSION_SECONDS` |
| Pôr outro bloco nas Estatísticas (ex.: por gênero) | A conta em `src/renderer/lib/stats.ts` (ex.: `groupGames()` com os gêneros) e o bloco em `src/renderer/pages/StatsPage.tsx` (`StatsCard` + `BarList`) |
| Mudar o período do gráfico de atividade | `ACTIVITY_DAYS` em `src/main/ipc.ts` (e os textos "30 dias" nos dicionários, em `stats`) |
| Mudar a cor das barras dos gráficos | `--chart-bar` em `src/renderer/styles/globals.css` (confira o contraste com o fundo dos cartões: pelo menos 3:1) |
| Mudar as faixas de raridade das conquistas | `src/shared/achievements.ts` → `RARITIES` |
| Mudar quantos pontos do RetroAchievements fazem prata e ouro | `src/shared/achievements.ts` → `GRADE_POINTS` (as cores dos tipos ficam em `--trophy-*` e `--platinum`, em `globals.css`) |
| Mudar de quanto em quanto tempo as conquistas são atualizadas | `src/main/achievements/service.ts` → `INTERVAL_MS` (e as esperas `START_DELAY_MS` e `AFTER_GAME_DELAY_MS`) |
| Achar no RetroAchievements um console que lá tem outro nome | `src/main/achievements/matching.ts` → `PLATFORM_ALIASES` |
| Mudar de quanto em quanto tempo os troféus do RPCS3 são lidos | `src/main/achievements/service.ts` → `TROPHY_INTERVAL_MS` (e `TROPHY_DELAY_MS`) |
| Ler os troféus de outro emulador (ex.: um de PS4) | Um módulo como `src/main/achievements/trophyFiles.ts` para os arquivos dele, guardando nas mesmas tabelas (`trophyStore.ts`) |
| Mostrar um aviso rápido no canto da tela | `useToast()` (`src/renderer/hooks/useToast.ts`), em qualquer componente |
| Pôr outra ação no menu "Mais" (ex.: editar, remover da biblioteca) | `src/renderer/components/GameActionsMenu.tsx`, mais um canal IPC se a ação mexer no banco ou no disco |
| Buscar outro dado nos metadados (ex.: nota, série) | `src/main/metadata/igdb.ts` (o campo em `FIELDS` e em `toIgdbGame()`), `saveGameMetadata()` e `toGame()` em `src/main/library.ts`, a coluna no banco (migração nova) e o campo em `Game` |
| Traduzir mais gêneros | `genres` nos dicionários (`src/shared/i18n/ptBR.ts` e `en.ts`), pelo nome que o IGDB usa |
| Mudar ou criar um texto da tela | `src/shared/i18n/ptBR.ts` e `en.ts` (os dois: o TypeScript acusa se faltar no inglês). Na interface, `const { t } = useI18n()`; no main, `t()` de `src/main/i18n.ts` |
| Criar outro idioma | Um dicionário novo em `src/shared/i18n/` (do tipo `Messages`), o id em `Language`, `LANGUAGES` e `MESSAGES` (`src/shared/i18n/index.ts`) e a regra do Windows em `languageFromSystem()` |
| Reconhecer outro console na busca de metadados | `src/main/metadata/igdb.ts` → `IGDB_PLATFORMS` (o id da plataforma no IGDB) |
| Mudar como o resultado certo da busca é escolhido | `src/main/metadata/matching.ts` → `matchScore()` e `searchTermFor()` |
| Mudar o tamanho ou o tipo das imagens baixadas | `src/main/metadata/steamGridDb.ts` → `IMAGE_QUERIES`; as do IGDB, em `src/main/metadata/download.ts` (`t_cover_big`, `t_1080p`) |
| Mudar onde as imagens aparecem | `GameCover.tsx` (capa), `GameIcon.tsx` (ícone), `GameBackdrop.tsx` (fundo), usados em `GameDetailsView.tsx`, `GameDetailsPanel.tsx`, `GameCard.tsx` e `GameList.tsx` |
| Lembrar o modo de exibição e os filtros ao reabrir o app | `src/renderer/App.tsx` → estados `libraryView` e `libraryFilters` (salvar em algum lugar, ex.: no banco via IPC) |
| Criar outro modo de exibição | `src/renderer/components/LibraryTools.tsx` (`LibraryView` e `VIEWS`) e `src/renderer/pages/LibraryPage.tsx` |
| Opções em Configurações (ex.: tema claro/escuro) | `src/renderer/pages/SettingsPage.tsx`, seção "Geral". O tema é a classe `dark` do `<html>` (`src/renderer/index.html`) |
| Mudar as cores | `src/renderer/styles/globals.css` (bloco `.dark`). Se mudar o fundo, ajuste também `BACKGROUND_COLOR` em `src/main/window.ts` |
| Criar uma página nova no menu | Um arquivo novo em `src/renderer/pages`; o id e o ícone em `pages/index.ts`, e o nome nos dois dicionários (`pages`); mostrar a página em `App.tsx`; e colocar no menu em `components/Sidebar.tsx` (`MAIN_NAV`) |
| Mudar o instalador ou a versão portátil | `electron-builder.config.mjs` (o que vai no pacote, o instalador) e `scripts/dist.mjs` (as duas rodadas: o instalador e o .zip portátil) |
| Mudar o ícone do app | `build/icon.ico` (o .exe, o instalador e a janela no `npm run dev`), `docs/logo.svg` (README) e `src/renderer/components/AppLogo.tsx` (barra do topo). Os três têm o mesmo desenho |
| Mostrar outro modelo de controle (ex.: DualShock 4) | O modelo em `src/shared/controllers.ts` (`SUPPORTED_CONTROLLERS`) e o jeito de ler a bateria dele, como em `src/renderer/lib/dualsense.ts` |
| Importar jogos de outros lugares (Steam, GOG, pastas de jogos de PC) | Código novo no main, como o `src/main/romScanner.ts` faz com as pastas de ROMs, entregue ao React por IPC |
| Usar outro componente do shadcn/ui | Rode `npx shadcn add nome-do-componente`: ele aparece em `src/renderer/components/ui/` |

## Receita: criar um canal IPC novo

Exemplo: um canal `games:set-favorite` para o React marcar um jogo como favorito.

1. **`src/shared/ipc.ts`**: adicione `gamesSetFavorite: "games:set-favorite"` em `IPC_CHANNELS` e a função no `AppApi` (ex.: `games: { setFavorite: (gameId: number, favorite: boolean) => Promise<void> }`).
2. **`src/main/ipc.ts`**: responda com `ipcMain.handle(...)` quando houver resposta, ou `ipcMain.on(...)` quando não houver. Confira tudo o que vier da interface antes de usar (`toId()`, `toText()`). Se mudou a biblioteca, chame `notifyLibraryChanged()`.
3. **`src/preload/index.ts`**: adicione a função no objeto `api`, chamando `ipcRenderer.invoke(...)` (com resposta) ou `ipcRenderer.send(...)` (sem resposta).
4. **No React**: chame `window.api.games.setFavorite(id, true)`.

**No sentido contrário** (o main avisando o React de algo, como "a janela maximizou"), copie o modelo do canal `window:state`:

- **main** (`src/main/ipc.ts`, `sendWindowStateChanges`): `win.webContents.send(canal, dados)` quando o evento acontece.
- **preload** (`src/preload/index.ts`, `onStateChange`): `ipcRenderer.on(canal, ...)` repassando só os dados, e devolvendo uma função que para de ouvir.
- **React** (`src/renderer/components/TopBar.tsx`, `useIsMaximized`): começa a ouvir dentro de um `useEffect` e para de ouvir na limpeza dele.

O `library:changed` segue o mesmo modelo, sem dados: o main só avisa, e o `useLibrary` pede a biblioteca de novo.

Duas regras de segurança:

- Nunca exponha o `ipcRenderer` inteiro nem módulos do Node no preload. Libere só funções específicas.
- Não passe o evento de clique do React para funções do `window.api`. Use `onClick={() => window.api.algo()}`, e não `onClick={window.api.algo}`.

## Histórico e versões (Git e GitHub)

O projeto fica guardado com o Git, e o GitHub guarda uma cópia online, no repositório `LamarcKz/Playtrove` (privado por enquanto). Funciona como os saves de um jogo:

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

A versão tem três números, `MAIOR.MENOR.CORREÇÃO`, no mesmo padrão do [Electron](https://www.electronjs.org/docs/latest/tutorial/electron-versioning):

| Número | Quando sobe | Exemplo |
|---|---|---|
| **CORREÇÃO** (o último) | A versão só corrige erros | 0.2.0 → **0.2.1** |
| **MENOR** (o do meio) | A versão traz coisas novas (e o último volta a 0) | 0.2.1 → **0.3.0** |
| **MAIOR** (o primeiro) | O app fica completo para uso | 0.9.0 → **1.0.0** |

- Enquanto o primeiro número for **0**, o app ainda está sendo construído.
- O número **só muda quando uma versão é lançada**. Enquanto o trabalho acontece, o app continua mostrando o número da última versão (em Configurações → "Sobre").
- **Quem lança:** versões com novidades esperam você dizer "pode lançar". Versões só com correções o Claude lança sozinho, depois de testar, e te avisa.
- **Qual número:** o comando `npm run versao` olha o que mudou desde a última versão e diz qual deve ser a próxima, e por quê.

### Para voltar atrás

É só pedir ao Claude, por exemplo "desfaz a última mudança" ou "volta como estava antes de X":

- mudanças que ainda não viraram commit são guardadas à parte (*stash*) e podem ser recuperadas;
- commits são desfeitos com um commit novo (*revert*), sem apagar nada do histórico;
- uma branch que não deu certo é apagada, e o resto continua intacto;
- qualquer versão lançada pode ser baixada de novo em "Releases".

## Outras informações úteis

- **`npm run dev` e recarga automática:** mudanças na interface (`src/renderer`) aparecem na hora, sem fechar a janela. Mudanças no `src/main`, no `src/preload` ou no `src/shared` fazem o Electron recompilar e reabrir o app sozinho (opção `--watch`).
- **Atalhos de import:** no React, `@/` aponta para `src/renderer` e `@shared/` para `src/shared`. Exemplo: `import { Button } from "@/components/ui/button"`.
- **Onde fica o banco:** `%APPDATA%\Playtrove\playtrove.db` no app instalado, e `%APPDATA%\Playtrove Dev\playtrove.db` no `npm run dev` (uma cópia do primeiro, para o código em teste nunca mexer nos jogos de verdade; `npm run dev:nova-copia` renova). É criado na primeira execução, com as tabelas e os 9 status. A biblioteca começa vazia. Até a versão 0.4.0 o app se chamava Bibliotecaofgames e usava `%APPDATA%\Bibliotecaofgames\bibliotecaofgames.db`: na primeira vez com o nome novo, tudo o que estava lá passa para a pasta nova (`dataFolder.ts`).
- **Testes:** `npm test` roda tudo: os testes rápidos (`npm run test:unit`) e os do app (`npm run test:app`, que compila antes e abre a janela sozinho por alguns segundos). Os testes do app usam uma pasta de dados temporária (variável `PLAYTROVE_DATA_DIR`) com os 12 jogos de exemplo (`PLAYTROVE_SAMPLE_GAMES=1`), então nunca mexem na sua biblioteca, e fingem o idioma do Windows (`PLAYTROVE_SYSTEM_LANGUAGE`: português, e inglês nos testes de idioma). O teste do controle só roda com um DualSense ligado.
- **Aviso de scripts do npm:** o npm 11 pede aprovação para scripts de instalação de pacotes. Os do `better-sqlite3`, do `esbuild` e do `electron-winstaller` estão negados de propósito em `allowScripts`, no `package.json`, porque nenhum dos dois é necessário. Não aprove o do `better-sqlite3`: ele tentaria compilar o SQLite e falharia sem o Visual Studio.
- **`dependencies` × `devDependencies`:** em `dependencies` fica só o que o processo main carrega enquanto o app roda (hoje, o `better-sqlite3` e o `electron-updater`). React, shadcn, Tailwind e o resto ficam em `devDependencies`, porque o Vite já os empacota dentro do app.
- **Tooltip em volta de toggle:** o tooltip do shadcn sobrescreve o atributo `data-state` do botão que ele envolve. Por isso o modo ativo do seletor de modos (Detalhes, Grade, Lista e Kanban) é destacado por `aria-checked` (veja `LibraryTools.tsx`).
- **O que ainda falta:** fica no "Roadmap" do `README.md`, e não no código: aqui só entra o que já funciona.
- **Controle no Bluetooth:** no Bluetooth, o DualSense começa num modo simples, sem a bateria. Para ler a bateria, o app pede o modo completo, o mesmo que a Steam usa, e o controle fica nele até ser desligado. Se algum jogo antigo aberto fora da Steam não reconhecer o controle, feche o app e desligue e ligue o controle.
- **Leitura do controle:** o controle manda uns 250 relatórios por segundo. Por isso o app abre o controle só por um instante, a cada 5 segundos, em vez de deixá-lo aberto (assim não gasta processamento enquanto você joga).
