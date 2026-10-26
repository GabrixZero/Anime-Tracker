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
- [ ] Separar **lista** (campos leves: id, tipo, nome, pôster, nota, ano, gêneros) de **detalhe** (temporadas/episódios sob demanda em `/api/media/:id`); paginação/limite na lista.
- [ ] `compression`, cabeçalhos de cache (`Cache-Control`, ETag) para `public/` e imagens servidas pelo app; self-host das fontes ou `preconnect` + `font-display: swap`.
- [ ] Render incremental: só a aba visível; atualizar apenas o cartão/linha alterado ao marcar episódio; `DocumentFragment`/delegação de eventos.
- [ ] Cache em memória do mapa de episódios assistidos por obra (evitar recomputar chaves).
- [ ] Usar tamanhos medianos de imagem quando a fonte oferecer (TVMaze `medium`, Jikan `image_url` vs `large`); `loading="lazy"` e `decoding="async"` em todas.
- [ ] (Opcional, perguntar) Service worker simples para cache do app shell e dados locais.
- [ ] Medir antes/depois: tamanho do payload (`/trending`), tempo de render ao marcar 1 episódio com 1.000+ episódios rastreados, Lighthouse.

## Decisões (já resolvidas — não pergunte de novo)
**Resolvida:** D-20 (PWA/service worker no backlog).

## Critério de pronto
Payload da lista cai uma ordem de grandeza; marcar um episódio não congela com bibliotecas grandes; métricas antes/depois registradas no diário.

## Fora de escopo
Trocar o armazenamento por banco de dados (decisão P-09, S10).
