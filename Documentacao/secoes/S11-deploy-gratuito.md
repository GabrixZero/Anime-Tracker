# S11 · Deploy gratuito no PC do Gabriel (Tailscale Funnel)

**Status:** em `Documentacao/status/S11.json` (`npm run status -- S11`) · **Prioridade:** 1 · **Depende de:** nada (o link só vai para os amigos depois da S14) · **Branch:** `feature/s11-deploy-gratuito`

## Por que importa
O Gabriel quer usar o ShowVault com ~10 amigos sem pagar nada (D-29). O app vai rodar no PC dele (Windows 11) e o **Tailscale Funnel** publica um link https fixo (`https://<máquina>.<tailnet>.ts.net`) que encaminha para o app local. O CI (lint, testes, `docker build` + `/health`) já está verde.

## Restrições
- Só funciona com o PC ligado e acordado. Mudar opções de energia do Windows é decisão do Gabriel: o guia explica, os scripts **não** mudam configurações do sistema.
- O projeto fica dentro do **OneDrive**: o banco SQLite em uso **não** pode ficar lá (o OneDrive trava/sincroniza arquivos abertos e pode corromper o banco e os arquivos `-wal`/`-shm`). Dados ao vivo em `%LOCALAPPDATA%\ShowVault\data`; backups (arquivos fechados) podem e devem ir para o OneDrive.
- Instalar o Tailscale, criar a conta e ativar o Funnel são passos do **Gabriel** (o guia explica); registrar a tarefa de inicialização do Windows também (o script existe, ele roda).
- A porta do app deve escutar **só em `127.0.0.1`** (o Funnel conecta localmente); nada exposto direto na rede local.

## Tarefas
- [ ] Configuração de produção local: variável `HOST` (padrão `127.0.0.1` em produção) em `server/config/config.js`/`server.js`; script `npm run setup:pc` que cria/atualiza o `.env` **sem sobrescrever** o que existe: `NODE_ENV=production`, `JWT_SECRET` forte gerado na hora (nunca impresso nem commitado), `STORAGE=sqlite`, `SHOWVAULT_DATA_DIR=%LOCALAPPDATA%\ShowVault\data`, `PORT=3000`, `HOST=127.0.0.1`, `TRUST_PROXY` adequado ao Funnel (confirmar na documentação do Tailscale quais cabeçalhos ele envia, para o rate limit enxergar o IP real), `CORS_ORIGINS` com o endereço `.ts.net` (preenchido quando o Gabriel souber o nome).
- [ ] Migração dos dados atuais (`server/data` em JSON, com a conta do Gabriel) para o SQLite em `%LOCALAPPDATA%\ShowVault\data` usando o `npm run storage:migrate` existente, com backup e modo simulação. **Não** apagar os JSON originais.
- [ ] Backup diário do SQLite (cópia consistente: API de backup/`VACUUM INTO`, nunca copiar o arquivo aberto) com rotação (ex.: 7 diários + 4 semanais) para uma pasta configurável, padrão `OneDrive\Documentos\ShowVault-Backups`; comando `npm run backup` e restauração documentada (`npm run restore -- <arquivo>`, com confirmação).
- [ ] Inicialização com o Windows: `scripts/windows/install-autostart.ps1` e `uninstall-autostart.ps1` (Agendador de Tarefas, ao fazer logon, janela oculta, reinício em caso de falha, log em `%LOCALAPPDATA%\ShowVault\logs`), `start-showvault.ps1`, `status.ps1` (está rodando? `/health`?) e `update.ps1` (git pull da `main`, `npm ci`, migrações, reinício). Os scripts não são executados pela sessão; só validados (análise de sintaxe do PowerShell) e testados no que for seguro (ex.: `start` numa porta de teste).
- [ ] Guia `Documentacao/deploy-pc-tailscale.md` (pt-BR, para o Gabriel, passo a passo com o que ele clica): instalar o Tailscale, entrar na conta, ativar HTTPS e Funnel no painel, `tailscale funnel --bg 3000`, descobrir o link, conferir `/health` pelo link, ligar/desligar o Funnel, energia/suspensão do Windows, backups e restauração, atualizar o app, o que fazer se o PC reiniciar, riscos de segurança e como desligar tudo.
- [ ] Google: o guia instrui a pedir à sessão principal para adicionar a origem `https://<máquina>.<tailnet>.ts.net` ao cliente "ShowVault (local)" (D-27) e a adicionar os amigos como usuários de teste. A S11 **não** mexe no Google Cloud.
- [ ] Ajustes de produção no app se necessários (HSTS/CSP/CORS com o domínio `.ts.net`, cookies atrás do proxy) + testes automatizados (config, `HOST`, rotação de backup, setup que não sobrescreve `.env`).

## Decisões
- Resolvida: **D-29** (PC + Tailscale Funnel; sem Turso/Render). Já valem D-21 (Docker/SQLite/`/health`) e D-27 (Client ID do Google).

## Critério de pronto
Com os scripts e o guia, o Gabriel consegue: migrar os dados, deixar o app subindo sozinho com o Windows, publicar pelo Funnel e ver `/health` e o login funcionando pelo link `.ts.net`; backups diários aparecem no OneDrive e a restauração está documentada; testes e lint verdes.

## Fora de escopo
Convites/limitar cadastro (S14 — compartilhar o link só depois dela); hospedagem em nuvem (descartada em D-29).
