# S03 · Biblioteca e sincronização

**Status:** em `Documentacao/status/S03.json` (`npm run status -- S03`) · **Gravidade:** média/alta · **Depende de:** S02 (ids estáveis) · **Branch:** `feature/s03-biblioteca-e-sync`

## Por que importa
O sync foi entregue em 2026-10-26 com limitações conhecidas, e a regra de status das séries não funciona para o usuário.

## Problemas encontrados
- **Vazamento entre contas:** `authView.handleLogout` só remove o token. A chave de estado `showvault_state_mvc_v1` é global; outro usuário que entre no mesmo navegador
  tem a biblioteca do anterior **mesclada** na própria conta (`syncService.pullAndMerge`).
- **Sem remoção entre aparelhos:** `SyncService.merge` é união; item removido/desmarcado num aparelho reaparece no login de outro. `watched` usa `l.watched || r.watched`.
- **Status das séries:** `addToList` sempre usa `watching` (`appController.js` ~92). Só filmes chegam a `completed`/`plan_to_watch` (`state.js` ~409–413); nada define `dropped`/pausado.
  Os filtros "Finalizados"/"Quero Ver" ficam vazios para séries/animes e a tela de estatísticas conta "finalizadas" por episódios, divergindo da lista.
- Importação de backup sem validação (compartilhado com S01); "Resetar" só limpa o navegador (logado, o próximo login traz tudo de volta).
- Last-write-wins sem versão; relógio do aparelho influencia `updatedAt` das notas.
- `SyncService.merge` é função pura mas não é testável hoje (está dentro da classe do navegador).
- O selo "Sincronizado" do cabeçalho é fixo (`index.html` ~94) e contradiz o rótulo real (cobre também S08).

## Tarefas
- [ ] Isolar o estado por usuário: guardar `showvault_last_user`; no logout limpar/arquivar o estado local; no login de usuário diferente do último **substituir** (não mesclar) o local pelo remoto.
- [ ] Propagar remoções (decisão P-03): marcas de exclusão (`deletedAt`) nos itens ou "servidor vence após o primeiro sync do aparelho". Ajustar `LibraryModel.validate` junto.
- [ ] Extrair `merge` para um módulo puro compartilhável (rodável no Node) e cobrir com testes (união, conflito, remoção, notas mais novas).
- [ ] Status por obra editável na interface (Assistindo, Quero ver, Pausado, Finalizado, Desisti): seletor no modal e na lista; `addToList` com padrão coerente;
  marcar como Finalizado automaticamente quando todos os episódios forem assistidos; estatísticas e lista usando a mesma regra.
- [ ] "Resetar" com opção de também apagar a nuvem (confirmação explícita).
- [ ] Tratar `PUT` com falha/401 e conflitos de forma visível (rótulo de status; botão "tentar de novo").
- [ ] Avaliar nota do usuário 1–5 (decisão P-04) — só implementar se aprovada.
- [ ] Testes de integração da rota `/api/user/library` (precisa de `app` exportável — ver S10/S04) ou, no mínimo, testes do `LibraryModel` com campos novos.

## Decisões pendentes
P-03 (como propagar remoções) e P-04 (nota 1–5).

## Critério de pronto
Duas contas no mesmo navegador não veem dados uma da outra; desmarcar/remover num aparelho se reflete no outro; o usuário muda o status de qualquer obra e as telas concordam;
`merge` testado; `npm test` passa.

## Fora de escopo
Tempo real/websocket; resolução de conflitos campo a campo além do necessário.
