# S19 · Acessibilidade real e polimento final

**Status:** em `Documentacao/status/S19.json` (`npm run status -- S19`) · **Prioridade:** 9 · **Depende de:** S11–S18 (fecha a rodada; formata o repositório inteiro) · **Branch:** `feature/s19-polimento-final`

## Por que importa
Fechar a dívida técnica que sobrou: auditorias de acessibilidade/performance nunca rodaram com ferramentas reais, o Prettier só cobre arquivos novos e o frontend ainda usa scripts clássicos com dependência por ordem de carga.

## Tarefas
- [ ] Lighthouse e axe reais (via Playwright da S12) em todas as abas e modais; corrigir o que aparecer; checklist manual com leitor de tela (NVDA) e celular real, registrado no diário.
- [ ] Prettier no repositório inteiro (um commit só, sem mudança de lógica) e `format:check` cobrindo tudo no CI.
- [ ] Migrar o frontend para módulos ES (`type="module"`), removendo a dependência de ordem dos `<script>` e os globais `window.*` onde possível; manter a CSP estrita.
- [ ] Unificar a montagem da chave `id_sN_eM` (hoje repetida em `state.js`) no util compartilhado.
- [ ] Revisão final de segurança (checklist de `01-visao-geral`) e atualização do README/arquitetura.

## Critério de pronto
Lighthouse/axe sem problemas graves, repositório 100% formatado e com lint limpo, frontend em módulos ES, CI verde, docs atualizadas.

## Fora de escopo
Reescrever em framework.
