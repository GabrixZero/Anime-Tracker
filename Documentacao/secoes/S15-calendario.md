# S15 · Calendário de lançamentos

**Status:** em `Documentacao/status/S15.json` (`npm run status -- S15`) · **Prioridade:** 5 · **Depende de:** S13 (datas de exibição e atualização de obras em exibição) · **Branch:** `feature/s15-calendario`

## Por que importa
Era a P2 do roadmap original do Gabriel: ver, como no TV Time, quais episódios das obras da lista saem nesta semana.

## Tarefas
- [ ] Endpoint `GET /api/user/calendar?from=&to=` (ou cálculo no cliente) a partir das obras rastreadas: datas de `air_date` (TVMaze/TMDB) e `airingSchedule` (AniList), com fuso horário do navegador.
- [ ] Atualização das obras em exibição antes de montar a agenda (TTL da S13), sem estourar limites das fontes.
- [ ] Nova aba **Agenda** (semana atual, próximos 7/30 dias, "hoje"), com marcar como assistido direto do calendário; incluir na barra inferior do mobile (6 itens: rever rótulos curtos) e no padrão de abas acessível (S07).
- [ ] Estados vazios e de erro (fonte indisponível) seguindo `mediaDisplay`/`viewKit`; sem `style=`/`onclick` (CSP da S10).
- [ ] Testes unitários do cálculo de datas (fusos, virada de semana) + E2E.

## Critério de pronto
A aba Agenda mostra corretamente os próximos episódios das obras da lista (séries e animes), funciona no celular e com teclado, e não quebra quando uma fonte está fora do ar.

## Fora de escopo
Notificações push/e-mail de lançamento (backlog).
