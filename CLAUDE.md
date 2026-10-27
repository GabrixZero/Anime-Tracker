# ShowVault / Anime-Tracker

Rastreador de séries, animes e filmes (Express + HTML/CSS/JS vanilla, sem build). Interface e domínio em português (pt-BR).

A pasta `Documentacao/` é a memória do projeto. **Leitura mínima por sessão:** `Documentacao/README.md`, o bloco **"Regras vigentes"** no topo de
`Documentacao/02-decisoes.md` e o arquivo da seção em `Documentacao/secoes/`. Os demais documentos só quando a tarefa pedir. Ao terminar, atualize a documentação.

- Seções (S01…) uma de cada vez em `feature/sNN-<slug>` a partir de `origin/develop`; antes de começar rode `npm run status -- SNN` (bloqueada ou já em andamento → avise o Gabriel e pare). Ao final, push até o `main` sem force push (`Documentacao/03-protocolo-de-sessao.md`).
- Subagentes (D-30): execução com `model: "sonnet"`, um por vez; Opus só na sessão principal para planejar e revisar.
- `npm start` (porta 3000) · `npm test` · `npm run lint` · `npm run test:e2e` (quando a S12 estiver no `develop`). Servidores de teste em outra porta com `SHOWVAULT_DATA_DIR` temporário; nunca toque em `server/data` real.
- Nunca commitar `server/data/users.json`, `server/data/libraries/`, `.env`, `jwt.secret`, bancos `.sqlite` ou o catálogo de runtime; nada de e-mails/senhas/tokens reais em código, testes ou docs.
- O Gabriel não conhece o código em detalhe: explique em linguagem simples, mostre funcionando, diga o que ficou pendente.
