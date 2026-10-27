// S12 · Explorar: catálogo paginado ("Mostrar mais"), busca em fontes externas SIMULADAS (TVMaze, AniList + Jikan, TMDB) e adicionar à lista.
// Os dados vêm do servidor falso (tests/e2e/fake-sources); nada sai para a internet. Roda em desktop e mobile.
'use strict';

const { test, expect } = require('./support/fixtures');
const { EXPECTED } = require('./fake-sources/data');
const {
  openApp,
  gotoTab,
  toast,
  exploreCard,
  listCard,
  queueCard,
  newUser,
  signInWithApi,
  serverLibrary,
  tap
} = require('./support/helpers');

const search = async (page, query, type) => {
  if (type) await tap(page.locator(`[data-explore-type="${type}"]`));
  await page.locator('#explore-search-input').fill(query);
  await page.locator('#explore-search-input').press('Enter');
  await expect(page.locator('#explore-results-title')).toHaveText(new RegExp(`^Resultados para "${query}" \\(\\d+\\)$`));
};

test.describe('Explorar', () => {
  test('catálogo paginado: 60 por página, "Mostrar mais" traz o resto e os filtros de tipo funcionam', async ({ page }) => {
    await openApp(page);
    await gotoTab(page, 'explore');

    const title = page.locator('#explore-results-title');
    await expect(title).toHaveText(/^Catálogo \(\d+\)$/);
    const total = Number((await title.textContent()).match(/\d+/)[0]);
    expect(total, 'o catálogo de teste tem o seed (16) + 50 obras fictícias').toBeGreaterThan(60);

    const cards = page.locator('#explore-container .show-card');
    await expect(cards).toHaveCount(60);
    const more = page.getByRole('button', { name: 'Mostrar mais' });
    await expect(more).toBeVisible();

    await tap(more);
    // (outros testes trazem obras novas ao catálogo enquanto este roda: a 2ª página pode ter alguma a mais que o título mostrava)
    await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(total);
    expect(await cards.count()).toBeLessThan(total + 10);
    await expect(more).toHaveCount(0); // acabou: o botão some
    // o foco vai para o primeiro título novo (o botão foi redesenhado), nunca cai no <body>
    await expect(page.locator('#explore-container .show-open-btn').nth(60)).toBeFocused();

    // filtro de tipo: só filmes (o seed tem 5 + os fictícios)
    await tap(page.locator('[data-explore-type="movie"]'));
    await expect(page.locator('[data-explore-type="movie"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(title).toHaveText(/^Catálogo \(\d+\)$/);
    await expect(cards.first()).toBeVisible();
    const badges = page.locator('#explore-container .show-card .badge-type-tag');
    expect(await badges.count()).toBeGreaterThanOrEqual(5);
    await expect(badges.filter({ hasNotText: 'Filme' })).toHaveCount(0);
  });

  test('séries (TVMaze): busca, adicionar, ver no Cofre, temporadas e A Seguir', async ({ page }, testInfo) => {
    const { tvShow } = EXPECTED;
    await signInWithApi(page, newUser(testInfo, 'serie'));
    await gotoTab(page, 'explore');
    await search(page, tvShow.query);

    await expect(page.locator('#explore-container .show-card')).toHaveCount(2);
    const card = exploreCard(page, tvShow.name);
    await expect(card.locator('.badge-type-tag')).toHaveText('Série');
    await expect(card.locator('.show-year')).toHaveText('2021');
    await expect(card.locator('.show-rating-badge')).toHaveText('★ 7.9');
    await expect(exploreCard(page, tvShow.otherName).locator('.show-rating-badge')).toHaveText('Sem nota');

    await tap(card.getByRole('button', { name: '+ Adicionar à Lista' }));
    await expect(toast(page, 'Adicionado à sua lista!')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Ver no Cofre' })).toBeVisible(); // o cartão muda sem nova busca
    await expect(exploreCard(page, tvShow.otherName).getByRole('button', { name: '+ Adicionar à Lista' })).toBeVisible();

    // Minha Lista: 2 temporadas, 5 episódios, "Quero ver"
    await gotoTab(page, 'watchlist');
    const inList = listCard(page, tvShow.name);
    await expect(inList.locator('.show-meta-line')).toContainText('2 temp.');
    await expect(inList.locator('.show-meta-line')).toContainText('Finalizada');
    await expect(inList.locator('.show-progress-info')).toContainText(`0/${tvShow.episodes} eps (0%)`);
    await expect(inList.locator('select.status-select')).toHaveValue('plan_to_watch');

    // Detalhe: abas de temporada com os episódios de cada uma
    await tap(page.getByRole('button', { name: tvShow.name, exact: true }));
    const tabs = page.locator('#show-seasons-tabs .season-tab-btn');
    await expect(tabs).toHaveText(['Temporada 1 (0/3)', 'Temporada 2 (0/2)']);
    await expect(page.locator('#show-episodes-container .episode-name')).toHaveText(['A Chegada', 'O Mapa', 'A Travessia']);
    await tap(tabs.nth(1));
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#show-episodes-container .episode-name')).toHaveText(['Do Outro Lado', 'O Retorno']);
    await page.keyboard.press('Escape');

    // A Seguir: o primeiro episódio da série
    await gotoTab(page, 'next-up');
    await expect(queueCard(page, tvShow.name).locator('.next-up-badge')).toHaveText('T1:E1');
    await expect(queueCard(page, tvShow.name).locator('.next-up-ep-title')).toHaveText('A Chegada');

    // A lista está na conta (servidor) e volta depois de recarregar
    await expect.poll(async () => (await serverLibrary(page)).trackedShows.map(t => t.showId)).toContain(tvShow.id);
    await page.reload();
    await gotoTab(page, 'watchlist');
    await expect(listCard(page, tvShow.name)).toBeVisible();
  });

  test('animes (AniList + Jikan): a franquia vira UMA obra com duas temporadas e títulos de episódio', async ({ page }, testInfo) => {
    const { anime } = EXPECTED;
    await signInWithApi(page, newUser(testInfo, 'anime'));
    await gotoTab(page, 'explore');
    await search(page, anime.query, 'anime');

    // as duas entradas da franquia (Star Memories e Star Memories Season 2) aparecem como um cartão só
    await expect(page.locator('#explore-container .show-card')).toHaveCount(1);
    const card = exploreCard(page, anime.name);
    await expect(card.locator('.badge-type-tag')).toHaveText('Anime');
    // O catálogo é compartilhado entre os testes: se o outro projeto (desktop/mobile) já trouxe a franquia, o cartão é o da obra gravada
    // ("2023" e "2 temporadas"); se não, é o resultado da AniList ("Outono 2023" e "+1 parte da franquia"). As duas formas valem.
    await expect(card.locator('.show-year')).toHaveText(/^(Outono )?2023$/);
    await expect(card.locator('.show-meta-line')).toContainText(/\+1 parte da franquia|2 temporadas/);
    await expect(card.locator('.show-meta-line')).toContainText('Adventure, Fantasy');

    await tap(card.getByRole('button', { name: '+ Adicionar à Lista' }));
    await expect(toast(page, 'Adicionado à sua lista!')).toBeVisible();

    await gotoTab(page, 'watchlist');
    const inList = listCard(page, anime.name);
    await expect(inList.locator('.show-meta-line')).toContainText(`${anime.seasons} temp.`);
    await expect(inList.locator('.show-meta-line')).toContainText('Finalizada');
    await expect(inList.locator('.show-progress-info')).toContainText(`0/${anime.episodes} eps (0%)`);

    await tap(page.getByRole('button', { name: anime.name, exact: true }));
    const tabs = page.locator('#show-seasons-tabs .season-tab-btn');
    await expect(tabs).toHaveText([`${anime.seasonNames[0]} (0/3)`, `${anime.seasonNames[1]} (0/2)`]);
    await expect(page.locator('#show-episodes-container .episode-name')).toHaveText([
      anime.firstEpisode,
      'Constelações',
      'A Estrela Cadente'
    ]);
    await tap(tabs.nth(1));
    await expect(page.locator('#show-episodes-container .episode-name')).toHaveText(['Um Novo Céu', 'Memória Final']);
    await page.keyboard.press('Escape');

    await gotoTab(page, 'next-up');
    await expect(queueCard(page, anime.name).locator('.next-up-ep-title')).toHaveText(anime.firstEpisode);
  });

  test('filmes (TMDB): a busca de filmes novos funciona com a chave configurada', async ({ page }, testInfo) => {
    const { movie } = EXPECTED;
    await signInWithApi(page, newUser(testInfo, 'filme'));
    await gotoTab(page, 'explore');
    await search(page, movie.query, 'movie');

    await expect(page.locator('#explore-container .show-card')).toHaveCount(1);
    const card = exploreCard(page, movie.name);
    await expect(card.locator('.badge-type-tag')).toHaveText('Filme');
    await expect(card.locator('.show-year')).toHaveText('2022');
    await expect(card.locator('.show-meta-line')).toContainText('Ficção científica, Suspense');
    await expect(page.locator('#explore-container .grid-message--info')).toHaveCount(0); // sem aviso de fonte fora do ar/sem chave

    await tap(card.getByRole('button', { name: '+ Adicionar à Lista' }));
    await expect(toast(page, 'Adicionado à sua lista!')).toBeVisible();

    await gotoTab(page, 'watchlist');
    await expect(listCard(page, movie.name).locator('.show-meta-line')).toContainText(`${movie.runtime} min`);
    await expect(listCard(page, movie.name).locator('.show-progress-info')).toContainText('Não assistido');
    await gotoTab(page, 'next-up');
    await expect(queueCard(page, movie.name).locator('.next-up-badge')).toHaveText('FILME');
  });

  test('sem conta não dá para trazer uma obra NOVA ao catálogo: avisa e não adiciona', async ({ page, guard }) => {
    const { tvShow } = EXPECTED;
    // o 401 é o comportamento esperado (e o app registra o erro no console de propósito)
    guard.allow(/401 \(Unauthorized\)/, /\[API Error\] \/media\/\d+: Entre na sua conta/);
    await openApp(page);
    await gotoTab(page, 'explore');
    await search(page, tvShow.query);

    // "Fronteira Final" é usada SÓ aqui: nenhum outro teste a traz para o catálogo (assim ela é sempre nova)
    const card = exploreCard(page, tvShow.otherName);
    await tap(card.getByRole('button', { name: '+ Adicionar à Lista' }));
    await expect(toast(page, 'Entre na sua conta para adicionar novas obras ao catálogo.')).toBeVisible();
    await expect(card.getByRole('button', { name: '+ Adicionar à Lista' })).toBeVisible();
    await expect(page.locator('#badge-watchlist')).toHaveText('0');
  });
});
