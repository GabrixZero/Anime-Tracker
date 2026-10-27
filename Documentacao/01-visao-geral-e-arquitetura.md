# Visão geral e arquitetura

## O projeto

**ShowVault / Anime-Tracker** — plataforma no estilo TV Time para rastrear séries, animes e filmes:
progresso episódio por episódio, tempo total assistido, diário de anotações e explorar títulos novos.

- Repositório: https://github.com/GabrixZero/Anime-Tracker (público)
- Pasta local: `C:\Users\Gabri\OneDrive\Documentos\Antigravity Projeto` (dentro do OneDrive; pode causar lock/conflito em escrita de arquivos)
- Stack: Node 20+ (máquina usa v26) + Express 5 (backend REST) + HTML/CSS/JS vanilla no frontend (sem build, sem framework, sem Tailwind).
- Dependências: `express`, `cors`, `jsonwebtoken`, `helmet`, `express-rate-limit`, `google-auth-library`. Testes: `node --test` (`npm test`).
- Idioma da interface e do código de domínio: português (pt-BR).

## Como rodar

```bash
npm install
npm start            # node server.js  -> http://localhost:3000
PORT=3055 node server.js   # porta alternativa (útil para testes em paralelo)
npm test
```

`JWT_SECRET` vem do ambiente (veja `.env.example`). Sem ele, fora de produção, o servidor **gera um segredo único por instalação** em `server/data/jwt.secret` (ignorado pelo git) e o reaproveita nas próximas partidas (não existe mais segredo padrão público).
Com `NODE_ENV=production` o servidor se recusa a iniciar sem `JWT_SECRET` (mín. 32 caracteres, e nunca o valor do exemplo). Outras variáveis (CORS, proxy, Google, conta demo): README e `.env.example`.

## Mapa do backend (`server.js` + `server/`)

| Arquivo | Papel |
|---|---|
| `server.js` | só abre a porta (`PORT`) e roda `LibraryModel.migrateAll()` na partida |
| `server/app.js` | monta o Express: `helmet` (sem CSP até a S10; HSTS só em produção; COOP `same-origin-allow-popups` por causa do popup do Google), sem `x-powered-by`, CORS por lista (`CORS_ORIGINS`), `/api/auth` (corpo máx. 16 KB), `/api/media`, `/api/user` (atrás de `requireActiveUser`), 404 JSON em `/api/*`, handler de erro JSON, estáticos de `public/`, fallback SPA (sem `listen`: os testes de rotas usam este arquivo) |
| `server/config/config.js` + `jwtSecret.js` | `PORT`, `DATA_DIR` (padrão `server/data`; **`SHOWVAULT_DATA_DIR`** aponta para outra pasta, usada pelos testes), `JWT_SECRET` (lido sob demanda: env > `jwt.secret` local gerado > memória), `JWT_EXPIRES_IN`, `IS_PRODUCTION`, `GOOGLE_CLIENT_ID`, `CORS_ORIGINS`, `TRUST_PROXY`, `SEED_DEMO_USER`, `RATE_LIMITS` |
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
| `server/controllers/mediaController.js` + `routes/mediaRoutes.js` | `/api/media/trending`, `/search` (públicos; `q` texto até 100 caracteres, `type` ∈ all/tv/anime/movie, senão 400), `POST /ingest` (**exige login**), `/:id` (rota `/:id` é a última; obra já no catálogo = público; obra nova = ingestão, só com login, senão 401) |

Dados em disco (`server/data/`):

| Arquivo | Versionado? | Papel |
|---|---|---|
| `mediaCatalog.seed.json` | sim (somente leitura) | 16 obras iniciais (ids do TMDB, incluindo o filme Batman 155) |
| `mediaCatalog.runtime.json` (+ `.bak`) | **não** (ignorado) | catálogo vivo: criado a partir do seed na primeira execução; obras novas do seed são acrescentadas depois (nunca sobrescrevem); recebe as ingestões. Se estiver ilegível (sem `.bak` válido) o servidor serve só o seed e **bloqueia gravações** (ingestão responde 503) até alguém corrigir |
| `users.example.json` | sim | só contém a conta de demonstração; é copiado para `users.json` **apenas** com `SEED_DEMO_USER=1` (fora de produção); sem isso `users.json` nasce vazio |
| `jwt.secret` | **não** (ignorado) | segredo JWT local gerado na primeira execução sem `JWT_SECRET` (apagar = todos precisam entrar de novo) |
| `users.json`, `libraries/` | **não** | contas e bibliotecas (nunca commitar) |
| `*.bak`, `*.corrupt-*`, `*.tmp` | **não** | cópias de segurança/erro geradas pelo `jsonStore` |

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
`utils/dom.js` → `utils/dialog.js` → `utils/a11y.js` → `utils/libraryMerge.js` → `utils/watchStatus.js` → `utils/backupValidator.js` → `utils/migrations.js` → `apiClient.js` → `state.js` → `syncService.js` → `authView.js` → `nextUpView.js` → `watchlistView.js` → `diaryView.js` →
`statsView.js` → `exploreView.js` → `detailModalView.js` → `appController.js`.

| Arquivo | Papel |
|---|---|
| `js/utils/dom.js` | anti-XSS: `escapeHtml`, `safeUrl`/`safeSrc`, `cssUrl`, `toInt`, `formatRating`. **Todo valor de catálogo/usuário/erro interpolado em HTML passa por aqui** (também roda em Node nos testes) |
| `js/utils/dialog.js` | (S07) `window.Dialog`: transforma os 4 modais em diálogos acessíveis (role/aria-modal, foco inicial, armadilha de Tab, Esc, `inert` no fundo, devolução do foco). Observa a classe `hidden` do overlay, então o código existente que abre/fecha modais não muda. Duplo (Node): fábrica `createDialogManager(doc)` testada com DOM simulado |
| `js/utils/a11y.js` | (S07) liga tudo no `DOMContentLoaded`: registra os modais, espelha a classe `active` em `aria-selected`/`aria-pressed`, setas/Home/End nas abas, e preserva o foco quando uma view redesenha o HTML (`data-focus-key="<grupo>:<id>:<ação>"` nos botões dos templates). Ver D-S07-1..4 |
| `js/utils/backupValidator.js` | `validateBackup`: valida o backup importado (espelha `LibraryModel.validate`; as duas usam `cleanTombstones`/`cleanStamp` de `libraryMerge.js`) |
| `js/utils/libraryMerge.js` | (S03) funções **puras**, navegador + servidor: `merge(local, remote, {now})` com marcas de exclusão e `resetAt`, `replaceWith` (importar backup), `decideLogin` (isolamento por conta), `normalizeData`, `cleanTombstones`. Ver "Biblioteca, sync e remoções" |
| `js/utils/watchStatus.js` | (S03) regra única do status por obra: `STATUS_LIST`, `computeProgress`, `effectiveStatus`, `initialStatus`, `statusAfterProgress`, `isQueueStatus`, `statusOptionsHtml` |
| `js/api/apiClient.js` | `fetch` para `/api`, envia `Authorization: Bearer` (token em `localStorage['showvault_auth_token']`), trata 401 |
| `js/utils/migrations.js` | `STATE_VERSION` e `migrateLibrary(data, fromVersion)` (também roda no servidor) |
| `js/models/state.js` | `AppState`: dados em `localStorage['showvault_state_mvc_v1']` = `{trackedShows, watchedEpisodes, episodeNotes, tombstones, resetAt}` (+ dono em `showvault_last_user`, arquivo de segurança em `showvault_archive_<userId>`, versão em `showvault_state_version`, migrada ao carregar); `mediaMap` em memória, **preenchido só pela API** (o catálogo hardcoded foi removido na S02); `save()` = `persist()` + agenda o sync; métodos `addShow/removeShow/setShowStatus/getStatus/toggleWatched/batchSetSeason/importData/resetLocal/clearForLogout`; flag `seeded` (estado demo nunca editado) |
| `js/services/syncService.js` | `beginSession(user)` (isolamento por conta), `pullAndMerge(user)` no login, push com debounce (1,5 s) que aplica a resposta mesclada do servidor, `retry()`, `flush()`/`logout()`, `wipeCloud()`; estados do selo (`idle/syncing/offline/error/auth`) |
| `css/status.css` | (S03) seletor de status e estados do selo de sync (contrato de classes: `.status-picker`, `.status-select`, `.status-select--card`, `[data-sync-state]`) |
| `js/views/*View.js` | telas: A Seguir, Minha Lista, Meu Diário, Estatísticas, Explorar, modal de detalhes, login |
| `js/controllers/appController.js` | abas, toasts, backup/import/reset, `addToList`/`removeFromList`, `refreshAll()` (re-render geral) |
| `css/` | `variables` (tokens, `--fs-meta`, reduced-motion), `components` (botões, cartões, modais base), **`views`** (telas e modais: diário, estatísticas, explorar, detalhes, anotação, backup — S05), `layout` (cabeçalho, navegação e **todos os breakpoints**; abas viram barra inferior ≤1024 px), `auth-tvtime` (login), **`a11y`** (S07, carrega por último: `:focus-visible`, `.sr-only`, link de atalho, visual dos botões que eram `div`). O HTML quase não tem `style=` inline (só larguras dinâmicas); ver D-S05-1..4 |

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
Contas (S04): cadastro/login validados, limite de tentativas, trocar senha e excluir conta na API (ainda **sem tela** no app), login com Google real mas só ativo com `GOOGLE_CLIENT_ID`.
Frágil/falso/incompleto: veja as 10 seções em [04-roadmap.md](04-roadmap.md).

## Biblioteca, sync e remoções (S03)

- **Formato** (cliente e servidor): `{trackedShows[{showId,status,addedAt,updatedAt?}], watchedEpisodes{chave:{watched,watchedAt,updatedAt?,rewatchCount}}, episodeNotes, tombstones:{shows:{id:iso},watched:{chave:iso},notes:{chave:iso}}, resetAt}`.
- **Remoção = marca de exclusão** (D-S03-1): remover obra, desmarcar episódio etc. grava `tombstones.<tipo>[chave] = data`. No merge, para cada chave vence o evento mais recente entre "existe" (`updatedAt`/`watchedAt`/`addedAt`) e "removido"; empate = o item fica. Marcas com mais de 180 dias saem; datas no futuro (relógio errado) são aparadas para agora + 5 min.
- **`resetAt`** = "zerar a conta": tudo com evento anterior a essa data é descartado em qualquer merge. Gravado por `DELETE /api/user/library`.
- **Servidor mescla no PUT** (se o corpo traz `tombstones`); clientes antigos (sem o campo) continuam em snapshot completo/last-write-wins. O `PUT` devolve a biblioteca mesclada e o cliente a aplica.
- **Isolamento por conta**: o estado local tem dono (`showvault_last_user`). Login de outra conta = arquivar (`showvault_archive_<dono>`) e começar do remoto, nunca mesclar; logout envia o que falta (se não der, arquiva) e limpa o navegador; visitante que entra numa conta leva o que fez antes; a próxima entrada da mesma conta recupera o arquivo.
- **Status por obra** (`watchStatus.js`): `watching`, `plan_to_watch`, `paused`, `completed`, `dropped`. Lista, estatísticas e "A Seguir" usam `appState.getStatus`. Adicionar = Quero ver (ou Assistindo/Finalizado se já houver progresso); marcar episódio = Assistindo; último episódio = Finalizado; desmarcar um Finalizado = Assistindo/Quero ver. Pausado/Desisti não entram em "A Seguir".

## Busca e ingestão (S06)

- **Fluxo da busca** (`GET /api/media/search?q=&type=`): catálogo local (título/alternativos; sinopse só como relevância fraca) → em paralelo Jikan (anime), TVMaze (série; reserva de anime se a Jikan cair) e TMDB (série/filme, só com chave) → descarta o que não contém a consulta em nenhum título → agrupa temporadas da mesma franquia (Jikan) → deduplica (prioridade local > Jikan > TMDB > TVMaze) → ordena por relevância (máx. 30). A resposta é `{query, count, data, warnings:[{source, code, message, retryAfterSec?}]}`. Tudo falhou e nada local casou = erro tipado (429/502). 60 buscas/min por IP.
- **Resultado externo** (`isExternal: true`) ainda não está no catálogo; anime traz `season_label` ("Outono 2023"), `anime_kind` ("Filme", "OVA"...), `related_count` (partes da franquia agrupadas), `episode_count`, `mal_ids`.
- **Ingestão** (`POST /api/media/ingest` ou `GET /:id`, exige login): TVMaze = obra + episódios; **Jikan = franquia inteira** (`/anime/{id}/full` traz as relações; segue Sequel/Prequel até 12 entradas; `/episodes?page=` por entrada) gravada com o id pedido; TMDB = detalhes + temporadas. Campos extras nas obras de anime: `mal_id`, `mal_ids`, `original_name`, `alt_titles`, `franchise:{entries, truncated}`. Uma ingestão de franquia grande leva alguns segundos (fila da Jikan).
- **Sem valores inventados:** quando a fonte não traz, `vote_average`/imagens = `null`, `genres` = `[]`, `runtime` = `null`, `status` = `''` (o frontend decide como exibir: S08).
- **Variáveis:** `TMDB_API_KEY` (opcional, `.env.example`), `JIKAN_BASE_URL` (só testes/dev).
- **Frontend (`exploreView.js`):** busca ao digitar com debounce de 400 ms (mín. 2 letras; Enter/botão buscam na hora), só a resposta da busca mais recente é exibida, indicador "Buscando...", mensagens de erro/limite em português com "Tentar de novo" e avisos de fontes indisponíveis.
