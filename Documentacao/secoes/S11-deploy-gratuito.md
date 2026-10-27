# S11 · Deploy gratuito e produção

**Status:** em `Documentacao/status/S11.json` (`npm run status -- S11`) · **Prioridade:** 1 · **Depende de:** confirmação da P-10 pelo Gabriel · **Branch:** `feature/s11-deploy-gratuito`

## Por que importa
Hoje o app só roda na máquina do Gabriel. Ele quer usar com ~10 amigos, **sem pagar nada**. O CI (testes, lint e `docker build` + `/health`) já está verde no GitHub (verificado em 2026-10-27).

## Contexto e restrições
- O disco dos planos gratuitos é **efêmero** (some a cada deploy/reinício). Arquivos JSON/SQLite locais não servem sozinhos.
- Opção recomendada (P-10): **Render (web service gratuito, a partir do Dockerfile do repo) + Turso (SQLite/libSQL gratuito)**. Limitação: o Render gratuito "dorme" após ~15 min sem acesso; o primeiro acesso depois disso demora (cold start).
- Alternativa: **PC do Gabriel + Tailscale Funnel** (URL https fixa `*.ts.net`, grátis, dados no SQLite local; só funciona com o PC ligado).
- Criar contas (Render, Turso, Tailscale) e gerar tokens é tarefa do **Gabriel**; tokens vão direto para as variáveis de ambiente do serviço, **nunca no chat nem no git**.

## Tarefas (opção Render + Turso)
- [ ] Novo adaptador `STORAGE=libsql` em `server/storage/` usando o pacote `libsql` (API síncrona compatível com better-sqlite3) em modo *embedded replica* (`syncUrl` + `authToken` do Turso): escreve no primário remoto, lê da réplica local; `sync()` na partida. Mesma interface do adaptador SQLite atual; testes com um arquivo local (sem rede).
- [ ] Script de migração dos dados locais (JSON/SQLite) para o Turso, com backup e modo "simular" (`--dry-run`).
- [ ] `render.yaml` (Blueprint) usando o Dockerfile, `healthCheckPath: /health`, variáveis: `NODE_ENV=production`, `JWT_SECRET` (gerado pelo Render), `STORAGE=libsql`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GOOGLE_CLIENT_ID`, `TRUST_PROXY=1`, `CORS_ORIGINS`, `TMDB_API_KEY` (opcional).
- [ ] Ajustes de produção: CSP/CORS com o domínio público; cookies/HSTS ok atrás do proxy; mensagem amigável durante cold start (opcional).
- [ ] Backups: export diário (script + instrução) além do restore de 1 dia do Turso.
- [ ] Google: adicionar a origem de produção (`https://<app>.onrender.com`) ao Client ID "ShowVault (local)" — **pedir OK do Gabriel antes** — e documentar como adicionar amigos como usuários de teste (máx. 100) ou publicar o app.
- [ ] Guia `Documentacao/deploy.md` passo a passo para o Gabriel (criar contas, conectar o GitHub ao Render, colar tokens nas variáveis, primeiro deploy, convidar amigos) + smoke test pós-deploy (`/health`, cadastro, login, sync).
- [ ] Se a P-10 for a alternativa (PC + Tailscale): em vez das tarefas acima, script/serviço para iniciar o app com o Windows, `STORAGE=sqlite`, backup automático e guia do Tailscale Funnel.

## Decisões
- **P-10 (pendente):** Render + Turso (recomendado) × PC + Tailscale Funnel. Ver `02-decisoes.md`.
- Já resolvidas: D-21 (Docker/SQLite/`/health`), D-27 (Client ID do Google criado só para localhost).

## Critério de pronto
App acessível por URL pública https, dados persistem entre reinícios/deploys, login (e-mail e Google) funcionando em produção, guia de deploy e de convite de amigos escrito, testes e CI verdes.

## Fora de escopo
Domínio próprio pago; escala além de ~10 usuários.
