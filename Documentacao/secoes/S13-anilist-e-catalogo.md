# S13 · AniList como fonte principal de animes e qualidade do catálogo

**Status:** em `Documentacao/status/S13.json` (`npm run status -- S13`) · **Prioridade:** 3 · **Depende de:** nada (S12 ajuda) · **Branch:** `feature/s13-anilist-e-catalogo`

## Por que importa
Em 2026-10-27 a Jikan não respondeu de nenhum lugar (sandbox, máquina do Gabriel fora do sandbox, Chrome do Gabriel e servidores da Anthropic): timeout de conexão em `api.jikan.moe`. A **AniList** (`https://graphql.anilist.co`, GraphQL, sem chave) respondeu em ~1,4 s com Frieren e as temporadas 2 e 3, incluindo `idMal` e relações (SEQUEL/PREQUEL/SIDE_STORY).
Decisão D-26: **AniList principal, Jikan reserva**.

## Pontos técnicos
- **Ids:** obra da AniList com `idMal` usa a faixa da Jikan (`10_000_000 + idMal`), assim as duas fontes descrevem a mesma obra com o mesmo id (dedupe natural e compatível com o que a S06 já gravou). Sem `idMal`: nova faixa `40_000_000 + anilistId` (registrar em `server/utils/ids.js` e na tabela de `01-visao-geral`).
- **Episódios:** a AniList não traz título por episódio; use `episodes` + `airingSchedule` (número e data de exibição) e, quando a Jikan responder, enriqueça com títulos de `/anime/{id}/episodes`. Sem títulos: "Episódio N".
- **Franquia (D-18):** agrupar por relações SEQUEL/PREQUEL como a S06 fez com a Jikan (reaproveite o agrupador).
- **Limites:** AniList ~90 req/min (pode cair para ~30 em degradação): fila com espaçamento, cache, retry em 429 com `Retry-After`.

## Tarefas
- [ ] Cliente `server/services/anilistClient.js` + mapper (busca, detalhe, relações, airingSchedule), com respostas reais gravadas como fixtures de teste (capture uma vez e salve em `tests/fixtures/anilist/`).
- [ ] `MediaService`: anime → AniList; se falhar, Jikan; se ambas falharem, catálogo local/TVMaze (como hoje), com `warnings` por fonte.
- [ ] Smoke test real da Jikan quando ela voltar (registrar resultado no diário); ajustes em `jikanMapper.js` se o formato real divergir.
- [ ] Duplicatas seed × fontes externas (D-S06-4): ao adicionar, reconhecer a obra do seed pelo `mal_id`/títulos e não criar outra.
- [ ] Catálogo de runtime antigo: re-ingestar/atualizar obras gravadas antes da S06 que ainda têm 8.0/"Drama"/Unsplash (migração idempotente com backup).
- [ ] Atualização de obras em exibição (novos episódios): TTL por obra + endpoint de atualização (base para o calendário da S15).
- [ ] "Remover exemplo" em 1 clique (remove só as 4 obras do exemplo, se intocadas).
- [ ] Testes com respostas simuladas para busca, ingestão, fallback e dedupe.

## Critério de pronto
Buscar "Frieren", "Naruto", "Attack on Titan", "One Piece" com a Jikan fora do ar devolve as obras certas via AniList, sem duplicatas, com temporadas agrupadas e episódios importáveis; adicionar à lista funciona; testes verdes.

## Fora de escopo
Importar lista da MAL/AniList (S16); calendário (S15).
