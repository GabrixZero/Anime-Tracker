# S12 · Testes ponta a ponta (E2E)

**Status:** em `Documentacao/status/S12.json` (`npm run status -- S12`) · **Prioridade:** 2 · **Depende de:** nada · **Branch:** `feature/s12-testes-e2e`

## Por que importa
Até aqui toda verificação de interface foi manual (agentes e sessão principal clicando no navegador). Com mais funcionalidades chegando (S13–S18), regressões na tela precisam ser pegas automaticamente, inclusive no CI.

## Decisão
D-25: instalar **Playwright** (`@playwright/test`) + Chromium como dependência de **desenvolvimento** (aprovado pelo Gabriel em 2026-10-27). `npm test` (unitários, rápidos) continua separado de `npm run test:e2e`.

## Tarefas
- [ ] `playwright.config.js` com `webServer` subindo o app em porta própria e `SHOWVAULT_DATA_DIR` temporário; projetos desktop (1280×800) e mobile (375×812).
- [ ] Fontes externas **simuladas** (TVMaze, Jikan, AniList, TMDB): via variáveis de base URL apontando para um servidor falso local ou `page.route`; nenhum teste depende de rede externa.
- [ ] Fluxos: primeira visita vazia → "Carregar exemplo"; cadastro e login; marcar episódio (A Seguir e modal); status por obra; anotação com Markdown/spoiler e histórico de versões; Explorar (busca, adicionar, "Mostrar mais"); backup exportar/importar; logout isolando contas; **sync entre dois "aparelhos"** (dois `browserContext`); remoção propagada (tombstones).
- [ ] Guardas transversais: nenhuma violação de CSP (`securitypolicyviolation`), nenhum erro de console, sem rolagem horizontal em 375 px, fluxo principal só com teclado (Tab/Enter/Esc), axe-core básico (`@axe-core/playwright`) sem violações graves.
- [ ] CI: job `e2e` em `.github/workflows/ci.yml` com cache dos navegadores; artefatos (trace/screenshot) só em falha.
- [ ] Documentar como rodar/depurar (`npm run test:e2e`, `--ui`, `--headed`) no README.

## Critério de pronto
`npm run test:e2e` verde local e no CI, cobrindo os fluxos acima em desktop e mobile, sem rede externa; tempo total razoável (< ~3 min no CI).

## Fora de escopo
Testes visuais por comparação de imagem; navegadores além do Chromium (opcional: Firefox/WebKit depois).
