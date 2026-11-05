# 2026-11-05 · FX · Descrição vazia no A Seguir · branch fix/descricao-resumo-lista
- Feito: reproduzido (resumo da lista sem `overview`; episódios de anime sem sinopse na fonte) e corrigido: resumo leve com sinopse curta da obra (240 caracteres), cartão do A Seguir usa episódio || obra. Conferidos os outros usos do resumo: só o A Seguir e o quadro de detalhe mostram sinopse (Minha Lista, Agenda, Diário e Estatísticas não mostram nem usam `overview`; o quadro carrega o detalhe completo ao abrir).
- Medição (19 obras sintéticas): resumo 104,7 KB → 109,5 KB (gzip 8,7 → 10,6 KB); com sinopses de episódios seria 179,7 KB (gzip 33,2 KB), por isso ficaram de fora.
- Testes: `tests/fix-descricao-resumo.test.js` (truncamento e resumo), `tests/s18-performance-offline.test.js` (rota), `tests/e2e/21-descricao-a-seguir.spec.js` (obra com sinopse longa e obra sem sinopse). Sem internet.
- Commits/PR: ver a PR desta branch (chegou à develop? sim, depois do CI verde).
- Pendente: nada. Se quiserem a sinopse real do episódio nos animes, a fonte (Jikan/AniList) não oferece nesta chamada.
- Extra pedido pelo Gabriel (commit separado): removido o aviso "Algumas obras não foram atualizadas agora; mostrando os dados salvos." da Agenda.
- Decisões: D-FX-1 e D-FX-2 criadas.
