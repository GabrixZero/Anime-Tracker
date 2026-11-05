# 2026-11-05 · Ajuste · Filmes/OVAs/especiais separados das temporadas · branch feature/anime-extras-separados
- Feito: classificação oficial (AniList `format`/Jikan `type`) em `animeSeasons.js`; `season.category` gravado pelos dois mapeadores e enviado no resumo; migração local idempotente das obras já guardadas (`animeMigration.js`, backup antes); regras de progresso/A Seguir/Agenda/Estatísticas em `watchStatus.js`, `calendar.js`, `statsView.js`; telas: abas só de temporada + seções "Filmes" e "OVAs e especiais" no detalhe, rótulo FILME/OVA na Agenda, CSS.
- Proteção das marcações: `season_number`, `episodes` e `franchise.entries` não mudam; só `category` e `name` são regravados. Teste "antes/depois" confirma as chaves `id_sN_eM` iguais.
- Testes: `anime-extras-servidor/frontend/telas.test.js` (fontes falsas, sem internet). Conferido no navegador (desktop e 375×812) com obra inventada.
- Bug achado na conferência visual e corrigido: a Agenda lia a data do extra num campo que não existe (agora usa a data do episódio 1) e a caixa do extra não se repintava ao marcar.
- Pendente / descobertas: filmes avulsos do TMDB seguem somando em "episódios" nas Estatísticas; extra com vários episódios mostra e marca só o episódio 1; trocar as 16 amostras do catálogo por dados reais e títulos de episódios de anime ficam para depois (decisão do Gabriel).
- Decisões: D-AX-1..5.
