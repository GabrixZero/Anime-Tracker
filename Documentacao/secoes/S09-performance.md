# S09 · Performance

**Status:** em `Documentacao/status/S09.json` (`npm run status -- S09`) · **Gravidade:** baixa/média · **Depende de:** S02 (catálogo), S06 (novas fontes) · **Branch:** `feature/s09-performance`

## Por que importa
Funciona bem hoje (19 obras, ~536 episódios), mas cresce mal: cada obra ingerida adiciona dezenas de KB e a tela inteira é redesenhada a cada clique.

## Problemas encontrados
- `GET /api/media/trending` devolve o **catálogo inteiro com todos os episódios** (~293 KB) a cada carga e a cada filtro (`mediaService.getTrending`, `appController.init`, `exploreView`). Sem paginação.
- Sem compressão (`compression`), sem cache de estáticos (`express.static` sem `maxAge`/ETag configurado), fontes do Google carregadas de CDN externa.
- `refreshAll()` reconstrói as 4 views via `innerHTML` após cada marcação (inclusive abas ocultas); `nextUpView.calculateQueue` e a lista chamam `isWatched` por episódio.
  Batch de temporada redesenha o modal inteiro.
- Imagens: pôsteres/stills do TVMaze em tamanho `original`; sem `srcset`; fallback pesado do Unsplash (S08 remove).
- Sem service worker (o "local-first" ainda depende do servidor no ar).
- Escritas síncronas de arquivo no caminho da requisição (S02 melhora a atomicidade; aqui, tirar do caminho crítico).

## Tarefas
- [x] Separar **lista** (campos leves) de **detalhe** (temporadas/episódios sob demanda em `/api/media/:id` e `/api/media/batch`); paginação na lista (`limit`/`offset`, "Mostrar mais" no Explorar). D-S09-1/2.
- [x] `compression` e cabeçalhos de cache (ETag; `index.html` `no-cache`; CSS/JS/imagens com `STATIC_MAX_AGE_SEC`). Fontes: o HTML já tinha `preconnect` + `display=swap` (mantido; self-host fica para depois da CSP da S10). D-S09-5/7.
- [x] Render incremental: só a aba visível; atualiza apenas o cartão/linha alterado (A Seguir, Lista, modal de detalhes). **Não feito:** delegação de eventos (depende de tirar os `onclick` inline, S10); `DocumentFragment` não foi necessário (as trocas são de um nó). D-S09-4.
- [x] Cache em memória do progresso por obra e índice de episódios (`getProgress`, `getNextEpisode`, `getEpisode`). D-S09-3.
- [x] Imagens medianas (TVMaze `medium`, Jikan `image_url` no cartão) e `loading="lazy" decoding="async"` nas listas. Sem `srcset`. D-S09-6.
- [ ] ~~(Opcional) Service worker~~ — **fica no backlog (D-20)**.
- [ ] Escritas síncronas de arquivo fora do caminho crítico — **não feito de propósito** (a S10 trocou o armazenamento por um adaptador; D-S09-7).
- [x] Medir antes/depois: payload de `/trending`, tempo e nós redesenhados ao marcar 1 episódio com 1.000+ rastreados (ver `diario/2026-10-27-S09.md`). **Lighthouse não foi executado** (ferramenta externa bloqueada).

## Resultado
Feito em 2026-10-27 (subagente, branch `feature/s09-performance`). Payload da lista ~18x a 54x menor (~19x a 118x com gzip). Marcar episódio: 21 ms → 2 ms (A Seguir) e 188 ms → 4 ms (modal com 1.100 episódios); nós redesenhados de ~6.000/28.000 para ~60/70. Pendências no diário.

## Decisões (já resolvidas — não pergunte de novo)
**Resolvida:** D-20 (PWA/service worker no backlog).

## Critério de pronto
Payload da lista cai uma ordem de grandeza; marcar um episódio não congela com bibliotecas grandes; métricas antes/depois registradas no diário.

## Fora de escopo
Trocar o armazenamento por banco de dados (decisão P-09, S10).
