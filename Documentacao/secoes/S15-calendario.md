# S15 · Calendário de lançamentos

**Status:** em `Documentacao/status/S15.json` (`npm run status -- S15`) · **Prioridade:** 5 · **Depende de:** S13 (datas de exibição e atualização de obras em exibição) · **Branch:** `feature/s15-calendario`

## Por que importa
Era a P2 do roadmap original do Gabriel: ver, como no TV Time, quais episódios das obras da lista saem nesta semana.

## Tarefas
- [x] Endpoint `GET /api/user/calendar?from=&to=` (ou cálculo no cliente) a partir das obras rastreadas: datas de `air_date` (TVMaze/TMDB) e `airingSchedule` (AniList), com fuso horário do navegador.
- [x] Atualização das obras em exibição antes de montar a agenda (TTL da S13), sem estourar limites das fontes.
- [x] Nova aba **Agenda** (semana atual, próximos 7/30 dias, "hoje"), com marcar como assistido direto do calendário; incluir na barra inferior do mobile (6 itens: rever rótulos curtos) e no padrão de abas acessível (S07).
- [x] Estados vazios e de erro (fonte indisponível) seguindo `mediaDisplay`/`viewKit`; sem `style=`/`onclick` (CSP da S10).
- [x] Testes unitários do cálculo de datas (fusos, virada de semana) + E2E.

## Decisões e limitações (implementação)
- **D-S15-1 · Cálculo 100% no cliente**, sem endpoint novo: `public/js/utils/calendar.js` (funções puras, `window.Calendar` / `module.exports`) + `views/calendarView.js`. Usa o `air_date` dos episódios que o app já tem (TVMaze/TMDB/AniList/Jikan, já normalizados pelo servidor); episódio sem data válida **não entra** (nada é inventado). Filmes entram pela data de estreia (`first_air_date`), em breve e nos 90 dias seguintes à estreia.
- **Fila (atualizado em 2026-11-05, D-AV-6 e D-AG-1..7):** todas as obras da lista exceto "Desisti". Períodos: Semana (segunda a domingo), 7 dias, 30 dias e **Todos**; a janela é hoje − 90 dias até o futuro sem limite (fronteira inclusiva); a seção "Sem data prevista" foi removida. Veja a refação em "Refação da Agenda: janela de 90 dias" em `02-decisoes.md`.
- **Atualização ao abrir a aba:** só com login, no máximo 1 rodada a cada 30 min por sessão (por carregamento da página), até 8 obras com status "Em Exibição"/"Em breve", uma por vez, via `POST /api/media/:id/refresh` (sem `force`: o servidor respeita validade e limite). Falha de uma obra só liga o aviso "Algumas obras não foram atualizadas agora; mostrando os dados salvos."
- **Limitação de fuso:** as datas dos episódios são dia civil sem hora (a AniList informa o horário em UTC e o servidor guarda só a data), e "hoje" usa o fuso do navegador. Um episódio que estreia à noite no Brasil pode aparecer no dia seguinte. Horário de exibição fica para o backlog.
- **Barra inferior do celular:** 6 colunas; rótulo curto "Agenda"; testes: `tests/s15-calendar.test.js` (unitários + HTML/CSP) e `tests/e2e/13-agenda.spec.js` (série falsa "Estreias da Semana" com datas relativas a hoje em `fake-sources/data.js`).

## Critério de pronto
A aba Agenda mostra corretamente os próximos episódios das obras da lista (séries e animes), funciona no celular e com teclado, e não quebra quando uma fonte está fora do ar.

## Fora de escopo
Notificações push/e-mail de lançamento (backlog).
