# Visão geral e arquitetura

## O projeto

**ShowVault / Anime-Tracker** — plataforma no estilo TV Time para rastrear séries, animes e filmes:
progresso episódio por episódio, tempo total assistido, diário de anotações e explorar títulos novos.

- Repositório: https://github.com/GabrixZero/Anime-Tracker (público)
- Pasta local: `C:\Users\Gabri\OneDrive\Documentos\Antigravity Projeto` (dentro do OneDrive; pode causar lock/conflito em escrita de arquivos)
- Stack: Node 26+ (`engines`, `.nvmrc`; D-S10-1) + Express 5 (backend REST) + HTML/CSS/JS vanilla no frontend (sem build, sem framework, sem Tailwind).
- Dependências: `express`, `cors`, `jsonwebtoken`, `helmet`, `compression`, `express-rate-limit`, `google-auth-library`. Testes: `node --test` (`npm test`). Ferramentas (devDependencies, S10): `eslint`, `prettier`. Persistência opcional em SQLite com o módulo embutido `node:sqlite` (sem pacote extra).
- Idioma da interface e do código de domínio: português (pt-BR).

## Como rodar

```bash
npm install
npm start            # node server.js  -> http://localhost:3000
PORT=3055 node server.js   # porta alternativa (útil para testes em paralelo)
npm test
npm run lint               # ESLint: erros quebram, avisos são tolerados (S10)
STORAGE=sqlite SHOWVAULT_DATA_DIR=<pasta> npm start   # dados num único arquivo SQLite (S10, D-S10-2); importa os JSON antigos uma vez, com backup
```

Publicação: `Dockerfile` + `docker-compose.example.yml` (sem hospedagem escolhida; D-S10-5), `GET /health`, CI em `.github/workflows/ci.yml`. Passo a passo no `README.md`.

`JWT_SECRET` vem do ambiente (veja `.env.example`). Sem ele, fora de produção, o servidor **gera um segredo único por instalação** em `server/data/jwt.secret` (ignorado pelo git) e o reaproveita nas próximas partidas (não existe mais segredo padrão público).
Com `NODE_ENV=production` o servidor se recusa a iniciar sem `JWT_SECRET` (mín. 32 caracteres, e nunca o valor do exemplo). Outras variáveis (CORS, proxy, Google, conta demo): README e `.env.example`.

## Mapa do backend (`server.js` + `server/`)

| Arquivo | Papel |
|---|---|
| `server.js` | com `STORAGE=sqlite` importa os JSON antigos (uma vez, com backup) **antes** de carregar o app; abre a porta (`PORT`), roda `LibraryModel.migrateAll()` na partida e fecha o banco em SIGTERM/SIGINT |
| `server/storage/` | (S10) adaptador de armazenamento: `index.js` (escolhe por `STORAGE`; roteia só `users.json`, `libraries/usr_*.json` e `mediaCatalog.runtime.json` para o banco), `fileStore.js` (jsonStore + `stamp`/`listNames`/`removeAll`), `sqliteStore.js` (`node:sqlite`, tabelas `documents`/`corrupt`/`meta`), `migrate.js` (JSON ⇄ SQLite). Ver D-S10-2..4 |
| `scripts/storage.js` | (S10) `npm run storage:migrate` e `npm run storage:export -- <pasta>` |
| `server/app.js` | monta o Express: `helmet` com **CSP estrita** (S10, `server/config/csp.js`: scripts/estilos só do site, sem `unsafe-inline`; HSTS só em produção; COOP `same-origin-allow-popups` por causa do popup do Google), `compression` (gzip, S09), sem `x-powered-by`, CORS por lista (`CORS_ORIGINS`), `GET /health` (S10: `{status, storage, uptimeSec}`, sem login), `/api/auth` (corpo máx. 16 KB), `/api/media`, `/api/user` (atrás de `requireActiveUser`), 404 JSON em `/api/*`, handler de erro JSON, estáticos de `public/` (S09: ETag; `index.html` `no-cache`; CSS/JS/imagens com `STATIC_MAX_AGE_SEC`: 3600 s em produção, 0 fora), fallback SPA (sem `listen`: os testes de rotas usam este arquivo) |
| `server/config/config.js` + `jwtSecret.js` | `PORT`, `STORAGE` (`json` padrão | `sqlite`), `DATA_DIR` (padrão `server/data`; **`SHOWVAULT_DATA_DIR`** aponta para outra pasta, usada pelos testes), `JWT_SECRET` (lido sob demanda: env > `jwt.secret` local gerado > memória), `JWT_EXPIRES_IN`, `IS_PRODUCTION`, `GOOGLE_CLIENT_ID`, `CORS_ORIGINS`, `TRUST_PROXY`, `SEED_DEMO_USER`, `RATE_LIMITS`, `STATIC_MAX_AGE_SEC` (S09) |
| `server/middleware/auth.js` | `issueToken(user)` (JWT HS256, claim `sub`), `requireAuth` (só confere assinatura/validade; define `req.userId`), `requireActiveUser` (= `requireAuth` + a conta ainda existe + token posterior à última troca de senha; usado em `/me`, trocar senha, excluir conta e em todo `/api/user`) e `optionalAuth` (visitante passa) |
| `server/middleware/rateLimit.js` | limites de tentativas (`express-rate-limit`): login por IP+e-mail e por IP (só falhas contam), cadastro por IP, Google por IP, trocar senha/excluir conta por usuário |
| `server/controllers/authController.js` + `routes/authRoutes.js` | `GET /config` (Client ID público do Google ou `null`), `POST /register`, `POST /login`, `POST /google` (ID token validado no servidor; 501 sem `GOOGLE_CLIENT_ID`), `GET /me`, `POST /change-password`, `DELETE /account` (exige a senha ou, em conta Google, credencial recente) |
| `server/utils/validators.js` | validação centralizada das entradas de conta (400 `{error, fields, code:"INVALID_INPUT"}`; nunca 500 por entrada inválida) |
| `server/services/googleAuth.js`, `accountService.js` | verificação do ID token (`google-auth-library`; `__setVerifierForTests` nos testes) · exclusão de conta + arquivos da biblioteca (`libraries/<id>.json*`) |
| `server/models/UserModel.js` | usuários em `server/data/users.json` (scrypt **assíncrono** `salt:hash`, migra senha legada no login; `create`/`updatePassword`/`verifyPassword` são `async`; e-mail único checado na gravação; `passwordChangedAt`; `authInfo` em cache por mtime; conta demo só com `SEED_DEMO_USER=1`); leitura/escrita via `jsonStore` (arquivo ilegível = `DataCorruptionError`, nunca lista vazia) |
| `server/models/LibraryModel.js` | biblioteca por usuário em `server/data/libraries/<userId>.json`; valida, grava de forma atômica (com `.bak`) mescla no `save` (`LibraryMerge.merge`, quando o cliente envia `tombstones`), tem `clear()` e aplica a migração de versão do estado (`schemaVersion`) no `get`, no `save` (cliente sem `stateVersion`) e em `migrateAll()` |
| `server/controllers/userController.js` + `routes/userRoutes.js` | `GET/PUT/DELETE /api/user/library` (exigem login). `PUT` de cliente da S03 **mescla** com o servidor e devolve `{updatedAt, data}`; `DELETE` zera a conta (`resetAt`) |
| `server/services/mediaService.js` | catálogo = seed versionado + runtime (`mediaCatalog.runtime.json`); **busca combinada** (`searchDetailed`: local + Jikan + TVMaze + TMDB, relevância estrita, deduplicação, `warnings` por fonte — ver "Busca e ingestão (S06)"); `ingest(id)` despacha pela faixa do id (TVMaze, Jikan, TMDB), com trava por id e gravação atômica; `fetchJson(url, {retries429, headers})` com timeout, limite de tamanho e erros tipados (dados externos passam por `utils/sanitize.js`) |
| `server/services/jikanClient.js`, `jikanMapper.js` | (S06) cliente da Jikan v4 (fila/throttle, cache, retentativa em 429/5xx, `getFranchise`) e mapeamento MAL → obra (temporadas, status em PT, nulos) |
| `server/services/tmdbClient.js` | (S06) TMDB opcional (`TMDB_API_KEY`): busca de séries/filmes em pt-BR e detalhes com temporadas; desligado sem chave |
| `server/utils/titles.js`, `ttlCache.js`, `httpJson.js` | (S06) normalização/relevância/chave de franquia/"mesma obra?" · cache com validade · GET JSON com erros tipados |
| `server/utils/ids.js` | faixas de ids por fonte (`SOURCES`), `parseId`, `describeId`, `toInternalId` (ver "Esquema de ids") |
| `server/utils/jsonStore.js` | `readJson` / `writeJsonAtomic`: tmp + rename (com tentativas por causa do OneDrive), `.bak` da última versão válida, cópia `.corrupt-*` de arquivo quebrado |
| `server/utils/errors.js`, `httpErrors.js` | `MediaError` (código + status HTTP), `DataCorruptionError` e `sendError` (resposta JSON em português; corrupção = 503) |
| `server/utils/rateLimiter.js` | limitador em memória (hoje: 30 ingestões / 10 min por usuário) |
| `server/utils/sanitize.js` | `stripHtml`, `stripHtmlList`, `safeHttpUrl`: tiram HTML/URLs perigosas de dados externos (S01) |
| `server/controllers/mediaController.js` + `routes/mediaRoutes.js` | `/api/media/trending` (**lista leve, paginada** `?limit=&offset=`), `/search` (públicos; `q` texto até 100 caracteres, `type` ∈ all/tv/anime/movie, senão 400; obras do catálogo vêm leves), **`/batch?ids=`** (S09: detalhe completo de até 50 obras do catálogo, público, nunca ingere), `POST /ingest` (**exige login**), `/:id` (rota `/:id` é a última; obra já no catálogo = público; obra nova = ingestão, só com login, senão 401; devolve o detalhe completo). Ver "Lista leve × detalhe (S09)" |
| `server/utils/mediaLight.js` | (S09) `toListItem` / `toSearchItem`: reduz uma obra do catálogo aos campos do cartão (+ `season_count`, `episode_count`, `light: true`) |
| `scripts/bench-s09.js` | (S09) gera um catálogo **sintético** (perfis `atual` e `grande`, uma obra com 1.100 episódios) e mede o payload de `/trending`: `node scripts/bench-s09.js payload grande`; os testes reaproveitam o gerador |

Dados em disco (`server/data/`):

| Arquivo | Versionado? | Papel |
|---|---|---|
| `mediaCatalog.seed.json` | sim (somente leitura) | 16 obras iniciais (ids do TMDB, incluindo o filme Batman 155) |
| `mediaCatalog.runtime.json` (+ `.bak`) | **não** (ignorado) | catálogo vivo: criado a partir do seed na primeira execução; obras novas do seed são acrescentadas depois (nunca sobrescrevem); recebe as ingestões. Se estiver ilegível (sem `.bak` válido) o servidor serve só o seed e **bloqueia gravações** (ingestão responde 503) até alguém corrigir |
| `users.example.json` | sim | só contém a conta de demonstração; é copiado para `users.json` **apenas** com `SEED_DEMO_USER=1` (fora de produção); sem isso `users.json` nasce vazio |
| `jwt.secret` | **não** (ignorado) | segredo JWT local gerado na primeira execução sem `JWT_SECRET` (apagar = todos precisam entrar de novo) |
| `users.json`, `libraries/` | **não** | contas e bibliotecas (nunca commitar) |
| `*.bak`, `*.corrupt-*`, `*.tmp` | **não** | cópias de segurança/erro geradas pelo `jsonStore` |
| `showvault.sqlite` (+ `-wal`, `-shm`) | **não** | (S10, `STORAGE=sqlite`) substitui `users.json`, `libraries/` e `mediaCatalog.runtime.json`; fica em `SHOWVAULT_DATA_DIR` (volume persistente no Docker) |
| `backup-pre-sqlite-<data>/` | **não** | cópia dos JSON feita antes da migração para SQLite (os originais também ficam) |

Nunca apague um `.corrupt-*` sem olhar: é a única cópia do arquivo que quebrou. Para os testes e servidores de teste use `SHOWVAULT_DATA_DIR=<pasta temporária>`.

## Esquema de ids de obra (D-06 / D-11, definido na S02)

Ids continuam **numéricos**; cada fonte tem uma **faixa própria** (código em `server/utils/ids.js`; a S06 depende disto). `id interno = id da fonte + deslocamento`:

| Fonte | Faixa do id interno | Conta | Estado |
|---|---|---|---|
| Seed (TMDB, curado) | 1 – 999.999 | id nativo do TMDB, sem deslocamento (ex.: Breaking Bad 1396, Batman 155) | ativo (não ingerível: só existe se estiver no seed) |
| TVMaze | 1.000.000 – 1.999.999 | 1.000.000 + id do TVMaze (ex.: Naruto 495 → 1.000.495) | ativo (ingestão sob demanda) |
| Jikan / MAL (anime) | 10.000.000 – 19.999.999 | 10.000.000 + `mal_id` | **ativo (S06)**: ingestão sob demanda; a obra reúne a franquia (ver abaixo) |
| TMDB externo — séries | 20.000.000 – 29.999.999 | 20.000.000 + id de série do TMDB | ativo só com `TMDB_API_KEY` (S06) |
| TMDB externo — filmes | 30.000.000 – 39.999.999 | 30.000.000 + id de filme do TMDB | ativo só com `TMDB_API_KEY` (S06) |

Séries e filmes do TMDB têm faixas separadas porque o TMDB reutiliza os mesmos números nos dois tipos. As faixas 2–9,99 milhões e acima de 40 milhões estão livres.
Para ativar uma fonte nova: ajustar `ingestable: true` em `SOURCES`, escrever a ingestão no `MediaService` e mapear com `toInternalId(fonte, id)` (feito para Jikan e TMDB na S06). Chaves de episódio (`<id>_s1_e1`, `<id>_movie`) e `Number(id)` no frontend seguem funcionando (todos os ids são inteiros seguros).

## Versão do estado e migrações

A biblioteca do usuário tem versão (`STATE_VERSION` em `public/js/utils/migrations.js`, script "dual" navegador/Node). Versão **2** (S02): removeu as referências às 4 obras antigas do TVMaze
(555, 13615, 495 e as chaves `155_sX_eY`; `155_movie` = Batman fica). No navegador a versão fica em `localStorage['showvault_state_version']` (ausente = 1) e `state.js` migra ao carregar;
no servidor cada arquivo de biblioteca tem `schemaVersion`, migrado no `get`, em `migrateAll()` (na partida) e no `PUT` de clientes que não enviam `stateVersion`. Backups exportados trazem `stateVersion`; importar um backup sem versão passa pela migração.
Nova migração = subir `STATE_VERSION` e acrescentar o passo em `migrateLibrary`.

## Mapa do frontend (`public/`)

Ordem de carga em `public/index.html` (sem módulos ES; tudo via `window.*`):
`utils/dom.js` → `utils/actions.js` → `utils/emotions.js` → `utils/markdown.js` → `utils/mediaDisplay.js` → `utils/viewKit.js` → `utils/dialog.js` → `utils/a11y.js` → `utils/libraryMerge.js` → `utils/watchStatus.js` → `utils/backupValidator.js` → `utils/migrations.js` → `apiClient.js` → `state.js` → `syncService.js` → `authView.js` → `nextUpView.js` → `watchlistView.js` → `diaryView.js` →
`statsView.js` → `exploreView.js` → `detailModalView.js` → `appController.js` → `controllers/actionHandlers.js`.

| Arquivo | Papel |
|---|---|
| `js/utils/dom.js` | anti-XSS: `escapeHtml`, `safeUrl`/`safeSrc`, `cssUrl`, `toInt`, `formatRating`. **Todo valor de catálogo/usuário/erro interpolado em HTML passa por aqui** (também roda em Node nos testes) |
| `js/utils/actions.js` | (S10) delegação de eventos: `window.Actions` (`on`, `onChange`, `int`, `fallbacks`) com um ouvinte de `click`, `change` e `error` (captura) no `document`. **Todo clique é `data-action="nome"`** (ou `data-change-action` em `<select>`), com parâmetros em `data-show`/`data-season`/`data-episode`/`data-goto`/`data-mode`; imagem com `data-fallback="poster|still"` troca sozinha pela imagem local. Não existe mais `onclick`/`onchange`/`onerror`/`style=` em HTML nem em template (teste em `tests/s10-frontend.test.js`). Só elementos focáveis (botão, select) levam `data-action` (D-S10-10) |
| `js/controllers/actionHandlers.js` | (S10) a tabela das ações (`goto-tab`, `open-detail`, `quick-check`, `open-note`, `switch-season`, `add-to-list`, `remove-from-list`, `set-status`, `load-more`, `retry-details`, `retry-explore`, `load-example`, `show-all-types`, `auth-mode`) e as imagens reserva; um teste confere que toda ação usada nos templates tem handler e vice-versa. Para criar um botão novo: escreva `data-action="x"` no template e registre `A.on('x', ...)` aqui |
| `js/utils/viewKit.js` | (S10) peças repetidas das telas: `typeBadge`, `imgAttrs` (src + reserva), `parseKey`/`makeKey` (chave `<id>_sN_eM`/`<id>_movie`), `pctClass` (largura de barra = classe `.pct-0`…`.pct-100` em `views.css`) e `emptyStateHtml` (telas vazias) |
| `js/utils/emotions.js` | (S08) tabela única de emoções `window.Emotions` (`LIST`, `label`, `withIcon`, `emptyCounts`); diário e estatísticas leem dela, e um teste confere os botões estáticos do `index.html` |
| `js/utils/markdown.js` | (S08) `window.NoteMarkdown.render(texto)`: escapa e depois converte `**negrito**`, `*itálico*`, `> citação`, `>!spoiler!<` (sem HTML, links ou imagens); `toPlainText`, `toggleSpoiler` e o ouvinte global do spoiler. Usado pelo diário (D-S08-2) |
| `js/utils/mediaDisplay.js` | (S08) `window.MediaDisplay`: "Sem nota"/"Sem gênero", ano/duração só se existirem, tradução de status, caminhos das imagens reserva locais (`public/img/*.svg`) |
| `js/utils/dialog.js` | (S07) `window.Dialog`: transforma os 4 modais em diálogos acessíveis (role/aria-modal, foco inicial, armadilha de Tab, Esc, `inert` no fundo, devolução do foco). Observa a classe `hidden` do overlay, então o código existente que abre/fecha modais não muda. Duplo (Node): fábrica `createDialogManager(doc)` testada com DOM simulado |
| `js/utils/a11y.js` | (S07) liga tudo no `DOMContentLoaded`: registra os modais, espelha a classe `active` em `aria-selected`/`aria-pressed`, setas/Home/End nas abas, e preserva o foco quando uma view redesenha o HTML (`data-focus-key="<grupo>:<id>:<ação>"` nos botões dos templates). Ver D-S07-1..4 |
| `js/utils/backupValidator.js` | `validateBackup`: valida o backup importado (espelha `LibraryModel.validate`; as duas usam `cleanTombstones`/`cleanStamp` de `libraryMerge.js`) |
| `js/utils/libraryMerge.js` | (S03) funções **puras**, navegador + servidor: `merge(local, remote, {now})` com marcas de exclusão e `resetAt`, `replaceWith` (importar backup), `decideLogin` (isolamento por conta), `normalizeData`, `cleanTombstones`. Ver "Biblioteca, sync e remoções" |
| `js/utils/watchStatus.js` | (S03) regra única do status por obra: `STATUS_LIST`, `computeProgress`, `effectiveStatus`, `initialStatus`, `statusAfterProgress`, `isQueueStatus`, `statusOptionsHtml` |
| `js/api/apiClient.js` | `fetch` para `/api`, envia `Authorization: Bearer` (token em `localStorage['showvault_auth_token']`), trata 401 |
| `js/utils/migrations.js` | `STATE_VERSION` e `migrateLibrary(data, fromVersion)` (também roda no servidor) |
| `js/models/state.js` | `AppState`: dados em `localStorage['showvault_state_mvc_v1']` = `{trackedShows, watchedEpisodes, episodeNotes, tombstones, resetAt}` (+ dono em `showvault_last_user`, arquivo de segurança em `showvault_archive_<userId>`, versão em `showvault_state_version`, migrada ao carregar); `mediaMap` em memória, **preenchido só pela API** (o catálogo hardcoded foi removido na S02); `save()` = `persist()` + agenda o sync; métodos `addShow/removeShow/setShowStatus/getStatus/toggleWatched/batchSetSeason/importData/resetLocal/clearForLogout`; flag `seeded` (estado inicial nunca editado; **não há mais demo**: primeira visita = lista vazia); S08: `saveNote` com histórico de versões (`getNoteVersions`, `restoreNoteVersion`, D-S08-1) e `loadExample()` ("Carregar exemplo"); **S09**: `mediaMap` guarda itens **leves** (`light`) e **completos** (`cacheMediaList` × `cacheMediaDetail`, `hasDetail`; leve nunca rebaixa completo), cache de progresso por obra (`getProgress`, `getNextEpisode`, `invalidateProgress`), índice `getEpisode`, `rev`/`prevRev`/`detailsStatus` (D-S09-2..4) |
| `js/services/syncService.js` | `beginSession(user)` (isolamento por conta), `pullAndMerge(user)` no login, push com debounce (1,5 s) que aplica a resposta mesclada do servidor, `retry()`, `flush()`/`logout()`, `wipeCloud()`; estados do selo (`idle/syncing/offline/error/auth`) |
| `css/status.css` | (S03) seletor de status e estados do selo de sync (contrato de classes: `.status-picker`, `.status-select`, `.status-select--card`, `[data-sync-state]`) |
| `js/views/*View.js` | telas: A Seguir, Minha Lista, Meu Diário, Estatísticas, Explorar, modal de detalhes, login |
| `js/controllers/appController.js` | abas, toasts, backup/import/reset, `addToList`/`removeFromList`; **S09**: carrega o detalhe das obras da lista em lote (`onLibraryChanged`, `ensureDetails`), `refreshAll()` (marca as abas como desatualizadas e desenha só a visível), `refreshShow(id)` / `onEpisodeToggled` (troca só o cartão da obra e a linha do modal), `renderTab`, `updateBadges` |
| `css/` | `variables` (tokens, `--fs-meta`, reduced-motion), `components` (botões, cartões, modais base), **`views`** (telas e modais: diário, estatísticas, explorar, detalhes, anotação, backup — S05), `layout` (cabeçalho, navegação e **todos os breakpoints**; abas viram barra inferior ≤1024 px), `auth-tvtime` (login), **`a11y`** (S07, carrega por último: `:focus-visible`, `.sr-only`, link de atalho, visual dos botões que eram `div`). O HTML quase não tem `style=` inline (só larguras dinâmicas); ver D-S05-1..4 |

Formato do estado (ids de obra: ver "Esquema de ids"): chaves de episódio `"<id>_s<T>_e<E>"` e filmes `"<id>_movie"`. Ids de obra são **números** e o código usa `Number(id)` e
passa ids por `data-show`/`data-season`/`data-episode` (lidos com `Actions.int`; antes iam sem aspas em `onclick`) em ~10 lugares (por isso ids de texto como `mal-123` quebrariam o app).

Formato de uma obra no catálogo: `{id, type: 'tv'|'anime'|'movie', name, overview, poster_path, backdrop_path, vote_average,
first_air_date, genres[], status, runtime? (filmes), seasons: [{season_number, name, episodes: [{episode_number, name, runtime, air_date, overview, still_path}]}]}`.

## Git e ambientes

- `main` = release/produção; `develop` = integração (branch padrão de trabalho); `feature/*` = escopo específico.
- Workflows em `.github/workflows/`: `ci.yml` (S10: `npm ci`, lint, `format:check`, testes e build Docker em push/PR) e `auto-pr-*` (abrem PRs feature→develop e develop→main; permissões mínimas, ações fixadas por hash; D-S10-7).
- Fluxo de encerramento de sessão (push até o `main`): veja [03-protocolo-de-sessao.md](03-protocolo-de-sessao.md).

## Histórico de segurança (não repetir)

- Em 2026-10-25 um `users.json` com e-mail real e senha em texto puro chegou ao GitHub (commit `5fb15a4`). O histórico foi reescrito com force push
  e os dados removidos. O `users.json` agora é ignorado pelo git; senhas usam scrypt com salt.
- 2026-10-26: o login deixou de usar `token_<id>` (forjável) e passou a JWT assinado; biblioteca por usuário no servidor.
- Regras fixas: nunca commitar `users.json`, `libraries/`, `.env`; nunca colocar e-mail/senha reais em código, testes ou docs;
  testes não devem escrever em `server/data` real (use diretório temporário).

### Revisão de segurança da S10 (2026-10-27)

**Fase A:**

Conferido (checklist das regras fixas acima): nenhum `users.json`, `libraries/`, `.env`, `jwt.secret` ou `*.sqlite` rastreado pelo git (`git ls-files`); `.gitignore` e `.dockerignore` cobrem bancos e backups de migração; nenhum e-mail real nos testes (um e-mail do perfil Google simulado antigo em `auth-http.test.js` virou `perfil.antigo@gmail.test`); nenhum segredo literal nos arquivos rastreados; `npm audit` sem vulnerabilidades (incluindo `--omit=dev`); o SQLite só usa instruções preparadas com parâmetros (as chaves vêm de `locate()`, que só aceita `users.json`, `mediaCatalog.runtime.json` e `libraries/usr_[A-Za-z0-9_]+.json`; o `userId` já era validado por regex no `LibraryModel`); `/health` só devolve estado, modo de armazenamento e tempo de atividade; os testes provam que `/server/data/users.json`, `/server.js` e `/package.json` não são servidos; a imagem Docker roda sem root, sem segredos embutidos e exige `JWT_SECRET` (produção sem ele não sobe: simulado). (CSP: ver a revisão da fase B abaixo.)

**Fase B (CSP e frontend):** `Content-Security-Policy` enviada em todas as respostas (páginas, estáticos, API, `/health`): `default-src 'self'`; `script-src 'self'` + `accounts.google.com/gsi/client`; `style-src 'self'` + Google Fonts + `accounts.google.com/gsi/style`; `font-src` gstatic; `img-src 'self' data: https: http:` (capas do TMDB/TVMaze/MAL e avatares; em produção `upgrade-insecure-requests` troca http por https); `connect-src`/`frame-src` só `self` e `accounts.google.com/gsi/`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`. **Sem `unsafe-inline` nem `unsafe-eval` em scripts, e sem inline em estilos**, exceto: com `GOOGLE_CLIENT_ID` configurado entra `'unsafe-inline'` só em `style-src` (o botão do Google injeta `<style>`; sem isso ele aparece quebrado; verificado no navegador). Verificado no navegador do app com a CSP ativa (com e sem Google): abas, detalhes, episódios, notas, status, temporadas, Explorar (adicionar/remover), login/cadastro, botão do Google e imagens externas, sem nenhum `securitypolicyviolation` (sem Google). Os testes garantem: nenhum `on*=`/`style=`/`javascript:`/`<script>` ou `<style>` inline no HTML e nos templates, e que o servidor envia o cabeçalho sem `unsafe-*`. Continuam valendo: tudo que vai para HTML passa por `escapeHtml`/`safeUrl`; `cssUrl` só em `element.style` (CSSOM, permitido pela CSP); ids só como inteiros em `data-*`.

## Estado atual do produto (resumo honesto)

Funciona: cadastro/login com JWT, 5 abas (A Seguir, Minha Lista, Meu Diário, Estatísticas, Explorar), marcar episódios, anotações com emoção,
estatísticas, busca em catálogo local + TVMaze, ingestão de temporadas, backup JSON, sincronização da biblioteca com o servidor.
Contas (S04): cadastro/login validados, limite de tentativas, trocar senha e excluir conta na API (ainda **sem tela** no app), login com Google real mas só ativo com `GOOGLE_CLIENT_ID`.
S08: o primeiro acesso é uma lista vazia (chamada para explorar + "Carregar exemplo"); a anotação tem histórico de versões (até 5, restaurar em 1 clique) e Markdown simples com spoiler no diário; a interface mostra "Sem nota"/"Sem gênero"/imagem neutra em vez de valores inventados.
Frágil/falso/incompleto: veja as 10 seções em [04-roadmap.md](04-roadmap.md).

## Biblioteca, sync e remoções (S03)

- **Formato** (cliente e servidor): `{trackedShows[{showId,status,addedAt,updatedAt?}], watchedEpisodes{chave:{watched,watchedAt,updatedAt?,rewatchCount}}, episodeNotes, tombstones:{shows:{id:iso},watched:{chave:iso},notes:{chave:iso}}, resetAt}`.
- **Remoção = marca de exclusão** (D-S03-1): remover obra, desmarcar episódio etc. grava `tombstones.<tipo>[chave] = data`. No merge, para cada chave vence o evento mais recente entre "existe" (`updatedAt`/`watchedAt`/`addedAt`) e "removido"; empate = o item fica. Marcas com mais de 180 dias saem; datas no futuro (relógio errado) são aparadas para agora + 5 min.
- **`resetAt`** = "zerar a conta": tudo com evento anterior a essa data é descartado em qualquer merge. Gravado por `DELETE /api/user/library`.
- **Servidor mescla no PUT** (se o corpo traz `tombstones`); clientes antigos (sem o campo) continuam em snapshot completo/last-write-wins. O `PUT` devolve a biblioteca mesclada e o cliente a aplica.
- **Isolamento por conta**: o estado local tem dono (`showvault_last_user`). Login de outra conta = arquivar (`showvault_archive_<dono>`) e começar do remoto, nunca mesclar; logout envia o que falta (se não der, arquiva) e limpa o navegador; visitante que entra numa conta leva o que fez antes; a próxima entrada da mesma conta recupera o arquivo.
- **Status por obra** (`watchStatus.js`): `watching`, `plan_to_watch`, `paused`, `completed`, `dropped`. Lista, estatísticas e "A Seguir" usam `appState.getStatus`. Adicionar = Quero ver (ou Assistindo/Finalizado se já houver progresso); marcar episódio = Assistindo; último episódio = Finalizado; desmarcar um Finalizado = Assistindo/Quero ver. Pausado/Desisti não entram em "A Seguir".

## Lista leve × detalhe (S09)

**Contrato** (decisões D-S09-1/2):
- **Lista** — `GET /api/media/trending?type=&limit=&offset=` e `GET /api/media/search?q=`: obras **do catálogo** vêm leves: `{id, type, name, original_name?, mal_id?, poster_path, vote_average, first_air_date, genres, status, runtime, season_count, episode_count, light: true}`. Sem `overview`, `seasons`, `backdrop_path`, `alt_titles`, `franchise`. `trending` devolve `{count, total, offset, limit, hasMore, data}` (padrão 60 por página, máx. 200). Resultados **externos** da busca (`isExternal`) seguem completos como a fonte entrega (ainda sem episódios).
- **Detalhe** — `GET /api/media/:id` (uma obra, com ingestão/login como antes) e `GET /api/media/batch?ids=1,2,3` (até 50 obras **já no catálogo**, público, nunca ingere; `missing` = ids que não estão completos). Trazem `overview`, `backdrop_path`, `seasons[].episodes[]` etc.
- **No navegador:** `appState.mediaMap` mistura os dois; o app só confia em episódios quando `appState.hasDetail(id)`. Ao abrir (e a cada sincronização) o controlador baixa o detalhe das obras da lista do usuário em lotes de 50; a aba Explorar usa só a lista leve (+ "Mostrar mais"); abrir o modal de uma obra leve busca o detalhe na hora. Código novo que precise de episódios deve usar `getProgress/getNextEpisode/getEpisode` e tratar "ainda carregando".
- **Render:** `refreshAll()` só desenha a aba visível; `refreshShow(id)` troca um cartão/linha. Quem alterar `data.watchedEpisodes` à mão precisa de `invalidateProgress()`. Templates novos de cartão: `data-show-id`, `data-focus-key` e `loading="lazy" decoding="async"` nas imagens.
- **Métricas** (antes/depois, perfil sintético "grande" 76 obras / 2.900 episódios): ver `diario/2026-10-27-S09.md`. Para repetir: `node scripts/bench-s09.js payload grande`.

## Busca e ingestão (S06)

- **Fluxo da busca** (`GET /api/media/search?q=&type=`): catálogo local (título/alternativos; sinopse só como relevância fraca) → em paralelo Jikan (anime), TVMaze (série; reserva de anime se a Jikan cair) e TMDB (série/filme, só com chave) → descarta o que não contém a consulta em nenhum título → agrupa temporadas da mesma franquia (Jikan) → deduplica (prioridade local > Jikan > TMDB > TVMaze) → ordena por relevância (máx. 30). A resposta é `{query, count, data, warnings:[{source, code, message, retryAfterSec?}]}`. Tudo falhou e nada local casou = erro tipado (429/502). 60 buscas/min por IP.
- **Resultado externo** (`isExternal: true`) ainda não está no catálogo; anime traz `season_label` ("Outono 2023"), `anime_kind` ("Filme", "OVA"...), `related_count` (partes da franquia agrupadas), `episode_count`, `mal_ids`.
- **Ingestão** (`POST /api/media/ingest` ou `GET /:id`, exige login): TVMaze = obra + episódios; **Jikan = franquia inteira** (`/anime/{id}/full` traz as relações; segue Sequel/Prequel até 12 entradas; `/episodes?page=` por entrada) gravada com o id pedido; TMDB = detalhes + temporadas. Campos extras nas obras de anime: `mal_id`, `mal_ids`, `original_name`, `alt_titles`, `franchise:{entries, truncated}`. Uma ingestão de franquia grande leva alguns segundos (fila da Jikan).
- **Sem valores inventados:** quando a fonte não traz, `vote_average`/imagens = `null`, `genres` = `[]`, `runtime` = `null`, `status` = `''` (o frontend decide como exibir: S08).
- **Variáveis:** `TMDB_API_KEY` (opcional, `.env.example`), `JIKAN_BASE_URL` (só testes/dev).
- **Frontend (`exploreView.js`):** busca ao digitar com debounce de 400 ms (mín. 2 letras; Enter/botão buscam na hora), só a resposta da busca mais recente é exibida, indicador "Buscando...", mensagens de erro/limite em português com "Tentar de novo" e avisos de fontes indisponíveis.
