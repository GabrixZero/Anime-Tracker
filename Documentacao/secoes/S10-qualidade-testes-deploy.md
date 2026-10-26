# S10 · Qualidade, testes e deploy

**Status:** pendente · **Gravidade:** média · **Depende de:** idealmente depois das S01–S09 (consolida e fecha) · **Branch:** `feature/s10-qualidade-testes-deploy`

## Por que importa
Deixar o projeto sustentável (qualquer sessão futura altera sem medo) e publicável de verdade.

## Problemas encontrados
- Estrutura: `public/index.html` tem ~512 linhas/37 KB com ~106 estilos inline (+~63 nos templates JS); ~38 `onclick` inline chamando `window.*` (nextUpView 8, detailModalView 7, exploreView 4, authView 2, diaryView 1, watchlistView 1, index.html 4);
  sem módulos ES (ordem de `<script>` é a única dependência); uma CSP estrita é impossível enquanto houver handlers inline.
- Código duplicado: `escapeHtml` (S01), badge de tipo repetido em 4 views, URLs de fallback copiadas em 5 arquivos, parsing da chave `"id_sN_eM"` repetido em `diaryView`, `statsView` e `state.js`, 3 telas vazias escritas à mão.
- Testes: só `tests/auth-library.test.js` (4 casos); nenhum de rota HTTP, de `mediaService`, de `merge`; nenhum de frontend. `require('UserModel')` cria `server/data/users.json` como efeito colateral.
- Sem linter/formatador; `package.json` com `"main": "app.js"` inexistente, descrição copiada de markdown, sem `engines`.
- README desatualizado (não diz `npm install`, não documenta API/env, promete recursos inexistentes — S08).
- `iniciar.bat` abre o navegador antes do servidor subir e fixa a porta 3000; `push-github.bat` lista branches fixas.
- GitHub Actions: só abrem PRs; `contents: write` é mais do que precisa; `catch` trata qualquer 422 como "nada a mesclar"; o workflow de `develop` roda em `push` **e** em PR fechado; ações fixadas por tag; **não existe CI que rode `npm test`**.
- Deploy: não há Procfile/Dockerfile/health-check; estado em arquivos JSON locais (discos efêmeros perdem usuários e bibliotecas); processo único com I/O síncrono.

## Tarefas
- [ ] Frontend: delegação de eventos (`data-action`) no lugar de `onclick`; mover estilos inline restantes para CSS; módulo utilitário único (`utils/dom.js`, parsing de chave, constantes de emoção/fallback); considerar módulos ES (`type="module"`).
- [ ] CSP (via `helmet`) sem `unsafe-inline` depois da limpeza; testar o app inteiro com a CSP ativa.
- [ ] ESLint + Prettier (config mínima, `npm run lint`); corrigir `package.json` (`main`, `description`, `engines.node`, `scripts`).
- [ ] Testes: rotas HTTP (auth, user/library, media), `mediaService` com fetch simulado, `merge`, validações; cobertura mínima nos pontos críticos; testes sem tocar `server/data` real.
- [ ] **CI** em `.github/workflows/ci.yml`: `npm ci`, lint e `npm test` em push/PR; endurecer os workflows de PR (permissões mínimas, tratar erros reais, rodar só uma vez).
- [ ] README completo e verdadeiro (instalação, `.env`, API, estrutura, fluxo de branches); atualizar `.bat` (esperar o servidor, ler porta, `npm install` se faltar).
- [ ] Deploy (decisão P-09): escolher hospedagem e armazenamento persistente (SQLite com volume, ou Postgres); `Dockerfile`/`Procfile`, `/health`, variáveis de ambiente documentadas, passos de publicação. Migração dos JSON existentes.
- [ ] Revisão final de segurança com a checklist de `01-visao-geral-e-arquitetura.md`.

## Decisões pendentes
P-09 (persistência e hospedagem). Perguntar ao Gabriel: onde pretende publicar, orçamento, e se o app será público ou só dele.

## Critério de pronto
Zero `onclick`/estilo inline relevante; CSP ativa; CI verde no GitHub; README correto; app publicável com persistência e variáveis de ambiente documentadas.

## Fora de escopo
Reescrever em framework (React/Vue); novas funcionalidades (backlog).
