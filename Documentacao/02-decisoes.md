# Decisões

Formato: **D-nn** · data · decisão · motivo. Decisões novas das sessões usam **D-SNN-n** (ex.: D-S02-1) para não colidir entre sessões paralelas. Decisões *tomadas* não devem ser reabertas sem fato novo.
Decisões *pendentes* devem ser levadas ao Gabriel (pergunte; ofereça uma recomendação) na sessão indicada.

## Tomadas

- **D-01 · 2026-10-25 · Segredos e dados de usuário fora do git.** `users.json`, `libraries/`, `.env`, `.env.*` (exceto `.env.example`) ficam no `.gitignore`.
  Motivo: vazamento anterior (ver `01-visao-geral-e-arquitetura.md`).
- **D-02 · 2026-10-26 · Autenticação com JWT HS256 (`jsonwebtoken`)**, claim `sub` = id do usuário, expira em 7 dias (`JWT_EXPIRES_IN`).
  O formato antigo `token_<id>` foi abolido (era forjável). Sem revogação/refresh por enquanto.
- **D-03 · 2026-10-26 · Biblioteca do usuário = snapshot completo por usuário** (`PUT /api/user/library`, last-write-wins),
  um arquivo por usuário, validado e gravado de forma atômica (tmp + rename). Não existe rota `/progress`.
  O `localStorage` continua sendo a fonte primária (local-first); o servidor é cópia/sincronização.
- **D-04 · 2026-10-26 · Merge no login = união** (nada some de nenhum lado). Se o estado local ainda é o demo padrão (`seeded`), o servidor vence.
  Limitação conhecida: a união ressuscita itens removidos em outro aparelho — corrigir na S03.
- **D-05 · 2026-10-26 · Login Google segue simulado**; bloqueado em produção (501) e para e-mails de contas com senha. Implementação real fica na S04.
- **D-06 · 2026-10-26 · Ids de obra continuam numéricos.** Novas fontes (Jikan/MAL) usam **faixas numéricas** (ex.: `10_000_000 + mal_id`)
  em vez de prefixo de texto, porque ~10 pontos do frontend usam `Number(id)` e ids sem aspas em `onclick`. Faixa exata e migração: definir na S02/S06.
- **D-07 · 2026-10-26 · Fluxo de trabalho:** uma seção por sessão, em branch `feature/sNN-<slug>`, e **ao final de cada sessão push até o `main`**
  (feature → develop → main, sem force push). Documentação é atualizada a cada sessão.
- **D-08 · 2026-10-26 · A documentação em `Documentacao/` é a memória oficial entre sessões**, e o `CLAUDE.md` da raiz aponta para ela.
- **D-09 · 2026-10-26 · Ordem de prioridade das seções:** S01 XSS → S02 dados/catálogo → S03 biblioteca/sync → S04 contas/auth → S05 mobile →
  S06 animes/busca (Jikan) → S07 acessibilidade → S08 funções falsas → S09 performance → S10 qualidade/testes/deploy.
  (Seções de dados/segurança antes de recursos novos; S06 depende do esquema de ids da S02.)

- **D-10 · 2026-10-26 · Sessões paralelas coordenadas pelo GitHub:** status em `Documentacao/status/SNN.json` (verdade em `origin/main`), dependências em `status/grafo.json`,
  `npm run status` decide se uma seção pode iniciar; a branch `feature/sNN-*` empurrada ao abrir reserva a seção; diário em um arquivo por sessão. Detalhes em `06-coordenacao-entre-sessoes.md`.

- **D-S01-1 · 2026-10-26 · Escapar na saída (frontend) e sanear na entrada (servidor), as duas coisas.** O frontend nunca confia no catálogo (`escapeHtml`/`safeUrl` em toda interpolação);
  o servidor remove HTML de dados externos na ingestão como defesa em profundidade. Motivo: o TVMaze é editável por qualquer pessoa e o catálogo é compartilhado.
- **D-S01-2 · 2026-10-26 · Utilitários compartilhados em `public/js/utils/` como scripts clássicos "duais"** (expõem em `window` no navegador e `module.exports` no Node),
  para serem testados com `node --test` sem criar etapa de build. `backupValidator.js` espelha `LibraryModel.validate`; um teste garante que os dois não divergem (se mudar um, mude o outro).
- **D-S01-2b · 2026-10-26 · URLs de imagem:** só `http(s)` e `data:image/*`; qualquer outra vira imagem reserva. Ids em `onclick` passam por `toInt`.

- **D-11 · 2026-10-26 · (P-01) Catálogo recomeça do zero, ids por fonte.** Remover as 4 obras ingeridas do TVMaze (155 Beauty & the Beast, 555 Avatar, 13615 My Hero Academia, 495 Naruto)
  e **restaurar o filme Batman (TMDB 155)**. Ids do seed (TMDB) ficam; cada fonte externa passa a ter faixa numérica própria (TVMaze, Jikan, TMDB-externo), definida na S02 e documentada em `01-visao-geral-e-arquitetura.md`.
  Migração: remover das bibliotecas (servidor `server/data/libraries/*.json` e `localStorage`, via número de versão do estado) apenas as referências a essas 4 obras
  (atenção: a chave `155_movie` é o Batman e deve ser mantida; `155_sX_eY` é a série antiga e deve ser removida). Não apagar bibliotecas inteiras.
- **D-12 · 2026-10-26 · (P-02) Catálogo separado:** `server/data/mediaCatalog.seed.json` (versionado, só leitura) + catálogo de runtime ignorado pelo git (criado a partir do seed na primeira execução).
- **D-13 · 2026-10-26 · (P-03) Remoções por marcas de exclusão (tombstones)** com data nos itens da biblioteca; o merge respeita a marca mais recente. `LibraryModel.validate` passa a aceitá-las.
- **D-14 · 2026-10-26 · (P-04) Nota 1–5 do usuário: não agora** (backlog).
- **D-15 · 2026-10-26 · (P-05) Segredo JWT:** fora de produção, gerar e persistir um segredo único em `server/data/` (ignorado pelo git); em produção exigir `JWT_SECRET` (já falha sem ele).
- **D-16 · 2026-10-26 · (P-06) Google:** esconder o botão e remover o login falso; a integração real (Google Identity Services + validação do ID token no servidor) fica pronta, mas só aparece com `GOOGLE_CLIENT_ID` configurado.
- **D-17 · 2026-10-26 · (P-07) Filmes e séries via TMDB** (títulos em PT-BR), com `TMDB_API_KEY` **opcional** no `.env`: sem chave o app segue com catálogo local + TVMaze. O Gabriel cria a chave gratuita em themoviedb.org depois; testes usam respostas simuladas.
- **D-18 · 2026-10-26 · (P-08) Animes agrupados por franquia** (uma obra com várias temporadas, como nas séries), usando as relações da MAL. É a parte mais complexa da S06: entregar em duas etapas dentro da sessão
  (1: busca/ingestão Jikan de obra única + deduplicação; 2: agrupamento por franquia) e registrar o que ficar para depois.
- **D-19 · 2026-10-26 · (S08) Implementar** histórico de versões da anotação (restaurar em 1 clique) e Markdown simples com spoiler (sem HTML livre).
- **D-20 · 2026-10-26 · (S09) PWA/service worker fica no backlog.**
- **D-21 · 2026-10-26 · (P-09) Preparar sem publicar:** Dockerfile, `/health`, variáveis de ambiente documentadas e persistência em SQLite (arquivo único, pronto para volume persistente);
  a hospedagem o Gabriel escolhe depois. Preferir `node:sqlite` embutido se o Node suportar de forma estável, senão `better-sqlite3`; migrar os JSON existentes.
- **D-22 · 2026-10-26 · Padrões assumidos sem perguntar (o Gabriel pode reverter):** remover a conta demo do fluxo padrão (S04); estado inicial sem dados falsos — lista vazia com chamada para explorar e opção “Carregar exemplo” (S08);
  manter a identidade visual atual, tema escuro e amarelo (S05); testes sempre sem tocar `server/data` real.
- **D-23 · 2026-10-26 · Execução por subagentes** coordenados pela sessão principal: cada subagente trabalha numa worktree própria na branch `feature/sNN-*`, **não faz merge no main**;
  a sessão principal confere, integra e faz o push até o `main`.

- **D-S02-1 · 2026-10-26 · Faixas de ids por fonte:** seed/TMDB 1–999.999 (id nativo), TVMaze 1.000.000 + id, Jikan 10.000.000 + `mal_id`, TMDB-série 20.000.000 + id, TMDB-filme 30.000.000 + id.
  Motivo: ids numéricos (D-06) sem colisão; TMDB reutiliza números entre séries e filmes, por isso faixas separadas. Tabela e regras em `01-visao-geral-e-arquitetura.md`.
- **D-S02-2 · 2026-10-26 · Catálogo de runtime com nome novo (`mediaCatalog.runtime.json`)**, ignorado pelo git; o antigo `mediaCatalog.json` saiu do git e **não é importado** (as 4 obras do TVMaze nele eram justamente as que o D-11 manda descartar).
  Obras novas do seed são acrescentadas ao runtime na partida, mas nunca sobrescrevem uma obra já presente (correção de uma obra do seed exige editar o runtime ou apagá-lo).
- **D-S02-3 · 2026-10-26 · Arquivo ilegível nunca vira "vazio":** `jsonStore.readJson` tenta o `.bak`; sem `.bak` válido lança `DataCorruptionError` (HTTP 503 nas rotas), preserva `<arquivo>.corrupt-<data>` e **não grava**.
  O catálogo ilegível entra em modo somente leitura (serve o seed). Biblioteca de usuário ilegível: o `GET` dá 503; o `PUT` do cliente (fonte primária local-first) substitui o arquivo, depois de preservar a cópia `.corrupt-*`.
- **D-S02-4 · 2026-10-26 · Ingestão exige login e tem limite:** `POST /api/media/ingest` usa `requireAuth`; `GET /api/media/:id` é público para obra já completa no catálogo e exige login (`optionalAuth`) quando precisaria ingerir; 30 ingestões / 10 min por usuário (429).
  A busca (`/search`) segue pública (só lê e usa cache de 10 min); o frontend só chama a ingestão quando a obra ainda não está completa no cache e, sem login, mostra o erro em vez de adicionar uma obra sem episódios.
- **D-S02-5 · 2026-10-26 · Versão do estado em chave separada** (`showvault_state_version`; `STORAGE_KEY` continua `showvault_state_mvc_v1`) e `schemaVersion` nas bibliotecas do servidor; a migração v1→v2 está em `public/js/utils/migrations.js` (compartilhada navegador/servidor).
  Regra do `showId` 155 (ambíguo): só sai da lista se houver chaves `155_sX_eY` (prova da série antiga) e nenhuma `155_movie` (prova do Batman); sem prova, fica (padrão conservador).
- **D-S02-6 · 2026-10-26 · Caminhos de dados injetáveis:** `SHOWVAULT_DATA_DIR` (env) muda `config.DATA_DIR`; modelos/serviço aceitam o diretório no construtor (`new MediaService({dataDir, seedPath, tvmazeBase, sleep})`, `new UserModel(dir)`, `new LibraryModel(dir)`).
  `server/app.js` separa o Express de `server.js` para testar rotas sem abrir a porta fixa. Todo teste novo define `SHOWVAULT_DATA_DIR` temporário **antes** de carregar os módulos.

## Pendentes

Todas as pendências P-01 a P-09 foram resolvidas em 2026-10-26 (D-11 a D-21). Novas dúvidas devem ser levadas ao Gabriel pela sessão principal antes de disparar subagentes.
