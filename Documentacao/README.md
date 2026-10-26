# Documentação do ShowVault — leia isto primeiro

Esta pasta é a **memória do projeto**. Toda sessão do Claude começa por aqui e termina atualizando
estes arquivos, para o Gabriel nunca precisar explicar o projeto do zero.

## Ordem de leitura (toda sessão)

1. [01-visao-geral-e-arquitetura.md](01-visao-geral-e-arquitetura.md) — o que é o projeto, como rodar, mapa do código, histórico de segurança.
2. [02-decisoes.md](02-decisoes.md) — decisões já tomadas (não reabrir sem motivo) e decisões pendentes.
3. [03-protocolo-de-sessao.md](03-protocolo-de-sessao.md) — como abrir, executar e **encerrar** uma sessão (inclui o fluxo git até o `main`).
4. [04-roadmap.md](04-roadmap.md) — as 10 seções em ordem de prioridade, com status.
5. O arquivo da seção da sessão atual em [secoes/](secoes/) (ex.: `S01-xss-frontend.md`).
6. [05-diario-de-sessoes.md](05-diario-de-sessoes.md) — o que cada sessão fez e deixou pendente.

## Regras da documentação

- Escrita em português, objetiva, com caminhos de arquivo reais. Não repita o que o código já diz.
- Números de linha são aproximados (auditoria de 2026-10-26); confirme com `grep` antes de editar.
- **Nunca** colocar nesta pasta: e-mails pessoais, senhas, tokens, `JWT_SECRET`, conteúdo de `users.json`.
- Ao fim de cada sessão: atualizar a seção, o roadmap, as decisões (se houve) e o diário. Isso faz parte de "terminar".

## Contexto do dono do projeto

O Gabriel criou a maior parte com o Antigravity AI e **não conhece o código em detalhe**. Explique o que
está fazendo em linguagem simples, mostre o resultado funcionando (navegador/testes) e diga com clareza o
que mudou e o que ficou pendente. Ele quer um fluxo previsível: uma seção por sessão, push até o `main` ao final.
