# Documentação do ShowVault — leia isto primeiro

Esta pasta é a **memória do projeto**. Toda sessão do Claude começa por aqui e termina atualizando
estes arquivos, para o Gabriel nunca precisar explicar o projeto do zero.

## Leitura mínima (toda sessão) — D-30

1. Este arquivo.
2. O bloco **"Regras vigentes"** no topo de [02-decisoes.md](02-decisoes.md) (o resto do arquivo é histórico: consulte só a decisão citada).
3. O arquivo da seção em [secoes/](secoes/) e `npm run status -- SNN`.

## Sob demanda (leia só quando a tarefa pedir)

- [01-visao-geral-e-arquitetura.md](01-visao-geral-e-arquitetura.md) — mapa do código, armazenamento, faixas de ids, segurança (ao mexer em arquitetura ou num arquivo que não conhece).
- [03-protocolo-de-sessao.md](03-protocolo-de-sessao.md) — abertura, execução e **encerramento** com o fluxo git até o `main` (ao começar e ao terminar uma seção).
- [04-roadmap.md](04-roadmap.md) — todas as seções e a ordem de prioridade.
- [06-coordenacao-entre-sessoes.md](06-coordenacao-entre-sessoes.md) — quadro de status, dependências, modo subagente, conflitos.
- [diario/](diario/) e [05-diario-de-sessoes.md](05-diario-de-sessoes.md) — histórico por sessão (só o diário da seção que você vai continuar ou que a seção citar).

## Regras da documentação

- Escrita em português, objetiva, com caminhos de arquivo reais. Não repita o que o código já diz.
- Números de linha são aproximados (auditoria de 2026-10-26); confirme com `grep` antes de editar.
- **Nunca** colocar nesta pasta: e-mails pessoais, senhas, tokens, `JWT_SECRET`, conteúdo de `users.json`.
- Ao fim de cada sessão: atualizar a seção, o roadmap, as decisões (se houve) e o diário. Isso faz parte de "terminar".

## Contexto do dono do projeto

O Gabriel criou a maior parte com o Antigravity AI e **não conhece o código em detalhe**. Explique o que
está fazendo em linguagem simples, mostre o resultado funcionando (navegador/testes) e diga com clareza o
que mudou e o que ficou pendente. Ele quer um fluxo previsível: uma seção por sessão, push até o `main` ao final.
