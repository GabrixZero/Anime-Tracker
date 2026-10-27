# S06 · Animes e busca (Jikan / MyAnimeList)

**Status:** em `Documentacao/status/S06.json` (`npm run status -- S06`) · **Gravidade:** média · **Depende de:** S02 (esquema de ids, escrita segura, fetch tipado) · **Branch:** `feature/s06-animes-e-busca`

## Por que importa
Animes vêm de uma heurística em cima do TVMaze (feito para séries ocidentais) e a busca devolve resultados duplicados ou sem relação.
Foi a primeira tarefa P1 do roadmap original do Gabriel.

## Problemas encontrados
- Busca "Frieren": a mesma obra aparece 3 vezes (entrada local em PT "Frieren e a Jornada para o Além", "Frieren: Beyond Journey's End" e "Sousou no Frieren: ●● no Mahou") e vêm junto
  "Frieden", "Friheden", "2 frères", "Oscar Freire 279" (correspondência difusa do TVMaze). O filtro só ignora nome idêntico ou mesmo id (`mediaService.search`, ~94).
- Detecção de anime inconsistente: na busca (`type==='Animation'` ou gênero Anime/Animation/Action + canal do Japão, ~97) e na ingestão (`Animation` ou gênero Anime, ~176) — a mesma obra
  pode ser `tv` num caminho e `anime` no outro; todo desenho ocidental com tipo "Animation" vira anime.
- TVMaze não tem filmes: busca externa nunca devolve "Filmes".
- Obras ingeridas vêm em inglês (sinopse, status "Running"); sem títulos alternativos; sem rate limit/cache (S02 cria a base).
- Busca dispara requisição a cada Enter/filtro, sem debounce.

## Plano técnico (decisões D-06 e P-07/P-08)
- Nova fonte em `mediaService`: **Jikan v4** (`https://api.jikan.moe/v4`): `GET /anime?q=...&limit=`, `GET /anime/{id}/full`, `GET /anime/{id}/episodes?page=` (paginado).
  Limites: ~3 req/s e 60/min → fila com throttle + cache TTL + retry em 429.
- Ids numéricos em faixa própria (ex.: `10_000_000 + mal_id`; confirmar faixa final na S02) para não quebrar `Number(id)` e `onclick` do frontend.
- Mapear Jikan → formato de obra do catálogo (`type: 'anime'`, `seasons` com episódios, `poster_path` = `images.jpg.large_image_url`, `vote_average` = `score`, `status`, `genres`).
  Guardar `source: 'jikan'` e `externalId` no item.
- MAL separa temporadas/cours em entradas diferentes (P-08): decidir entre tratar cada entrada como obra e/ou agrupar por relações (`/anime/{id}/relations`).
- Busca por tipo: `anime` → Jikan (e catálogo local), `tv` → TVMaze, `movie` → decisão P-07 (TMDB com `TMDB_API_KEY`?). "Todos" combina e **deduplica** por título normalizado + títulos alternativos.
- Relevância: descartar correspondências fracas (ex.: exigir que a consulta apareça no título/alternativos ou score mínimo); ordenar local primeiro, depois por relevância.
- Unificar a detecção de anime (uma função usada na busca e na ingestão para o caminho TVMaze).

## Tarefas
- [x] Cliente Jikan com throttle, cache e erros tipados (reaproveitar o `fetchJson` da S02). → `server/services/jikanClient.js`
- [x] Busca de animes + ingestão on-demand (`ingest` por fonte) gravando no catálogo de runtime. → Jikan (franquia inteira), TVMaze e TMDB
- [x] Deduplicação e filtro de relevância; testes com respostas simuladas (Frieren, Naruto, "One Piece", título em japonês). → `tests/jikan-search.test.js`
- [x] Debounce da busca no frontend; indicador de carregamento e mensagem de erro/limite de requisições. → `exploreView.js`
- [x] Mostrar temporada/cour de forma compreensível no modal e nas listas. → cartões do Explorar ("Outono 2023", "+N partes da franquia", "Filme/OVA"); no modal as abas já usam o nome da temporada ("Temporada 2 · Primavera 2017", "Filme: ..."), sem mudar o modal
- [x] Unificar a detecção de anime no caminho TVMaze. → `MediaService.isAnimeShow`
- [x] Decidir e (se aprovado) integrar filmes (P-07). → D-17: TMDB opcional via `TMDB_API_KEY` (`tmdbClient.js`)

## Decisões (já resolvidas — não pergunte de novo)
**Resolvidas:** D-17 (TMDB opcional via `TMDB_API_KEY`; sem chave segue catálogo local + TVMaze), D-18 (animes agrupados por franquia, em duas etapas), D-11 (faixas de ids por fonte vêm da S02).

## Critério de pronto
Buscar "Frieren", "Naruto", "Attack on Titan" devolve cada obra uma única vez, em ordem relevante, com episódios importáveis e adição à lista funcionando;
nenhum 429 não tratado; testes passando.

## Fora de escopo
Importação de lista da MAL (backlog); sincronizar progresso com a conta MAL.

## Resultado (S06 concluída)
- **Etapa 1 e etapa 2 (D-18) entregues.** Anime = uma obra por franquia, com uma "temporada" para cada entrada ligada por Sequel/Prequel na MAL (ver D-S06-2).
- Verificado com Jikan **simulada** (testes e um servidor falso local): a Jikan real não respondeu a partir da máquina de desenvolvimento (timeout), então **a chamada real à Jikan não foi exercitada**; a primeira coisa a fazer com internet livre é buscar "Frieren" no app e adicionar. Uma falha dessas aparece como aviso na tela e a busca cai para o catálogo local/TVMaze.
- Limites conhecidos: sinopses da Jikan vêm em inglês (sem PT); franquias enormes são cortadas em 12 entradas (`franchise.truncated`); obras ingeridas não são atualizadas depois (série em exibição não ganha episódios novos sozinha); o seed ainda tem 5 animes de amostra (substituídos na busca pela versão real).
