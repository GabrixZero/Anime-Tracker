# S01 · Segurança do frontend (XSS)

**Status:** em `Documentacao/status/S01.json` (`npm run status -- S01`) · **Gravidade:** alta · **Depende de:** nada · **Branch:** `feature/s01-xss-frontend`

## Por que importa
Dados externos (TVMaze é editável por qualquer pessoa) são gravados no catálogo compartilhado e renderizados com `innerHTML` **sem escape**
no navegador de todos os usuários. Um título malicioso poderia executar script e ler `localStorage['showvault_auth_token']` (o login).

## Problemas encontrados (linhas aproximadas; confirme com grep)
- `public/js/views/detailModalView.js`: `media.name` (~117), `media.overview` (~126), gêneros (~123), `poster_path` em `src` (~114), `backdrop_path` em `url('...')` (~112),
  nome da temporada (~192), `ep.still_path` (~236); `media.vote_average.toFixed` quebra se for `null` (~119).
- `public/js/views/diaryView.js`: `e.stillPath` (~125), `e.epTitle` (~133), `headerText` com nome da obra (~121), `e.emotion` quando não há rótulo (~130).
- `public/js/views/statsView.js`: `genre` (~133).
- `public/js/controllers/appController.js` `showToast` usa `innerHTML` com a mensagem (~182); a mensagem inclui `res.user.name` (nome escolhido pelo usuário) e erros do servidor.
- `public/js/views/exploreView.js`: `err.message` em `innerHTML` (~78).
- Importação de backup (`appController.js` ~145–165) aceita qualquer JSON com `trackedShows` e `watchedEpisodes` sem validar; um `emotion` malicioso é renderizado cru.
- `escapeHtml` está copiado em 5 views (`nextUpView`, `watchlistView`, `exploreView`, `diaryView`, `detailModalView`); as versões de `diaryView` e `detailModalView` quebram com valores que não são string.
- Servidor: `mediaService.ingest` grava nome/episódios/gêneros do TVMaze crus (só a sinopse tem tags removidas) — defesa em profundidade, coordenar com a S02.

## Tarefas (todas concluídas em 2026-10-26)
- [x] Criar utilitário compartilhado `public/js/utils/dom.js` (carregado antes das views): `escapeHtml(v)` (aceita qualquer tipo), `safeUrl(url)` (só `http(s)`/`data:image`), opcional `h` para montar texto seguro.
- [x] Substituir as 5 cópias de `escapeHtml` pelo utilitário; escapar **todo** valor interpolado em template que venha de catálogo, usuário ou erro (incluindo atributos `src`, `alt`, `title`, `url()`).
- [x] `showToast` e mensagens de erro: usar `textContent` (ou escapar), nunca `innerHTML` com dados dinâmicos.
- [x] Validar o backup importado (mesmo esquema do `LibraryModel.validate`: tipos, chaves `^\d+_(movie|s\d+_e\d+)$`, limites de tamanho) antes de aplicar ao estado.
- [x] `vote_average` nulo não pode quebrar o modal.
- [x] Servidor: remover tags HTML de `name`, nomes de episódios e `genres` na ingestão (função única reutilizável).
- [x] Testes: unidade do `escapeHtml/safeUrl` (rodável em Node) e do sanitizador do servidor; teste manual com uma obra de teste cujo nome é `<img src=x onerror=alert(1)>`.
- [x] Varredura final: `grep -n '\${' public/js/views public/js/controllers | grep -i innerHTML` sem interpolação não escapada.

## Decisões pendentes
Nenhuma. (CSP estrita só será possível depois de remover os `onclick` inline — S10.)

## Critério de pronto
Nenhum campo vindo de catálogo/usuário/servidor chega ao DOM sem escape; uma obra com HTML no nome aparece como texto em todas as telas e nenhum script executa;
backup inválido é recusado com mensagem; `npm test` passa.

## Fora de escopo
Remover `onclick` inline e CSP (S10); validação de entrada em `register/login` (S04).

## Resultado (2026-10-26)

**Status: concluída.** Branch `feature/s01-xss-frontend`.

### O que foi feito
- `public/js/utils/dom.js` (novo, carregado antes de tudo no `index.html`): `escapeHtml` (aceita qualquer tipo, escapa também crase), `safeUrl`/`safeSrc` (só `http(s)` e `data:image`),
  `cssUrl` (para `style.backgroundImage`, codifica aspas/parênteses), `toInt` (ids em `onclick`) e `formatRating` (nota nula vira "–").
- `public/js/utils/backupValidator.js` (novo): `validateBackup` com as mesmas regras do `LibraryModel.validate` (teste garante que os dois dão o mesmo resultado).
- As 5 cópias de `escapeHtml` foram removidas; `detailModalView`, `diaryView`, `exploreView`, `nextUpView`, `watchlistView` e `statsView` escapam tudo o que vem de catálogo/usuário/erro,
  validam URLs de imagem (com imagem reserva quando a URL é recusada) e passam ids/temporadas/episódios por `toInt` dentro dos `onclick`.
- `appController.showToast` monta o toast com `textContent`; a importação de backup valida antes de aplicar, recusa com mensagem clara e deixa o estado intacto.
- Servidor: `server/utils/sanitize.js` (`stripHtml`, `stripHtmlList`, `safeHttpUrl`) usado em `mediaService.search` (resultados externos) e `mediaService.ingest` (nome, sinopse, episódios, gêneros, status, datas, URLs).
- Testes: `tests/xss.test.js` (12 testes). Total do projeto: 21 testes passando.
- Verificado no navegador com uma obra de teste cujo nome, sinopse, gêneros, temporada, episódio e anotação eram `<img src=x onerror=...>`: tudo apareceu como texto em A Seguir, Minha Lista,
  Diário, Estatísticas, Explorar, modal de detalhes, modal de anotação e toast; `onerror` nunca executou; nota nula não quebrou o modal; backup inválido foi recusado.

### O que sobrou / fica para outras seções
- Catálogo **já gravado** em `mediaCatalog.json` não é limpo retroativamente (só ingestões novas passam pelo sanitizador). O frontend escapa tudo, então não há risco no navegador; a limpeza na carga do catálogo cabe à **S02**.
- `mediaService.ingest` ainda aceita resposta de erro do TVMaze como obra (guarda fraca `!data || !data.name`): **S02**.
- Os `onclick`/`onerror` inline continuam (ids e URLs fixas já são seguros); remover para habilitar CSP estrita: **S10**.
- Título/sinopse ilegíveis sobre a imagem do modal de detalhes (visto no screenshot): **S05**.
