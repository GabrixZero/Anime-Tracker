# S02 · Dados e catálogo (backend)

**Status:** em `Documentacao/status/S02.json` (`npm run status -- S02`) · **Gravidade:** alta · **Depende de:** S01 (sanitização compartilhada) · **Branch:** `feature/s02-dados-e-catalogo`

## Por que importa
Há risco real de **perder todos os usuários ou todo o catálogo**, o catálogo pode ser poluído por qualquer visitante, e ids de fontes diferentes colidem.

## Problemas encontrados
- `server/models/UserModel.js`: `getAll()` devolve `[]` em qualquer erro de leitura/parse e `saveAll()` regrava o arquivo inteiro sem escrita atômica →
  o próximo `create()` sobrescreve `users.json` só com o novo usuário (apaga todas as contas).
- `server/services/mediaService.js`: `saveCatalog()` regrava o catálogo inteiro de forma síncrona, sem tmp+rename; `loadCatalog` cai para `[]` em erro e o
  próximo `ingest` salva um catálogo de 1 item. Sem trava por id: `ingest` concorrente duplica trabalho. A pasta é do OneDrive (pode travar arquivos).
- `fetchJson` ignora o status HTTP. O TVMaze responde `{"name":"Not Found",...,"status":404}` para id inexistente; a guarda `!data || !data.name` (~149) deixa passar
  e grava uma "obra" lixo (sem `id`) no disco a cada tentativa. 429 (rate limit) tem o mesmo formato.
- `POST /api/media/ingest` e `GET /api/media/:id` (que dispara ingestão) **não exigem login** e escrevem no catálogo compartilhado; `id` não é validado (`NaN` vai para a URL).
- `req.query.q` repetido (`?q=a&q=b`) vira array e quebra `trim()` (500); `type` não é validado; erros viram 500 genérico.
- Colisão de ids: o seed usa ids do TMDB (1396, 136283, 155...), a ingestão usa ids do TVMaze. TVMaze 1396 é "King of the Nerds" (nunca poderá ser adicionado);
  o catálogo tem "Beauty & the Beast" (TVMaze 155) onde deveria estar o filme Batman (TMDB 155) — `Object.assign(existing, fullMedia)` sobrescreveu.
  Há também um seed duplicado de 15 obras hardcoded em `public/js/models/state.js` (~13–323), com ids/dados que divergem do servidor.
- `mediaCatalog.json` (293 KB, 19 obras) é versionado no git **e** reescrito em runtime (árvore suja, conflitos, perda em disco efêmero).
- `this.cache` em `MediaService` existe e nunca é usado; sem tratamento de rate limit do TVMaze (~20 req/10 s).

## Tarefas
- [ ] Utilitário de escrita atômica de JSON (tmp + `renameSync`, como o `LibraryModel`) usado por `UserModel` e `MediaService`; manter cópia `.bak` da última versão boa.
- [ ] Leitura segura: erro de parse **não** pode virar "lista vazia gravável". Falhar alto (log + tentar `.bak`) e nunca sobrescrever dados que não foi possível ler.
- [ ] `fetchJson`: checar `statusCode`; tratar 404/429/5xx com erros tipados; timeout e 1 retry com espera para 429.
- [ ] `ingest`: validar `id` inteiro positivo, exigir `data.id === id`, descartar respostas de erro; trava por id (mapa de promessas em andamento); usar o sanitizador da S01.
- [ ] Exigir login (`requireAuth`) em `POST /api/media/ingest` e na ingestão disparada por `GET /api/media/:id` (ou separar leitura de ingestão); limitar frequência.
- [ ] Validar `type`, `q` (string, tamanho máx.), `id`; responder 400 com mensagem, não 500.
- [ ] **Esquema de ids** (decisão P-01): definir faixas por fonte, migrar as 4 obras ingeridas e as bibliotecas existentes (`localStorage` e `server/data/libraries/*.json`), restaurar Batman (155).
- [ ] Unificar o seed: uma única fonte de verdade (servidor); remover o catálogo hardcoded de `state.js` (ou gerá-lo a partir da API).
- [ ] Separar `mediaCatalog.seed.json` (versionado) do catálogo de runtime ignorado pelo git (decisão P-02); documentar como o seed é copiado na primeira execução.
- [ ] Cache em memória com TTL para buscas externas (usar o `this.cache`).
- [ ] Testes com `fetchJson` simulado: ingestão válida, 404, 429, id inválido, escrita atômica, leitura corrompida (não apaga dados).

## Decisões pendentes
P-01 (esquema de ids e migração) e P-02 (catálogo seed × runtime). Levar a recomendação do `02-decisoes.md` ao Gabriel antes de implementar.

## Critério de pronto
Corromper `users.json`/`mediaCatalog.json` de propósito não apaga nada (erro claro, `.bak` usado); ingestão de id inexistente não grava nada; visitante sem login não escreve no catálogo;
nenhuma colisão de id; Batman volta; `git status` fica limpo após rodar o app; testes cobrindo tudo acima.

## Fora de escopo
Fonte Jikan (S06); rate limit de login (S04); trocar JSON por banco (decidir na S10, P-09).
