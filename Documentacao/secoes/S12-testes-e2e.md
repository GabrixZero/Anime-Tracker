# S12 · Testes ponta a ponta (E2E)

**Status:** em `Documentacao/status/S12.json` (`npm run status -- S12`) · **Prioridade:** 2 · **Depende de:** nada · **Branch:** `feature/s12-testes-e2e`

## Por que importa
Até aqui toda verificação de interface foi manual (agentes e sessão principal clicando no navegador). Com mais funcionalidades chegando (S13–S18), regressões na tela precisam ser pegas automaticamente, inclusive no CI.

## Decisão
D-25: instalar **Playwright** (`@playwright/test`) + Chromium como dependência de **desenvolvimento** (aprovado pelo Gabriel em 2026-10-27). `npm test` (unitários, rápidos) continua separado de `npm run test:e2e`. Detalhes da implementação: D-S12-1 a D-S12-8 em `02-decisoes.md`.

## Tarefas
- [x] `playwright.config.js` com o app subindo em porta própria (3012) e `SHOWVAULT_DATA_DIR` temporário; projetos desktop (1280×800) e mobile (375×812). (O app sobe no `globalSetup`, não no `webServer`: D-S12-2.)
- [x] Fontes externas **simuladas** (TVMaze, Jikan, AniList, TMDB): variáveis de base URL apontando para um servidor falso local (`tests/e2e/fake-sources/`); acrescentadas `TVMAZE_BASE_URL` e `TMDB_BASE_URL` ao app (única mudança nele, D-S12-3); nenhum teste depende de rede externa (o servidor e o navegador são vigiados).
- [x] Fluxos: primeira visita vazia → "Carregar exemplo" → "Remover exemplo"; cadastro e login; marcar episódio (A Seguir e modal) e temporada inteira; status por obra; filme; anotação com Markdown/spoiler, histórico de versões, Diário (busca, filtro, exportar .md); Explorar (catálogo, "Mostrar mais", busca de séries/animes/filmes, adicionar); backup exportar/importar/apagar e arquivos inválidos; logout isolando contas; **sync entre dois "aparelhos"** (dois `browserContext`), remoção propagada (tombstones, também "Remover exemplo") e modo offline.
- [x] Guardas transversais: nenhuma violação de CSP (`securitypolicyviolation`) nem erro de console em **nenhum** teste; sem rolagem horizontal em 375 px; fluxo principal só com teclado (Tab/Enter/Espaço/setas/Esc, foco preso nas janelas e devolvido); axe-core (WCAG A/AA) sem violações graves em todas as telas e janelas; botão do Google só com `GOOGLE_CLIENT_ID` (script do Google simulado, nunca o real).
- [x] CI: job `e2e` em `.github/workflows/ci.yml` (JSON e SQLite) com cache do Chromium; artefatos (trace/captura/relatório) só em falha.
- [x] Documentado como rodar/depurar (`npm run test:e2e`, `--ui`, `--headed`, `show-report`) no README.

## Critério de pronto
`npm run test:e2e` verde local e no CI, cobrindo os fluxos acima em desktop e mobile, sem rede externa; tempo total razoável (< ~3 min no CI). **Atingido:** 69 testes passam (+ 3 pulados: 1 só-mobile e 2 `fixme` do bug de foco) em ≈ 50 s local e ≈ 1,5 min no CI.

## Resultado e o que ficou para depois
- Bug real achado e **não corrigido** (a S12 não mexe no app): depois de "Carregar exemplo" pelo teclado o foco cai no `<body>` — teste `fixme` em `tests/e2e/09-teclado.spec.js`. Sugestão para a S19: guardar também o foco de `#next-up-empty` no `a11y.js` ou, como no "Remover exemplo", mandar o foco para o título da tela.
- Observações para a S19: o aviso (toast) cobre o conteúdo no celular por 4,5 s e recebe o toque (`pointer-events: none` resolveria); `heading-order` (h4 sem h3) na janela de filme e no Diário.
- Não coberto de propósito: login com Google de verdade (nunca se automatiza `accounts.google.com`), Firefox/WebKit (fora de escopo), comparação visual de imagens (fora de escopo).

## Fora de escopo
Testes visuais por comparação de imagem; navegadores além do Chromium (opcional: Firefox/WebKit depois).
