# S06 · Animes e busca (Jikan / MyAnimeList)

**Status:** pendente · **Gravidade:** média · **Depende de:** S02 (esquema de ids, escrita segura, fetch tipado) · **Branch:** `feature/s06-animes-e-busca`

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
- [ ] Cliente Jikan com throttle, cache e erros tipados (reaproveitar o `fetchJson` da S02).
- [ ] Busca de animes + ingestão on-demand (`ingest` por fonte) gravando no catálogo de runtime.
- [ ] Deduplicação e filtro de relevância; testes com respostas simuladas (Frieren, Naruto, "One Piece", título em japonês).
- [ ] Debounce da busca no frontend; indicador de carregamento e mensagem de erro/limite de requisições.
- [ ] Mostrar temporada/cour de forma compreensível no modal e nas listas.
- [ ] Unificar a detecção de anime no caminho TVMaze.
- [ ] Decidir e (se aprovado) integrar filmes (P-07).

## Decisões pendentes
P-07 (filmes via TMDB?) e P-08 (modelagem das temporadas da MAL). Peça ao Gabriel antes de implementar.

## Critério de pronto
Buscar "Frieren", "Naruto", "Attack on Titan" devolve cada obra uma única vez, em ordem relevante, com episódios importáveis e adição à lista funcionando;
nenhum 429 não tratado; testes passando.

## Fora de escopo
Importação de lista da MAL (backlog); sincronizar progresso com a conta MAL.
