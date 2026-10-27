# 2026-10-27 · Encerramento do roadmap S01–S10 (sessão principal / coordenação)

Todas as 10 seções estão **concluídas e no `main`** (último release: `35498da`). Quadro: `npm run status`.
Suíte: 302 testes passando; `npm run lint` 0 erros; `format:check` ok. CSP estrita ativa (scripts e estilos sem inline).

## Como foi executado
- Onda 1: S01 (feita antes por outro chat do Gabriel) + S02. Onda 2: S03, S04, S05. Onda 3: S06, S07, S08. Onda 4: S09 + S10 (S10 em duas fases: infra primeiro, limpeza do frontend depois que a S09 entrou).
- Cada seção rodou como subagente em worktree própria (`D-23`); a sessão principal conferiu diff + testes + app rodando e integrou uma branch por vez (`feature → develop → main`, sem force push).
- Conflitos reais só em S07×S08 (`index.html`/views) e S06×S08 (`exploreView.js`): resolvidos pelo agente dono do trabalho, fazendo `merge origin/develop` na própria branch.

## Lições de processo (valem para sessões futuras)
- O limite de uso da conta interrompeu a Onda 3 uma vez: peça commits parciais com push; agentes interrompidos retomam com `SendMessage` e o trabalho em worktree não se perde.
- Nunca limpar `%TEMP%` de forma ampla (o sistema bloqueou, e com razão): apague só a pasta que você criou. Matar processo só pela porta do seu próprio servidor.
- O painel do navegador é compartilhado; abra a sua aba. Medidas de `scrollWidth` com `innerWidth` = 0 são inválidas (painel sem largura).
- Confirmar no git antes de aceitar um relatório ("a S01 já estava no main" era verdade e evitou retrabalho).

## O que só o Gabriel pode fazer / decidir
1. **Hospedagem e primeiro deploy** (D-21 preparou Dockerfile, `/health`, SQLite com volume; `TRUST_PROXY=1` atrás de proxy; `JWT_SECRET` forte; `SHOWVAULT_DATA_DIR` num volume persistente). O primeiro `docker build` e o primeiro CI no GitHub **nunca rodaram**: olhar a aba Actions e ajustar se ficar vermelho.
2. **Chave do TMDB** (opcional): filmes/séries externos com títulos em PT-BR. `TMDB_API_KEY` no `.env`.
3. **Client ID do Google** (opcional): passo a passo no README; sem ele o botão fica escondido.
4. **Testar a Jikan real** com internet livre (a máquina de desenvolvimento deu timeout; só respostas simuladas foram testadas). Buscar "Frieren"/"Naruto" e adicionar uma obra; ajustes de formato em `server/services/jikanMapper.js`.

## Pendências técnicas conhecidas (candidatas às próximas sessões)
- Telas para trocar senha e excluir conta (API pronta, sem UI); verificação de e-mail e recuperação de senha (exige serviço de e-mail); logout só no cliente (token vale 7 dias).
- Duplicata possível: amostra do seed na lista × mesma obra vinda da Jikan (D-S06-4); obras antigas do catálogo de runtime com 8.0/"Drama"/Unsplash; sinopses e títulos em inglês; "Remover exemplo" em 1 clique.
- Performance: virtualizar listas de episódios (1.100 linhas ainda são criadas ao abrir o modal); "resumo" por obra em vez do detalhe completo ao abrir o app.
- Qualidade: Prettier no restante do código; módulos ES; `state.js` ainda monta a chave `id_sN_eM` em 3 lugares; Lighthouse/axe reais e teste com leitor de tela e celular reais.
- Backlog de produto: ver `04-roadmap.md` (calendário de lançamentos, importar TV Time/MAL, nota 1–5, PWA/offline).
