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

## Pendentes (perguntar ao Gabriel na sessão indicada)

- **P-01 · S02 ·** Esquema de ids para evitar colisão TMDB × TVMaze (ex.: faixas por fonte) e migração das obras já ingeridas e das bibliotecas existentes.
  Recomendação: manter ids do seed; mover TVMaze para uma faixa própria e restaurar o filme Batman (155) no catálogo.
- **P-02 · S02 ·** Catálogo: separar `mediaCatalog.seed.json` (versionado) de um arquivo de runtime ignorado pelo git? Recomendação: sim.
- **P-03 · S03 ·** Como propagar remoções entre aparelhos (marcas de exclusão/tombstones vs. "servidor vence após o 1º sync").
- **P-04 · S03 ·** Adicionar nota do usuário de 1 a 5 (o handover cita, mas não existe no modelo)?
- **P-05 · S04 ·** `JWT_SECRET` ausente: falhar sempre, ou gerar e persistir um segredo local em `server/data/` (ignorado pelo git) para uso local? Recomendação: gerar/persistir local; falhar em produção.
- **P-06 · S04 ·** Google: implementar de verdade (precisa de `GOOGLE_CLIENT_ID` criado pelo Gabriel no Google Cloud) ou esconder o botão até lá?
- **P-07 · S06 ·** Filmes: TVMaze não tem filmes. Usar TMDB (a chave `TMDB_API_KEY` já está prevista e não é usada) ou ficar só com o catálogo local?
- **P-08 · S06 ·** Modelagem de animes da MAL (uma entrada por temporada/cour): tratar cada entrada como obra separada ou agrupar por franquia?
- **P-09 · S10 ·** Persistência em produção: arquivos JSON em disco efêmero perdem dados. Migrar para SQLite (volume persistente) ou outro banco? Escolher junto com a hospedagem.
