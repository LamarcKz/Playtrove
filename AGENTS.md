# AGENTS.md — Playtrove

Este é o ponto de entrada do Codex. O guia compartilhado de trabalho fica em [CLAUDE.md](CLAUDE.md), mantido com esse nome para continuar compatível com o Claude Code.

## Antes de trabalhar

1. Leia **todo o `CLAUDE.md`**, inclusive as seções de convenções, privacidade, Git e GitHub, versões e documentação. Se a saída for truncada, leia em blocos até o fim; não trabalhe só com um resumo ou com o começo do arquivo.
2. Aplique ao Codex as orientações e autorizações do guia dirigidas ao Claude. Pedidos atuais do usuário e instruções do ambiente têm precedência; o guia não altera permissões nem libera execução em modo de planejamento.
3. Consulte [ESTRUTURA.md](ESTRUTURA.md) para localizar o código e entender as partes afetadas pela tarefa.
4. Confira `git status -sb` e preserve alterações existentes antes de seguir o fluxo da `desenvolvimento`. Respeite os hooks e a proteção da `main`.

## Continuidade entre agentes

- Siga no guia compartilhado o fluxo de branches, commits, pushes, pull requests, testes e lançamentos, sem pedir novamente por etapas já autorizadas. Escolhas relevantes de produto continuam com o usuário; decisões técnicas internas ficam com o agente dentro do escopo pedido.
- Preserve a biblioteca separada do DEV, os dados temporários dos testes e o aviso antes de abrir janelas. Nunca use dados privados ou emuladores reais nos testes automáticos.
- A memória privada do Claude não é herdada pelo Codex. Peça o contexto necessário apenas quando uma tarefa depender dele; não importe credenciais, caminhos pessoais ou a biblioteca do usuário para arquivos versionados.
- Use as ferramentas disponíveis na sessão e confira caminhos e autenticação quando necessário, sem presumir a configuração de outra ferramenta.
- O estado do projeto, o histórico e as notas do mantenedor ficam fora do repositório. Registre no `CLAUDE.md` só as regras e convenções técnicas que mudarem, e atualize o `ESTRUTURA.md` quando a organização mudar. Mantenha este arquivo curto, sem duplicar o guia compartilhado.
- Estes ajustes são do projeto. Configurações globais, modelo e permissões do Codex só mudam por pedido específico do usuário.
