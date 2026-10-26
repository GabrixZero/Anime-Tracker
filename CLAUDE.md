# ShowVault / Anime-Tracker

Rastreador de séries, animes e filmes (Express + HTML/CSS/JS vanilla, sem build). Interface e domínio em português (pt-BR).

**Antes de qualquer coisa, leia `Documentacao/README.md`** e siga a ordem de leitura de lá. A pasta `Documentacao/` é a memória do projeto
(arquitetura, decisões, protocolo de sessão, roadmap por seções, diário). Ao terminar uma sessão você DEVE atualizá-la.

Resumo mínimo:
- Várias sessões podem rodar em paralelo: antes de começar rode `npm run status -- SNN`; se estiver bloqueada ou já em andamento, avise o Gabriel e pare (`Documentacao/06-coordenacao-entre-sessoes.md`).
- Trabalho em seções (S01–S10), uma por sessão, em `feature/sNN-<slug>`; ao final, push até o `main` sem force push (passo a passo em `Documentacao/03-protocolo-de-sessao.md`).
- `npm start` (porta 3000) · `npm test` · use `PORT=3055` para servidores de teste e apague usuários/arquivos de teste criados em `server/data`.
- Nunca commitar `server/data/users.json`, `server/data/libraries/`, `.env`; nunca colocar e-mails/senhas/tokens reais em código, testes ou docs.
- O dono (Gabri) não conhece o código em detalhe: explique em linguagem simples, mostre funcionando, diga o que ficou pendente.
