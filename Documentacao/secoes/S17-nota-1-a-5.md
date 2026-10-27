# S17 · Nota do usuário (1 a 5 estrelas)

**Status:** em `Documentacao/status/S17.json` (`npm run status -- S17`) · **Prioridade:** 7 · **Depende de:** nada · **Branch:** `feature/s17-nota-1-a-5`

## Por que importa
Estava no handover original e foi adiada em D-14. É pequena e independente.

## Tarefas
- [ ] Modelo: `ratings` por obra (1–5, meia estrela opcional) com `updatedAt`; tombstone ao remover nota. Atualizar **juntos** `LibraryModel.validate`, `backupValidator`, `libraryMerge` e o teste de equivalência (são espelhados).
- [ ] Interface: estrelas no modal de detalhes e no cartão da lista (grupo de rádio acessível, teclado, `aria-*`), sem `style=`/`onclick`.
- [ ] Estatísticas: média, distribuição e obras mais bem avaliadas.
- [ ] Migração de versão do estado (`stateVersion`) se necessário; testes unitários + E2E.

## Critério de pronto
Dar/alterar/remover nota sincroniza entre aparelhos e aparece nas estatísticas; acessível; testes verdes.

## Fora de escopo
Nota por episódio; nota pública/comunitária.
