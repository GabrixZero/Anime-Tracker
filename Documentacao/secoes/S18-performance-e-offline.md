# S18 · Performance 2 e modo offline (PWA)

**Status:** em `Documentacao/status/S18.json` (`npm run status -- S18`) · **Prioridade:** 8 · **Depende de:** S13 (dados reais de animes longos) · **Branch:** `feature/s18-performance-e-offline`

## Por que importa
A S09 deixou pendências: abrir uma obra com 1.100 episódios ainda cria 1.100 linhas (~38 ms no desktop, mais no celular) e, ao abrir o app, o detalhe completo de todas as obras rastreadas é baixado. O modo offline (D-20) foi adiado.

## Tarefas
- [ ] Virtualizar a lista de episódios do modal (renderizar só o visível), mantendo foco/teclado (`a11y.js`) e `data-ep`/`data-focus-key`.
- [ ] "Resumo por obra" para a abertura do app (contagens e próximo episódio) no lugar do detalhe completo; detalhe só sob demanda.
- [ ] PWA: `manifest.webmanifest`, ícones, service worker com cache do app shell e dos dados locais; modo somente-leitura offline com fila de sincronização ao voltar a rede. Compatível com a CSP da S10.
- [ ] Imagens: atualizar URLs antigas do catálogo de runtime para tamanhos médios (migração idempotente).
- [ ] Medir antes/depois (script da S09 + Lighthouse real via Playwright da S12) e registrar no diário.

## Critério de pronto
Abrir/rolar uma obra de 1.000+ episódios fica fluido no celular; app instalável e utilizável offline para consulta; métricas registradas.

## Fora de escopo
Notificações push.
