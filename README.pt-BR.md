<p align="center">
  <a href="README.md">English</a> · <b>Português</b>
</p>

<p align="center">
  <img src="docs/logo.svg" alt="Logo do Playtrove" width="104">
</p>

<h1 align="center">Playtrove</h1>

<p align="center">
  <strong>Todos os seus jogos de PC em uma biblioteca só.</strong><br>
  Gerenciador de biblioteca de jogos para Windows, inspirado no Playnite.
</p>

<p align="center">
  <img alt="Versão 0.9.0" src="https://img.shields.io/badge/vers%C3%A3o-0.9.0-0072d0">
  <img alt="Em desenvolvimento" src="https://img.shields.io/badge/status-em%20desenvolvimento-orange">
  <img alt="Licença MIT" src="https://img.shields.io/badge/licen%C3%A7a-MIT-green">
  <a href="https://github.com/LamarcKz/Playtrove/actions/workflows/tests.yml"><img alt="Testes" src="https://github.com/LamarcKz/Playtrove/actions/workflows/tests.yml/badge.svg"></a>
  <img alt="Windows 10 e 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows&logoColor=white">
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-24C8D8?logo=tauri&logoColor=white">
  <img alt="Rust" src="https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
</p>

<p align="center">
  <a href="https://lamarckz.github.io/Playtrove-site/">Site e guias</a> ·
  <a href="#sobre-o-projeto">Sobre</a> ·
  <a href="#recursos">Recursos</a> ·
  <a href="#capturas-de-tela">Capturas de tela</a> ·
  <a href="#download">Download</a> ·
  <a href="#como-compilar">Como compilar</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

<p align="center">
  <img src="docs/screenshots/pt-BR/library-details.png" alt="A biblioteca no modo Detalhes">
</p>

## Sobre o projeto

Quem joga no PC acaba com os jogos espalhados: parte na Steam, parte na GOG, alguns em emuladores e outros instalados em pastas avulsas, cada um com seu próprio launcher. O **Playtrove** reúne tudo em uma interface só: todos os jogos do computador no mesmo lugar, com capa, informações e tempo jogado, prontos para abrir com um clique.

O visual desktop segue a linha do [Playnite](https://playnite.link/): uma moldura escura com as ferramentas no topo, um menu de ícones à esquerda e a biblioteca no centro. A apresentação em tela cheia acrescenta uma biblioteca horizontal de capas e os detalhes Signature de cada jogo. A biblioteca fica guardada no próprio computador, em um banco de dados local, sem conta e sem depender de internet.

> [!NOTE]
> O projeto ainda está em construção. Por enquanto, os jogos entram pelos emuladores (PCSX2, DuckStation, RetroArch, RPCS3, PPSSPP, Dolphin e Azahar); Steam, GOG e outras lojas estão no [roadmap](#roadmap).

## Recursos

- **Emuladores**: o app encontra sozinho o PCSX2, o DuckStation, o RetroArch (com os cores instalados), o RPCS3, o PPSSPP (PSP), o Dolphin (GameCube e Wii) e o Azahar (3DS). Basta apontar as pastas de ROMs: o emulador, o core e o console são sugeridos pelo nome da pasta, e os jogos entram na biblioteca com o nome limpo, sem "(USA)" e afins.
- **Jogar**: abre o jogo no emulador, com as configurações dele (o RetroArch abre maximizado em janela, a não ser que esteja em tela cheia), e conta sozinho o tempo jogado e a última vez jogado. O tempo que os próprios emuladores registram também entra na biblioteca, então o que foi jogado abrindo o emulador direto aparece do mesmo jeito.
- **Metadados e imagens**: a capa vem do [libretro-thumbnails](https://thumbnails.libretro.com/) (a mesma do RetroArch, sem precisar de chave) e, quando falta, do [SteamGridDB](https://www.steamgriddb.com/), que também dá a arte de fundo; a descrição, os gêneros, a desenvolvedora, a publicadora e a data de lançamento vêm do [IGDB](https://www.igdb.com/). As duas chaves são gratuitas, e o app explica como criar cada uma.
- **Modo Detalhes**: a visão principal da biblioteca. À esquerda fica a lista de jogos, com os ícones. À direita aparecem a arte de fundo, a capa acima do título, os botões **Jogar** e **Mais**, os detalhes e a descrição.
- **Tela cheia**: o tema Aniki ReMake portado. Um assistente inicial passa por perfil, início, estilo da interface, cores, layout dos detalhes, efeitos e trailers, e tudo pode ser mudado depois nas configurações feitas para o controle, que descrevem o item com o foco. Comece no Welcome Hub (perfil, atividade e painéis rápidos) ou na biblioteca, com três layouts de biblioteca, seis de detalhes, 41 paletas de cores ou a cor dinâmica tirada da arte do jogo, logos dos jogos, um perfil com nível de colecionador e a tela geral de troféus. Alterne entre Todos, Recentes e Favoritos ou busque por título na biblioteca inteira. Navegue com DualSense por USB ou Bluetooth, teclado ou mouse; a validação física do controle ainda está pendente. Um teclado virtual atende à busca e às análises, incluindo acentos e pontuação. Favorito, status, nota, dificuldade, análise e conquistas usam a mesma biblioteca do desktop. A tela cheia limita a abertura a um jogo por vez, e fechá-lo devolve aos seus detalhes. Sair da tela cheia restaura a janela e a seleção do desktop. **Configurações → Geral** e as configurações da tela cheia oferecem inicialização opcional nesse modo e controles próprios de reprodução/volume da música; os trailers tocam sem som nos detalhes e, se você quiser, atrás da biblioteca. Mídia e navegação por controle pausam com a janela inativa ou um jogo em execução. A configuração de emuladores e pastas de ROMs continua no desktop.
- **Modo Grade**: capas inteiras centralizadas em áreas iguais 2:3, com fundo neutro nas sobras de imagens de formatos diferentes. A grade se ajusta ao tamanho da janela, com o status numa faixa abaixo da área de cada capa e um painel lateral de detalhes ao clicar em um jogo.
- **Capas inteiras**: Grade, Detalhes e painel lateral preservam a proporção original de cada imagem, sem cortes, distorções ou preenchimento desfocado.
- **Trailers e vídeos de fundo**: com o IGDB configurado, o Playtrove baixa um trailer do YouTube junto dos metadados de cada jogo, em até 720p e 100 MiB, e prepara as ferramentas necessárias na primeira utilização. Ele toca sem som, em repetição, no modo Detalhes, com a imagem de fundo como reserva; com movimento reduzido, começa pausado. Pelo menu **Mais**, escolha um MP4 ou WebM local com prioridade sobre o trailer, remova e desative os vídeos automáticos ou escolha **Usar trailer automático** para reativá-los. O arquivo local original permanece intacto.
- **Música tema por jogo**: a faixa salva toca offline, em repetição, nos modos Detalhes, Grade, Lista e Kanban do desktop. A troca de jogo tem transição suave, e o áudio pausa com a janela inativa, um jogo em execução ou ao sair da Biblioteca. Os controles de reprodução e volume do desktop ficam em **Configurações → Geral**, separados das preferências de áudio da tela cheia; **Metadados** reúne busca automática e download das trilhas. A busca aceita variações do nome e nomes próprios de faixas da soundtrack; uma recomendação forte pode ser baixada automaticamente. Depois dos demais metadados, **Revisar músicas** permite ouvir as candidatas e escolher, ou ajustar a busca pelo nome do jogo ou da música. A audição é carregada somente ao clicar, e a escolha fica salva com prioridade manual. A recomendação é uma estimativa, e a busca pode terminar sem resultado; novas tentativas são explícitas. O menu **Mais** também permite buscar outra faixa ou importar MP3, M4A ou WAV de até 32 MiB. Remover apaga só a cópia interna e desativa o automático daquele jogo; os arquivos originais permanecem intactos. Se a reprodução automática for bloqueada, clique ou pressione uma tecla na Biblioteca para liberar o áudio.
- **Avaliação**: pelo menu **Mais**, dê a sua nota (de meia a cinco estrelas) e marque a dificuldade em pimentas (também com meia); no mesmo menu, escreva a sua análise do jogo. A nota e a dificuldade aparecem ao lado do botão **Jogar**, e a análise, em cima da descrição.
- **Modo Lista**: uma linha por jogo, com o nome, o status, a plataforma, a biblioteca, o tempo jogado, a nota, a dificuldade e as conquistas.
- **Modo Kanban**: um quadro com uma coluna para cada status (Planejo jogar, Jogando, Zerado, Platinado...), todas visíveis de uma vez. Para mudar o status de um jogo, é só arrastá-lo para outra coluna.
- **Status personalizáveis**, como os do Playnite: dá para criar, renomear, mudar a ordem e apagar os status. Também há duas regras automáticas: jogo novo entra em "Planejo jogar" e, na primeira vez que é jogado, vai para "Jogando".
- **Conquistas**: com a sua conta do [RetroAchievements](https://retroachievements.org/), as conquistas dos jogos de emulador aparecem na biblioteca como troféus do PlayStation: bronze, prata e ouro (pela dificuldade de cada conquista) e a platina para quem desbloqueia todas, com a raridade de cada uma (comum, rara, muito rara e ultrarrara). O progresso aparece na lista de jogos, na Grade, no modo Lista e num cartão ao lado do título; a aba **Conquistas** junta o resumo, os gráficos por dia e por mês, os jogos e as desbloqueadas por último. O app confere o site a cada 5 minutos e ao fechar um jogo, e avisa quando aparece uma conquista nova.
- **Troféus do PS3**: os troféus que o RPCS3 guarda também aparecem, sem precisar de conta: bronze, prata, ouro e platina, como no console, com os troféus ocultos escondidos até você pedir para ver.
- **Estatísticas**: tempo jogado total e a média por jogo, os 10 mais jogados, os jogos por status, por plataforma e por biblioteca, a atividade dos últimos 30 dias, os jogados por último e os nunca jogados.
- **Leitura e organização**: Estatísticas, Conquistas, Configurações e Emuladores adaptam colunas, textos e ações ao espaço disponível na janela.
- **Barra de ferramentas no topo**: a busca (que acha o jogo mesmo sem acentos), o botão de filtros e a troca entre os modos de exibição ficam sempre à mão.
- **Painel de filtros**: na direita, como no Playnite. Favoritos e Recentes ficam em caixinhas. Status, Tempo jogado, Nota, Dificuldade, Biblioteca, Plataforma, Gênero, Desenvolvedora, Publicadora e Ano de lançamento são seletores em que dá para marcar várias opções, e cada opção mostra quantos jogos ela tem.
- **Favoritos**: marque os jogos preferidos pelo menu **Mais**.
- **Controle conectado**: com um DualSense ligado, a barra do topo mostra se ele está no USB ou no Bluetooth, quanto de bateria ele tem e se está carregando.
- **Instalador e versão portátil**: um instalador pequeno (uns 5 MB) ou o .zip portátil, que guarda tudo na própria pasta. Quando sai uma versão nova, o app avisa e se atualiza com um clique.
- **Janela própria**: sem a barra do Windows, com os botões minimizar, maximizar/restaurar e fechar integrados à interface.
- **Português e inglês**: o app inteiro nos dois idiomas. Na primeira vez, ele segue o idioma do Windows; depois, é só trocar em Configurações → Geral, e a troca vale na hora. Os status que vêm com o app mudam de nome junto, e as datas e os números seguem o formato de cada idioma.
- **Tema escuro**.

## Capturas de tela

Capturas com uma biblioteca de demonstração.

<table>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/fullscreen-library.png" alt="Biblioteca em tela cheia com uma faixa horizontal de capas">
      <p align="center"><sub>Biblioteca em tela cheia</sub></p>
    </td>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/fullscreen-details.png" alt="Detalhes Signature de um jogo em tela cheia">
      <p align="center"><sub>Detalhes Signature em tela cheia</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/library-kanban.png" alt="A biblioteca no modo Kanban, com uma coluna para cada status">
      <p align="center"><sub>Modo Kanban</sub></p>
    </td>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/library-list.png" alt="A biblioteca no modo Lista, com as colunas Nome, Status, Tempo jogado, Nota, Dificuldade e Conquistas">
      <p align="center"><sub>Modo Lista</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/achievements.png" alt="Aba Conquistas, com o resumo, os gráficos por dia e por mês e os jogos com os troféus de cada tipo">
      <p align="center"><sub>Conquistas e troféus</sub></p>
    </td>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/rating.png" alt="Janela de avaliação, com a nota em estrelas e a dificuldade em pimentas">
      <p align="center"><sub>Avaliação do jogo</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/library-grid.png" alt="A biblioteca no modo Grade">
      <p align="center"><sub>Modo Grade</sub></p>
    </td>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/filters.png" alt="Painel de filtros com o seletor de Status aberto">
      <p align="center"><sub>Painel de filtros</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/library-grid-panel.png" alt="Modo Grade com o painel de detalhes de um jogo aberto">
      <p align="center"><sub>Painel de detalhes no modo Grade</sub></p>
    </td>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/statistics.png" alt="Aba Estatísticas, com o resumo, os mais jogados e a atividade por dia">
      <p align="center"><sub>Estatísticas</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/metadata.png" alt="Configurações de metadados, com o passo a passo para criar as chaves">
      <p align="center"><sub>Metadados e imagens</sub></p>
    </td>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/settings-statuses.png" alt="Configurações: a lista de status, com a ordem, os jogos de cada um e as regras automáticas">
      <p align="center"><sub>Configurações → Status</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/music.png" alt="Configurações da música tema: reprodução e volume">
      <p align="center"><sub>Configurações da música tema</sub></p>
    </td>
    <td width="50%">
      <img src="docs/screenshots/pt-BR/music-review.png" alt="Opções da soundtrack com controles para ouvir, escolher e pesquisar">
      <p align="center"><sub>Ouvir e escolher a soundtrack</sub></p>
    </td>
  </tr>
</table>

## Download

Baixe a versão mais recente na página de [Releases](https://github.com/LamarcKz/Playtrove/releases/latest):

- **`Playtrove-Setup-X.Y.Z.exe`**: o instalador. Instala só para você, sem pedir administrador, com atalhos no menu Iniciar e na Área de Trabalho. Quando sai uma versão nova, o app avisa e se atualiza com um clique.
- **`Playtrove-X.Y.Z-portable.zip`**: a versão portátil. Descompacte onde quiser e abra o `Playtrove.exe`: a biblioteca fica na pasta `data`, ao lado dele.

> [!NOTE]
> O app ainda não tem assinatura digital, então o Windows pode mostrar "O Windows protegeu o computador" na primeira vez. Clique em **Mais informações** e depois em **Executar assim mesmo**.

As novidades de cada versão ficam na mesma página. Os números seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/) (`MAIOR.MENOR.CORREÇÃO`).

**Requisitos:** Windows 10 ou 11, 64 bits.

## Privacidade

O Playtrove não coleta nada sobre você. A biblioteca, as notas e as análises ficam num banco de dados no seu computador, e as chaves das APIs são trancadas pelo Windows. O app usa a internet para baixar os metadados e as imagens dos jogos (IGDB, SteamGridDB e libretro-thumbnails), os trailers e as músicas tema (YouTube) e suas ferramentas (releases oficiais no GitHub), para ler as suas conquistas (RetroAchievements, se você colocar a sua conta) e para conferir no GitHub se há versão nova (dá para desligar em Configurações → Sobre).

## Bugs e ideias

Achou um bug? No app, vá em **Configurações → Sobre → Reportar um problema**: ele abre o formulário no GitHub com a sua versão já preenchida. Também dá para [abrir uma issue](https://github.com/LamarcKz/Playtrove/issues/new/choose) direto, em português ou em inglês. Ideias também são bem-vindas. Para problemas de segurança, veja o [SECURITY.md](SECURITY.md).

Pull requests são bem-vindos; rode o `npm test` antes de mandar.

## Como compilar

Você vai precisar do [Node.js](https://nodejs.org/) 22.12 ou mais novo, do [Git](https://git-scm.com/) e do [Rust](https://www.rust-lang.org/tools/install) (estável), que no Windows também pede o Visual Studio Build Tools com a parte de C++. O primeiro `npm run dev` compila a parte em Rust, o que leva alguns minutos; depois, só o que mudou.

```bash
git clone https://github.com/LamarcKz/Playtrove.git
cd Playtrove
npm install
npm run dev
```

O `git clone` traz a branch `main`, com a última versão estável. O desenvolvimento acontece na branch `desenvolvimento`: para testar o que está em andamento, rode `git switch desenvolvimento` antes do `npm install`.

| Comando | O que faz |
|---|---|
| `npm run dev` | Abre o app em modo de desenvolvimento: a interface atualiza sozinha a cada alteração, e o app reabre quando o código em Rust muda. Ele usa uma cópia da biblioteca do app instalado (`%APPDATA%\Playtrove Dev`), para o código em teste nunca mexer nos seus jogos de verdade |
| `npm run dev:nova-copia` | Joga essa cópia fora (com o app do dev fechado); o próximo `npm run dev` copia a biblioteca de novo |
| `npm run build` | Confere os tipos e gera a interface compilada em `out/web` |
| `npm run typecheck` | Só confere os tipos do TypeScript |
| `npm test` | Roda todos os testes automáticos: os da lógica da interface, os da parte em Rust e os que abrem o app e clicam como uma pessoa |
| `npm run dist` | Gera o instalador, a versão portátil e os arquivos da atualização em `dist/` (assinar as atualizações pede a chave privada de quem mantém o projeto) |

Quer entender o código? O guia com o que cada pasta e arquivo faz, e onde implementar cada funcionalidade, está em [ESTRUTURA.md](ESTRUTURA.md).

## Roadmap

- Centro de controle durante o jogo na tela cheia, mídia extra (player, galeria, abertura e proteção de tela), ferramentas e conectores
- Importação de jogos da Steam, da GOG e de pastas de jogos do computador
- Mais emuladores
- Editar as informações de um jogo e escolher outra capa
- Lembrar o modo de exibição e os filtros ao abrir o app de novo
- Opções de personalização, como o tema claro
- Links para a página de cada jogo

## Tecnologias

- [Tauri](https://tauri.app/) e [Rust](https://www.rust-lang.org/), com a interface gerada pelo [Vite](https://vite.dev/)
- [React](https://react.dev/) e [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/) e ícones [Lucide](https://lucide.dev/)
- [SQLite](https://sqlite.org/) com [rusqlite](https://github.com/rusqlite/rusqlite)
- Testes com [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/) e os do próprio Rust (`cargo test`)

## Créditos

- O visual é inspirado no [Playnite](https://playnite.link/), um projeto independente, sem ligação com este.
- A tela cheia é um porte do tema [Aniki ReMake](https://github.com/Mike-Aniki/Aniki-ReMake) e do [Aniki Helper](https://github.com/Mike-Aniki/AnikiHelper), de Mike Aniki (licença MIT; ver [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)). A fonte [Exo 2](https://fonts.google.com/specimen/Exo+2) tem a licença SIL Open Font License.
- Os ícones vêm do [Lucide](https://lucide.dev/) (licença ISC).
- Os metadados dos jogos vêm do [IGDB](https://www.igdb.com/) (da Twitch); as capas, do [libretro-thumbnails](https://thumbnails.libretro.com/), o acervo da comunidade do [RetroArch](https://www.retroarch.com/); e as artes de fundo (e as capas que faltarem), do [SteamGridDB](https://www.steamgriddb.com/), feitas pela comunidade.
- O download de trailers e músicas tema usa [yt-dlp](https://github.com/yt-dlp/yt-dlp) e [Deno](https://github.com/denoland/deno), baixados das releases oficiais e verificados antes do uso.
- As conquistas vêm do [RetroAchievements](https://retroachievements.org/), um projeto da comunidade, sem ligação com este.
- Os nomes de jogos, consoles e serviços pertencem aos seus donos. PlayStation e DualSense são marcas da Sony Interactive Entertainment; o Playtrove não tem ligação com a Sony nem com os serviços acima.

## Licença

O Playtrove é software livre, com a [licença MIT](LICENSE).
