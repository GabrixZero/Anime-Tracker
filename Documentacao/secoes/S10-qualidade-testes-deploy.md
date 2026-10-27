# S10 · Qualidade, testes e deploy

**Status:** em `Documentacao/status/S10.json` (`npm run status -- S10`) · **Gravidade:** média · **Depende de:** idealmente depois das S01–S09 (consolida e fecha) · **Branch:** `feature/s10-qualidade-testes-deploy`

## Por que importa
Deixar o projeto sustentável (qualquer sessão futura altera sem medo) e publicável de verdade.

## Problemas encontrados
- Estrutura: `public/index.html` tem ~512 linhas/37 KB com ~106 estilos inline (+~63 nos templates JS); ~38 `onclick` inline chamando `window.*` (nextUpView 8, detailModalView 7, exploreView 4, authView 2, diaryView 1, watchlistView 1, index.html 4);
  sem módulos ES (ordem de `<script>` é a única dependência); uma CSP estrita é impossível enquanto houver handlers inline.
- Código duplicado: `escapeHtml` (S01), badge de tipo repetido em 4 views, URLs de fallback copiadas em 5 arquivos, parsing da chave `"id_sN_eM"` repetido em `diaryView`, `statsView` e `state.js`, 3 telas vazias escritas à mão.
- Testes: só `tests/auth-library.test.js` (4 casos); nenhum de rota HTTP, de `mediaService`, de `merge`; nenhum de frontend. `require('UserModel')` cria `server/data/users.json` como efeito colateral.
- Sem linter/formatador; `package.json` com `"main": "app.js"` inexistente, descrição copiada de markdown, sem `engines`.
- README desatualizado (não diz `npm install`, não documenta API/env, promete recursos inexistentes — S08).
- `iniciar.bat` abre o navegador antes do servidor subir e fixa a porta 3000; `push-github.bat` lista branches fixas.
- GitHub Actions: só abrem PRs; `contents: write` é mais do que precisa; `catch` trata qualquer 422 como "nada a mesclar"; o workflow de `develop` roda em `push` **e** em PR fechado; ações fixadas por tag; **não existe CI que rode `npm test`**.
- Deploy: não há Procfile/Dockerfile/health-check; estado em arquivos JSON locais (discos efêmeros perdem usuários e bibliotecas); processo único com I/O síncrono.

## Tarefas
Execução em duas fases (a S09 roda em paralelo e mexe em views/`appController`/`state.js`): **fase A** = tudo que não toca o frontend; **fase B** = limpeza do frontend, depois que a S09 chegar ao `develop`.

**Fase A (feita em 2026-10-27)**
- [x] ESLint + Prettier (config mínima, `npm run lint`, `format:check` só nos arquivos novos); `package.json` corrigido (`main`, `description`, `engines.node`, `scripts`, `private`). Os 3 avisos de lint restantes estão em `watchlistView.js` (2) e `mediaService.js` (`fs` sem uso): ficam para a fase B / S09 para não gerar conflito.
- [x] Testes: rotas HTTP gerais (`routes-http.test.js`: `/health`, 404 de API, estáticos/fallback, catálogo, ingestão, biblioteca com casos de borda), adaptador de armazenamento, migração, fluxo completo com SQLite e partida real do `server.js`, `checkSession`. Total: 258 testes, todos em pastas temporárias e sem rede. (`mediaService` com fetch simulado, `merge` e validações já tinham testes das S02–S06.)
- [x] **CI** em `.github/workflows/ci.yml` (`npm ci`, lint, format, testes, build Docker + `/health`); `auto-pr-*` endurecidos (permissões mínimas, só 422 benigno, uma execução, ações fixadas por hash).
- [x] README completo (requisitos, instalação, `.env`, armazenamento, Docker, API, estrutura, qualidade, branches); `iniciar.bat` (espera o servidor, lê a porta, `npm install` se faltar) e `push-github.bat` (sem branches fixas) atualizados e testados no Windows.
- [x] Deploy (P-09 / D-21): `Dockerfile`, `.dockerignore`, `docker-compose.example.yml`, `GET /health`, variáveis documentadas, persistência SQLite atrás do adaptador `server/storage/` e migração dos JSON existentes com backup. **Falta:** escolher a hospedagem e rodar o primeiro `docker build` real (o job `docker` do CI faz isso).
- [x] `checkSession` só apaga o token em 401 (sem rede/5xx mantém e tenta de novo).
- [x] Revisão de segurança com a checklist de `01-visao-geral-e-arquitetura.md` (registrada lá e no diário). Refazer depois da fase B (CSP).
- [x] Achado extra: o fallback da SPA (`res.sendFile`) devolvia 404 quando o caminho do projeto tem uma pasta com ponto (ex.: `.claude/worktrees`); corrigido com a opção `root`.

**Fase B (aguarda a S09 em `develop`)**
- [ ] Frontend: delegação de eventos (`data-action`) no lugar de TODOS os `onclick`/`onerror` inline em `index.html` e nos templates das views; mover estilos inline restantes para CSS; módulo utilitário único (badge de tipo, fallbacks, parsing da chave `id_sN_eM`, telas vazias); considerar módulos ES (`type="module"`).
- [ ] CSP (via `helmet`) sem `unsafe-inline` (scripts e estilos) depois da limpeza; testar o app inteiro com a CSP ativa (Google Sign-In opcional, SVGs/imagens externas das fontes).
- [ ] Unificar `type-pill-btn`/`pill-btn`/`season-tab-btn`; atualizar a lista de exceções de `tests/a11y.test.js` (`.next-up-thumb-wrap` e `.next-up-show-name` podem sair); Explorar redesenhar após adicionar/remover obra (achado da S03); corrigir os avisos de lint nas views.
- [ ] Repetir a revisão de segurança (agora com CSP).

## Decisões (já resolvidas — não pergunte de novo)
**Resolvida:** D-21 (preparar sem publicar: Dockerfile, `/health`, env documentadas, persistência SQLite com migração dos JSON).

## Critério de pronto
Zero `onclick`/estilo inline relevante; CSP ativa; CI verde no GitHub; README correto; app publicável com persistência e variáveis de ambiente documentadas.

## Fora de escopo
Reescrever em framework (React/Vue); novas funcionalidades (backlog).
