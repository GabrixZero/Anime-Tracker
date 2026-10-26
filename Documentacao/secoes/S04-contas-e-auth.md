# S04 · Contas e autenticação

**Status:** em `Documentacao/status/S04.json` (`npm run status -- S04`) · **Gravidade:** alta · **Depende de:** S02 (escrita segura do `users.json`) · **Branch:** `feature/s04-contas-e-auth`

## Por que importa
O login já usa JWT real, mas o cadastro aceita qualquer coisa, não há limite de tentativas e o segredo padrão é público fora de produção.

## Problemas encontrados
- `server/controllers/authController.js`: sem validação de e-mail/senha/nome/avatar; senha de 1 caractere passa; `{"email":123}` gera 500; mensagem de cadastro revela se o e-mail já existe.
- Sem rate limit em `login`/`register`; `scryptSync` (`UserModel.js`) bloqueia o event loop a cada tentativa → força bruta e DoS fáceis.
- `server/config/config.js`: sem `NODE_ENV=production`, o segredo é `showvault_dev_only_secret_change_me` (público no GitHub) → qualquer um forja tokens se o app for hospedado sem `JWT_SECRET`.
- Login Google **simulado** (`authController.googleAuth`, `authView.handleGoogle` com perfil fixo); em produção responde 501 mas o botão continua visível.
- `users.example.json` entrega a conta `demo@showvault.local` em toda instalação (senha de demonstração `demo`, hash versionado no repositório — qualquer um que clone o projeto sabe entrar).
- `cors()` aberto; sem `helmet`; `x-powered-by` ativo. Sem troca de senha, exclusão de conta ou recuperação. JWT sem revogação/refresh; logout só no cliente. E-mails não verificados.
- O token fica em `localStorage` (por isso a S01 é pré-requisito).

## Tarefas
- [x] Validação centralizada (tipos, e-mail em formato válido, senha ≥ 8 e ≤ 128, nome ≤ 60, avatar só URL `http(s)` ou gerado); respostas 400 claras; nunca 500 por entrada inválida.
- [x] Trocar `scryptSync` por `crypto.scrypt` assíncrono; rate limit por IP+e-mail em login/registro (ex.: `express-rate-limit`); mensagem de erro neutra.
- [x] Segredo JWT (decisão P-05): gerar e persistir um segredo local em `server/data/` (ignorado pelo git) quando não houver `JWT_SECRET` fora de produção; em produção, falhar sem segredo (já faz).
- [x] Google (decisão P-06): ou implementar Google Identity Services + validação do ID token no servidor (`google-auth-library`, `GOOGLE_CLIENT_ID` no `.env`), ou esconder o botão quando não configurado e remover o perfil fixo.
- [x] Remover a conta demo do fluxo padrão (ou só criá-la com variável explícita `SEED_DEMO_USER=1`).
- [x] `helmet`, remover `x-powered-by`, CORS com lista de origens por env.
- [x] Endpoints: trocar senha, excluir conta (apaga `users.json` + biblioteca) — com confirmação por senha.
- [x] Refatorar `server.js` em `app.js` (exporta o app, sem `listen`) + `server.js` (só `listen`) para permitir testes HTTP.
- [x] Testes HTTP de `register/login/me`: validações, 401, rate limit, token expirado/forjado; sem escrever em `server/data` real.

## Decisões (já resolvidas — não pergunte de novo)
**Resolvidas:** D-15 (segredo local gerado e persistido fora de produção), D-16 (botão Google escondido; integração real pronta atrás de `GOOGLE_CLIENT_ID`), D-22 (remover conta demo).

## Critério de pronto
Entradas inválidas retornam 400; força bruta é limitada; app não sobe com segredo público em produção e localmente usa segredo único por instalação; botão Google funciona de verdade ou não aparece;
testes HTTP passam.

## Fora de escopo
Verificação de e-mail e recuperação de senha por e-mail (precisa de serviço de e-mail; registrar no backlog se o Gabriel quiser).

## Resultado (S04 concluída · 2026-10-26)
Tudo acima foi feito (decisões D-S04-1 a D-S04-8 em `02-decisoes.md`; detalhes no diário `diario/2026-10-26-S04.md`). Testes: `tests/auth-http.test.js`, `auth-ratelimit.test.js`, `jwt-secret.test.js`, `validators.test.js`.
**Sobrou (fora do escopo):** telas no app para trocar senha/excluir conta; verificação de e-mail e recuperação de senha; revogação de sessão no logout (token continua válido até expirar, 7 dias); CSP estrita (S10); o Gabriel criar o `GOOGLE_CLIENT_ID`.
