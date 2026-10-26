# Visão geral e arquitetura

## O projeto

**ShowVault / Anime-Tracker** — plataforma no estilo TV Time para rastrear séries, animes e filmes:
progresso episódio por episódio, tempo total assistido, diário de anotações e explorar títulos novos.

- Repositório: https://github.com/GabrixZero/Anime-Tracker (público)
- Pasta local: `C:\Users\Gabri\OneDrive\Documentos\Antigravity Projeto` (dentro do OneDrive; pode causar lock/conflito em escrita de arquivos)
- Stack: Node 20+ (máquina usa v26) + Express 5 (backend REST) + HTML/CSS/JS vanilla no frontend (sem build, sem framework, sem Tailwind).
- Dependências: `express`, `cors`, `jsonwebtoken`. Testes: `node --test` (`npm test`).
- Idioma da interface e do código de domínio: português (pt-BR).

## Como rodar

```bash
npm install
npm start            # node server.js  -> http://localhost:3000
PORT=3055 node server.js   # porta alternativa (útil para testes em paralelo)
npm test
```

`JWT_SECRET` vem do ambiente (veja `.env.example`). Sem ele, fora de produção, usa um segredo de desenvolvimento e avisa.
Com `NODE_ENV=production` sem `JWT_SECRET` o servidor se recusa a iniciar.

## Mapa do backend (`server.js` + `server/`)

| Arquivo | Papel |
|---|---|
| `server.js` | só abre a porta (`PORT`) e roda `LibraryModel.migrateAll()` na partida |
| `server/app.js` | monta o Express: `/api/auth`, `/api/media`, `/api/user`, 404 JSON em `/api/*`, handler de erro JSON, estáticos de `public/`, fallback SPA (sem `listen`: os testes de rotas usam este arquivo) |
| `server/config/config.js` | `PORT`, `DATA_DIR` (padrão `server/data`; **`SHOWVAULT_DATA_DIR`** aponta para outra pasta, usada pelos testes), `JWT_SECRET`, `JWT_EXPIRES_IN`, `IS_PRODUCTION` |
| `server/middleware/auth.js` | `issueToken(user)` (JWT HS256, claim `sub`), `requireAuth` (401 sem token válido; define `req.userId`) e `optionalAuth` (define `req.userId` se houver token válido, senão segue como visitante) |
| `server/controllers/authController.js` + `routes/authRoutes.js` | `register`, `login`, `googleAuth` (**simulado**), `me` |
| `server/models/UserModel.js` | usuários em `server/data/users.json` (scrypt `salt:hash`, migra senha legada no login); leitura/escrita via `jsonStore` (arquivo ilegível = `DataCorruptionError`, nunca lista vazia) |
| `server/models/LibraryModel.js` | biblioteca por usuário em `server/data/libraries/<userId>.json`; valida, grava de forma atômica (com `.bak`) e aplica a migração de versão do estado (`schemaVersion`) no `get`, no `save` (cliente sem `stateVersion`) e em `migrateAll()` |
| `server/controllers/userController.js` + `routes/userRoutes.js` | `GET/PUT /api/user/library` (exigem login) |
| `server/services/mediaService.js` | catálogo = seed versionado + runtime (`mediaCatalog.runtime.json`); busca TVMaze com cache TTL (10 min); `ingest(id)` com trava por id (promessas em andamento), validação da resposta e gravação atômica; `fetchJson` com timeout, limite de tamanho, erros tipados e 1 nova tentativa em 429 (dados externos passam por `utils/sanitize.js`) |
| `server/utils/ids.js` | faixas de ids por fonte (`SOURCES`), `parseId`, `describeId`, `toInternalId` (ver "Esquema de ids") |
| `server/utils/jsonStore.js` | `readJson` / `writeJsonAtomic`: tmp + rename (com tentativas por causa do OneDrive), `.bak` da última versão válida, cópia `.corrupt-*` de arquivo quebrado |
| `server/utils/errors.js`, `httpErrors.js` | `MediaError` (código + status HTTP), `DataCorruptionError` e `sendError` (resposta JSON em português; corrupção = 503) |
| `server/utils/rateLimiter.js` | limitador em memória (hoje: 30 ingestões / 10 min por usuário) |
| `server/utils/sanitize.js` | `stripHtml`, `stripHtmlList`, `safeHttpUrl`: tiram HTML/URLs perigosas de dados externos (S01) |
| `server/controllers/mediaController.js` + `routes/mediaRoutes.js` | `/api/media/trending`, `/search` (públicos; `q` texto até 100 caracteres, `type` ∈ all/tv/anime/movie, senão 400), `POST /ingest` (**exige login**), `/:id` (rota `/:id` é a última; obra já no catálogo = público; obra nova = ingestão, só com login, senão 401) |

Dados em disco (`server/data/`):

| Arquivo | Versionado? | Papel |
|---|---|---|
| `mediaCatalog.seed.json` | sim (somente leitura) | 16 obras iniciais (ids do TMDB, incluindo o filme Batman 155) |
| `mediaCatalog.runtime.json` (+ `.bak`) | **não** (ignorado) | catálogo vivo: criado a partir do seed na primeira execução; obras novas do seed são acrescentadas depois (nunca sobrescrevem); recebe as ingestões. Se estiver ilegível (sem `.bak` válido) o servidor serve só o seed e **bloqueia gravações** (ingestão responde 503) até alguém corrigir |
| `users.example.json` | sim | modelo copiado para `users.json` se este não existir |
| `users.json`, `libraries/` | **não** | contas e bibliotecas (nunca commitar) |
| `*.bak`, `*.corrupt-*`, `*.tmp` | **não** | cópias de segurança/erro geradas pelo `jsonStore` |

Nunca apague um `.corrupt-*` sem olhar: é a única cópia do arquivo que quebrou. Para os testes e servidores de teste use `SHOWVAULT_DATA_DIR=<pasta temporária>`.

## Esquema de ids de obra (D-06 / D-11, definido na S02)

Ids continuam **numéricos**; cada fonte tem uma **faixa própria** (código em `server/utils/ids.js`; a S06 depende disto). `id interno = id da fonte + deslocamento`:

| Fonte | Faixa do id interno | Conta | Estado |
|---|---|---|---|
| Seed (TMDB, curado) | 1 – 999.999 | id nativo do TMDB, sem deslocamento (ex.: Breaking Bad 1396, Batman 155) | ativo (não ingerível: só existe se estiver no seed) |
| TVMaze | 1.000.000 – 1.999.999 | 1.000.000 + id do TVMaze (ex.: Naruto 495 → 1.000.495) | ativo (ingestão sob demanda) |
| Jikan / MAL (anime) | 10.000.000 – 19.999.999 | 10.000.000 + `mal_id` | reservado para a S06 |
| TMDB externo — séries | 20.000.000 – 29.999.999 | 20.000.000 + id de série do TMDB | reservado (D-17) |
| TMDB externo — filmes | 30.000.000 – 39.999.999 | 30.000.000 + id de filme do TMDB | reservado (D-17) |

Séries e filmes do TMDB têm faixas separadas porque o TMDB reutiliza os mesmos números nos dois tipos. As faixas 2–9,99 milhões e acima de 40 milhões estão livres.
Para ativar uma fonte nova (S06): ajustar `ingestable: true` em `SOURCES`, escrever a ingestão no `MediaService` e mapear com `toInternalId('jikan', mal_id)`. Chaves de episódio (`<id>_s1_e1`, `<id>_movie`) e `Number(id)` no frontend seguem funcionando (todos os ids são inteiros seguros).

## Versão do estado e migrações

A biblioteca do usuário tem versão (`STATE_VERSION` em `public/js/utils/migrations.js`, script "dual" navegador/Node). Versão **2** (S02): removeu as referências às 4 obras antigas do TVMaze
(555, 13615, 495 e as chaves `155_sX_eY`; `155_movie` = Batman fica). No navegador a versão fica em `localStorage['showvault_state_version']` (ausente = 1) e `state.js` migra ao carregar;
no servidor cada arquivo de biblioteca tem `schemaVersion`, migrado no `get`, em `migrateAll()` (na partida) e no `PUT` de clientes que não enviam `stateVersion`. Backups exportados trazem `stateVersion`; importar um backup sem versão passa pela migração.
Nova migração = subir `STATE_VERSION` e acrescentar o passo em `migrateLibrary`.

## Mapa do frontend (`public/`)

Ordem de carga em `public/index.html` (sem módulos ES; tudo via `window.*`):
`utils/dom.js` → `utils/backupValidator.js` → `utils/migrations.js` → `apiClient.js` → `state.js` → `syncService.js` → `authView.js` → `nextUpView.js` → `watchlistView.js` → `diaryView.js` →
`statsView.js` → `exploreView.js` → `detailModalView.js` → `appController.js`.

| Arquivo | Papel |
|---|---|
| `js/utils/dom.js` | anti-XSS: `escapeHtml`, `safeUrl`/`safeSrc`, `cssUrl`, `toInt`, `formatRating`. **Todo valor de catálogo/usuário/erro interpolado em HTML passa por aqui** (também roda em Node nos testes) |
| `js/utils/backupValidator.js` | `validateBackup`: valida o backup importado (espelha `LibraryModel.validate`) |
| `js/api/apiClient.js` | `fetch` para `/api`, envia `Authorization: Bearer` (token em `localStorage['showvault_auth_token']`), trata 401 |
| `js/utils/migrations.js` | `STATE_VERSION` e `migrateLibrary(data, fromVersion)` (também roda no servidor) |
| `js/models/state.js` | `AppState`: dados em `localStorage['showvault_state_mvc_v1']` = `{trackedShows, watchedEpisodes, episodeNotes}` (+ versão em `showvault_state_version`, migrada ao carregar); `mediaMap` em memória, **preenchido só pela API** (o catálogo hardcoded foi removido na S02); `save()` dispara o sync; flag `seeded` (estado demo nunca editado) |
| `js/services/syncService.js` | push com debounce (1,5 s) e `pullAndMerge()` no login; merge por união |
| `js/views/*View.js` | telas: A Seguir, Minha Lista, Meu Diário, Estatísticas, Explorar, modal de detalhes, login |
| `js/controllers/appController.js` | abas, toasts, backup/import/reset, `addToList`/`removeFromList`, `refreshAll()` (re-render geral) |
| `css/` | `variables` (tokens, `--fs-meta`, reduced-motion), `components` (botões, cartões, modais base), **`views`** (telas e modais: diário, estatísticas, explorar, detalhes, anotação, backup — S05), `layout` (cabeçalho, navegação e **todos os breakpoints**; abas viram barra inferior ≤1024 px), `auth-tvtime` (login). O HTML quase não tem `style=` inline (só larguras dinâmicas); ver D-S05-1..4 |

Formato do estado (ids de obra: ver "Esquema de ids"): chaves de episódio `"<id>_s<T>_e<E>"` e filmes `"<id>_movie"`. Ids de obra são **números** e o código usa `Number(id)` e
injeta ids sem aspas em `onclick` em ~10 lugares (por isso ids de texto como `mal-123` quebrariam o app).

Formato de uma obra no catálogo: `{id, type: 'tv'|'anime'|'movie', name, overview, poster_path, backdrop_path, vote_average,
first_air_date, genres[], status, runtime? (filmes), seasons: [{season_number, name, episodes: [{episode_number, name, runtime, air_date, overview, still_path}]}]}`.

## Git e ambientes

- `main` = release/produção; `develop` = integração (branch padrão de trabalho); `feature/*` = escopo específico.
- Workflows em `.github/workflows/` só **abrem PRs** automaticamente (feature→develop, develop→main). Não rodam testes.
- Fluxo de encerramento de sessão (push até o `main`): veja [03-protocolo-de-sessao.md](03-protocolo-de-sessao.md).

## Histórico de segurança (não repetir)

- Em 2026-10-25 um `users.json` com e-mail real e senha em texto puro chegou ao GitHub (commit `5fb15a4`). O histórico foi reescrito com force push
  e os dados removidos. O `users.json` agora é ignorado pelo git; senhas usam scrypt com salt.
- 2026-10-26: o login deixou de usar `token_<id>` (forjável) e passou a JWT assinado; biblioteca por usuário no servidor.
- Regras fixas: nunca commitar `users.json`, `libraries/`, `.env`; nunca colocar e-mail/senha reais em código, testes ou docs;
  testes não devem escrever em `server/data` real (use diretório temporário).

## Estado atual do produto (resumo honesto)

Funciona: cadastro/login com JWT, 5 abas (A Seguir, Minha Lista, Meu Diário, Estatísticas, Explorar), marcar episódios, anotações com emoção,
estatísticas, busca em catálogo local + TVMaze, ingestão de temporadas, backup JSON, sincronização da biblioteca com o servidor.
Frágil/falso/incompleto: veja as 10 seções em [04-roadmap.md](04-roadmap.md).
