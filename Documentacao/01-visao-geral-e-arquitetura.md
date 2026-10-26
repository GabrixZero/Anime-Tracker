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
| `server.js` | Express na `PORT`, `/api/auth`, `/api/media`, `/api/user`, 404 JSON em `/api/*`, handler de erro JSON, estáticos de `public/`, fallback SPA |
| `server/config/config.js` | `PORT`, `DATA_DIR`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `IS_PRODUCTION` |
| `server/middleware/auth.js` | `issueToken(user)` (JWT HS256, claim `sub`) e `requireAuth` (define `req.userId`) |
| `server/controllers/authController.js` + `routes/authRoutes.js` | `register`, `login`, `googleAuth` (**simulado**), `me` |
| `server/models/UserModel.js` | usuários em `server/data/users.json` (scrypt `salt:hash`, migra senha legada no login) |
| `server/models/LibraryModel.js` | biblioteca por usuário em `server/data/libraries/<userId>.json`; valida e grava de forma atômica |
| `server/controllers/userController.js` + `routes/userRoutes.js` | `GET/PUT /api/user/library` (exigem login) |
| `server/services/mediaService.js` | catálogo `server/data/mediaCatalog.json` + busca externa TVMaze + `ingest(id)` (dados externos passam por `utils/sanitize.js`) |
| `server/utils/sanitize.js` | `stripHtml`, `stripHtmlList`, `safeHttpUrl`: tiram HTML/URLs perigosas de dados externos (S01) |
| `server/controllers/mediaController.js` + `routes/mediaRoutes.js` | `/api/media/trending`, `/search`, `/ingest`, `/:id` (rota `/:id` é a última) |

Dados em disco (`server/data/`): `mediaCatalog.json` (versionado, mas reescrito em runtime), `users.example.json` (modelo versionado),
`users.json` e `libraries/` (**ignorados pelo git**, nunca commitar).

## Mapa do frontend (`public/`)

Ordem de carga em `public/index.html` (sem módulos ES; tudo via `window.*`):
`utils/dom.js` → `utils/backupValidator.js` → `apiClient.js` → `state.js` → `syncService.js` → `authView.js` → `nextUpView.js` → `watchlistView.js` → `diaryView.js` →
`statsView.js` → `exploreView.js` → `detailModalView.js` → `appController.js`.

| Arquivo | Papel |
|---|---|
| `js/utils/dom.js` | anti-XSS: `escapeHtml`, `safeUrl`/`safeSrc`, `cssUrl`, `toInt`, `formatRating`. **Todo valor de catálogo/usuário/erro interpolado em HTML passa por aqui** (também roda em Node nos testes) |
| `js/utils/backupValidator.js` | `validateBackup`: valida o backup importado (espelha `LibraryModel.validate`) |
| `js/api/apiClient.js` | `fetch` para `/api`, envia `Authorization: Bearer` (token em `localStorage['showvault_auth_token']`), trata 401 |
| `js/models/state.js` | `AppState`: dados em `localStorage['showvault_state_mvc_v1']` = `{trackedShows, watchedEpisodes, episodeNotes}`; `mediaMap` em memória; `save()` dispara o sync; flag `seeded` (estado demo nunca editado) |
| `js/services/syncService.js` | push com debounce (1,5 s) e `pullAndMerge()` no login; merge por união |
| `js/views/*View.js` | telas: A Seguir, Minha Lista, Meu Diário, Estatísticas, Explorar, modal de detalhes, login |
| `js/controllers/appController.js` | abas, toasts, backup/import/reset, `addToList`/`removeFromList`, `refreshAll()` (re-render geral) |
| `css/` | `variables`, `components`, `layout`, `auth-tvtime` (~1.250 linhas; boa parte do estilo está **inline** no HTML) |

Formato do estado: chaves de episódio `"<id>_s<T>_e<E>"` e filmes `"<id>_movie"`. Ids de obra são **números** e o código usa `Number(id)` e
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
