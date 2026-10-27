# S16 · Importar e exportar histórico

**Status:** em `Documentacao/status/S16.json` (`npm run status -- S16`) · **Prioridade:** 6 · **Depende de:** S13 (correspondência por ids da AniList/MAL) · **Branch:** `feature/s16-importar-exportar`

## Por que importa
Para o Gabriel e os amigos trazerem o que já assistiram no TV Time e na MyAnimeList sem marcar tudo à mão.

## Tarefas
- [ ] Importar **MyAnimeList** (XML de exportação): casar por `mal_id` (faixa `10_000_000 + mal_id`), ingerir obras ausentes, marcar episódios assistidos e status.
- [ ] Importar **TV Time** (CSV/arquivos do pedido de dados): casar por título + ano (TVMaze/TMDB), com tela de revisão para correspondências incertas antes de aplicar.
- [ ] Prévia e relatório: quantas obras/episódios serão adicionados, conflitos, itens não encontrados; nada é aplicado sem confirmação; tudo passa pelo `backupValidator`/merge (tombstones) da S03.
- [ ] Exportar: JSON completo (já existe) + CSV simples e XML compatível com a MAL para animes.
- [ ] Respeitar limites das fontes (fila/throttle) em importações grandes; progresso visível.
- [ ] Testes com arquivos de exemplo **sintéticos** (nunca dados reais do Gabriel).

## Critério de pronto
Um export real de MAL e um de TV Time (fornecidos pelo Gabriel na hora, sem commitar) importam com prévia e revisão; exportações abrem em outras ferramentas; testes verdes.

## Fora de escopo
Sincronização contínua com contas MAL/AniList (OAuth delas).
